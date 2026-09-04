import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Loader2, ShieldCheck, ShieldAlert, Trash2 } from 'lucide-react'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

// Setup instructions differ per provider, and getting these wrong is the main
// reason a school's first attempt fails — so they're shown inline rather than
// living in external docs.
const PROVIDER_HELP = {
  google: {
    label: 'Google Workspace',
    steps: [
      'Open Google Cloud Console → APIs & Services → Credentials.',
      'Create Credentials → OAuth client ID → Application type "Web application".',
      'Under "Authorized redirect URIs", add the redirect URI shown below.',
      'Set the OAuth consent screen to "Internal" so only your school can sign in.',
      'Copy the Client ID and Client secret into the form.',
    ],
  },
  microsoft: {
    label: 'Microsoft Entra ID',
    steps: [
      'Open the Microsoft Entra admin center → App registrations → New registration.',
      'Under "Redirect URI", choose "Web" and add the redirect URI shown below.',
      'From the app Overview, copy the Application (client) ID and Directory (tenant) ID.',
      'Go to Certificates & secrets → New client secret, then copy its Value.',
    ],
  },
  oidc: {
    label: 'Other (generic OIDC)',
    steps: [
      'In your identity provider, create an OpenID Connect web application.',
      'Add the redirect URI shown below as an allowed redirect/callback URL.',
      'Copy the issuer URL, client ID, and client secret into the form.',
      'Because we cannot read a domain claim from a generic provider, you will also need to add a DNS TXT record to prove you own your email domain.',
    ],
  },
}

export default function SsoSettings() {
  const [loading, setLoading] = useState(true)
  const [connections, setConnections] = useState([])
  const [redirectUri, setRedirectUri] = useState('')
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const [form, setForm] = useState({
    provider: 'google',
    displayName: '',
    clientId: '',
    clientSecret: '',
    tenantId: '',
    issuer: '',
    defaultRole: 'student',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiUrl}/auth/sso/connections`, { headers: authHeaders() })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not load SSO settings.')
      const data = await res.json()
      setConnections(data.connections || [])
      setRedirectUri(data.redirectUri || '')
      setErr('')
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // The test round trip redirects back here with its result in the query
  // string, so surface that and then clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('sso_test') === 'ok') {
      const email = params.get('sso_email')
      const unverified = params.get('sso_domain_unverified')
      const conflict = params.get('sso_domain_conflict')
      if (conflict) {
        // The sign-in itself worked, but the domain belongs to someone else —
        // say so here rather than letting the admin discover it as an
        // unexplained refusal when they try to enable.
        setErr(`Connection works (signed in as ${email}), but "${conflict}" is already claimed by another organization, so it could not be verified for this connection. Contact support to sort out who owns it.`)
        setNotice('')
      } else {
        setNotice(
          unverified
            ? `Connection works (signed in as ${email}), but we could not automatically prove you own "${unverified}". Add it below and verify by DNS.`
            : `Connection works — signed in as ${email}, and your email domain is verified. You can enable SSO now.`,
        )
      }
      window.history.replaceState({}, '', window.location.pathname)
      load()
    }
  }, [load])

  const create = async (e) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`${apiUrl}/auth/sso/connections`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not create the connection.')
      setForm({ provider: 'google', displayName: '', clientId: '', clientSecret: '', tenantId: '', issuer: '', defaultRole: 'student' })
      await load()
      setNotice('Connection saved. Run a test to verify it before enabling.')
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const patch = async (id, body) => {
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`${apiUrl}/auth/sso/connections/${id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not update the connection.')
      await load()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id) => {
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`${apiUrl}/auth/sso/connections/${id}`, { method: 'DELETE', headers: authHeaders() })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not remove the connection.')
      await load()
      setNotice('Connection removed.')
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  // The test is a real IdP round trip, so the browser has to leave the SPA.
  // Ask for the authorization URL over an authenticated POST first — a
  // top-level navigation can't carry a bearer header, and smuggling the JWT
  // through the query string would leak it into history and access logs.
  const test = async (id) => {
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`${apiUrl}/auth/sso/connections/${id}/test-start`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ returnTo: '/school/dashboard' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not start the test.')
      window.location.assign(data.url)
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  const copyRedirect = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked — the value is selectable on screen */ }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading SSO settings…</div>
  }

  const help = PROVIDER_HELP[form.provider]

  return (
    <div className="space-y-6">
      {err && <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">{err}</div>}
      {notice && <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-200">{notice}</div>}

      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
        <div className="text-sm font-semibold">Redirect URI</div>
        <p className="mt-1 text-sm text-slate-500">
          Paste this into your identity provider when you create the app. It is the same for every school.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs">{redirectUri || '(server URL not configured)'}</code>
          <button type="button" onClick={copyRedirect} className="btn-sm btn-ghost shrink-0">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {connections.map((c) => (
        <div key={c.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold">{c.displayName}</div>
              <div className="text-xs text-slate-500">{PROVIDER_HELP[c.provider]?.label || c.provider} · {c.issuer}</div>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${c.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
              {c.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>

          <div className="flex items-center gap-2 text-sm">
            {c.lastTestOk
              ? <><ShieldCheck className="h-4 w-4 text-emerald-500" /> <span className="text-slate-600 dark:text-slate-300">Last test passed</span></>
              : <><ShieldAlert className="h-4 w-4 text-amber-500" /> <span className="text-slate-600 dark:text-slate-300">Not tested yet</span></>}
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email domains</div>
            {c.domains.length === 0 ? (
              <p className="mt-1 text-sm text-slate-500">None yet — run a test to verify your domain automatically.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-sm">
                {c.domains.map((d) => (
                  <li key={d.domain} className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">{d.domain}</span>
                    {d.verified
                      ? <span className="text-xs text-emerald-600 dark:text-emerald-300">verified</span>
                      : <span className="text-xs text-amber-600 dark:text-amber-300">pending — add TXT record {d.verifyToken}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className="btn-sm btn-ghost" disabled={busy} onClick={() => test(c.id)}>Test connection</button>
            <button
              type="button"
              className="btn-sm btn-primary"
              disabled={busy}
              onClick={() => patch(c.id, { enabled: !c.enabled })}
            >
              {c.enabled ? 'Disable SSO' : 'Enable SSO'}
            </button>
            <button type="button" className="btn-sm btn-ghost text-red-600" disabled={busy} onClick={() => remove(c.id)}>
              <Trash2 className="h-4 w-4" /> Remove
            </button>
          </div>
        </div>
      ))}

      {connections.length === 0 && (
        <form onSubmit={create} className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-4">
          <div className="font-semibold">Connect your school&apos;s login</div>

          <div>
            <label className="label" htmlFor="sso-provider">Identity provider</label>
            <select
              id="sso-provider"
              className="input"
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
            >
              <option value="google">Google Workspace</option>
              <option value="microsoft">Microsoft Entra ID (Microsoft 365)</option>
              <option value="oidc">Other (generic OIDC)</option>
            </select>
          </div>

          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
            {help.steps.map((s) => <li key={s}>{s}</li>)}
          </ol>

          <div>
            <label className="label" htmlFor="sso-name">Button label</label>
            <input
              id="sso-name" className="input" required maxLength={100}
              placeholder="Sign in with Lincoln High School"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
          </div>

          {form.provider === 'microsoft' && (
            <div>
              <label className="label" htmlFor="sso-tenant">Directory (tenant) ID</label>
              <input
                id="sso-tenant" className="input" required
                placeholder="00000000-0000-0000-0000-000000000000"
                value={form.tenantId}
                onChange={(e) => setForm({ ...form, tenantId: e.target.value })}
              />
            </div>
          )}

          {form.provider === 'oidc' && (
            <div>
              <label className="label" htmlFor="sso-issuer">Issuer URL</label>
              <input
                id="sso-issuer" className="input" required type="url"
                placeholder="https://idp.example.edu"
                value={form.issuer}
                onChange={(e) => setForm({ ...form, issuer: e.target.value })}
              />
            </div>
          )}

          <div>
            <label className="label" htmlFor="sso-client-id">Client ID</label>
            <input
              id="sso-client-id" className="input" required
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value })}
            />
          </div>

          <div>
            <label className="label" htmlFor="sso-client-secret">Client secret</label>
            <input
              id="sso-client-secret" className="input" required type="password"
              value={form.clientSecret}
              onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
            />
            <p className="mt-1 text-xs text-slate-500">Stored encrypted. It is never shown again after saving.</p>
          </div>

          <div>
            <label className="label" htmlFor="sso-role">Role for new accounts</label>
            <select
              id="sso-role" className="input"
              value={form.defaultRole}
              onChange={(e) => setForm({ ...form, defaultRole: e.target.value })}
            >
              <option value="student">Student</option>
              <option value="school_staff">Co-admin (staff)</option>
            </select>
          </div>

          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save connection'}
          </button>
        </form>
      )}
    </div>
  )
}
