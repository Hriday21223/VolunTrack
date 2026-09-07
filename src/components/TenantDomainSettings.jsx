import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Globe, Loader2, RefreshCw, ShieldCheck, ShieldAlert, Trash2 } from 'lucide-react'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

const STATUS_LABEL = {
  pending: { text: 'Awaiting DNS', tone: 'amber' },
  verifying: { text: 'Issuing certificate', tone: 'amber' },
  active: { text: 'Live', tone: 'emerald' },
  disabled: { text: 'Disabled', tone: 'slate' },
}

function CopyRow({ label, value }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked — the value is selectable on screen */ }
  }
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <code className="flex-1 overflow-x-auto rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 text-xs">{value}</code>
      <button type="button" onClick={copy} className="btn-sm btn-ghost shrink-0" title={`Copy ${label}`}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

export default function TenantDomainSettings() {
  const [loading, setLoading] = useState(true)
  const [domains, setDomains] = useState([])
  const [provisioningConfigured, setProvisioningConfigured] = useState(true)
  const [cnameTarget, setCnameTarget] = useState(null)
  const [hostname, setHostname] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiUrl}/tenant/domains`, { headers: authHeaders() })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not load domains.')
      setDomains(data.domains || [])
      setProvisioningConfigured(data.provisioningConfigured !== false)
      setCnameTarget(data.cnameTarget || null)
      setErr('')
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const call = async (path, options, okMessage) => {
    setBusy(true)
    setErr('')
    setNotice('')
    try {
      const res = await fetch(`${apiUrl}${path}`, { headers: authHeaders(), ...options })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Request failed.')
      await load()
      if (okMessage) setNotice(okMessage)
      return data
    } catch (e) {
      setErr(e.message)
      // Even a failed verify can have recorded ownership, so refresh anyway.
      await load()
      return null
    } finally {
      setBusy(false)
    }
  }

  const add = (e) => {
    e.preventDefault()
    const value = hostname.trim()
    if (!value) return
    setHostname('')
    return call('/tenant/domains', { method: 'POST', body: JSON.stringify({ hostname: value }) },
      'Domain added. Add the two DNS records below, then click Verify.')
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading domains…</div>
  }

  return (
    <div className="space-y-6">
      {err && <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">{err}</div>}
      {notice && <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-200">{notice}</div>}

      {!provisioningConfigured && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200">
          Custom domains can be claimed and their ownership verified, but this server
          cannot issue certificates yet, so a domain cannot go live. Contact VolunTrack support.
        </div>
      )}

      {domains.map((d) => {
        const label = STATUS_LABEL[d.status] || { text: d.status, tone: 'slate' }
        return (
          <div key={d.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-slate-400" />
                <span className="font-semibold">{d.hostname}</span>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                label.tone === 'emerald' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
                : label.tone === 'amber' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                {label.text}
              </span>
            </div>

            <div className="flex items-center gap-2 text-sm">
              {d.verifiedAt
                ? <><ShieldCheck className="h-4 w-4 text-emerald-500" /> <span className="text-slate-600 dark:text-slate-300">Ownership verified</span></>
                : <><ShieldAlert className="h-4 w-4 text-amber-500" /> <span className="text-slate-600 dark:text-slate-300">Ownership not verified yet</span></>}
            </div>

            {d.status !== 'active' && (
              <div className="space-y-2 rounded-xl bg-slate-50 dark:bg-slate-900/40 p-3">
                <p className="text-xs text-slate-500">
                  Add these two records at your DNS provider. The TXT record proves you own the
                  domain; the CNAME sends visitors to VolunTrack.
                </p>
                <CopyRow label="TXT name" value={d.dns.txtName} />
                <CopyRow label="TXT value" value={d.dns.txtValue} />
                <CopyRow label="CNAME" value={d.dns.cnameName} />
                <CopyRow label="Points to" value={d.dns.cnameTarget || '(not configured on this server yet)'} />
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {d.status !== 'active' && (
                <button type="button" className="btn-sm btn-primary" disabled={busy}
                  onClick={() => call(`/tenant/domains/${d.id}/verify`, { method: 'POST' }, 'Verified. Certificate issuance started.')}>
                  Verify DNS
                </button>
              )}
              {d.status === 'verifying' && (
                <button type="button" className="btn-sm btn-ghost" disabled={busy}
                  onClick={() => call(`/tenant/domains/${d.id}/refresh`, { method: 'POST' })}>
                  <RefreshCw className="h-3.5 w-3.5" /> Check certificate
                </button>
              )}
              <button type="button" className="btn-sm btn-ghost text-red-600" disabled={busy}
                onClick={() => call(`/tenant/domains/${d.id}`, { method: 'DELETE' }, 'Domain removed.')}>
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
            </div>
          </div>
        )
      })}

      <form onSubmit={add} className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
        <div className="font-semibold">Add a custom domain</div>
        <p className="text-sm text-slate-500">
          A hostname you already own, e.g. <code>volunteer.yourschool.edu</code>. You will need
          access to its DNS settings.
        </p>
        <input
          className="input" placeholder="volunteer.yourschool.edu"
          value={hostname} onChange={(e) => setHostname(e.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={busy || !hostname.trim()}>
          {busy ? 'Working…' : 'Add domain'}
        </button>
        {cnameTarget && (
          <p className="text-xs text-slate-500">Domains point to <code>{cnameTarget}</code>.</p>
        )}
      </form>
    </div>
  )
}
