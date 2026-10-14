import { useCallback, useEffect, useState } from 'react'
import { Building2, Check, Copy, KeyRound, Plus, School } from 'lucide-react'
import Card from '@/components/Card.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

const STATUS_STYLE = {
  active: 'bg-amber-500/10 text-amber-400',
  used: 'bg-emerald-500/10 text-emerald-400',
  expired: 'bg-red-500/10 text-red-400',
  revoked: 'bg-earth-500/10 text-earth-400',
}
const STATUS_LABEL = { active: 'Unused', used: 'Used', expired: 'Expired', revoked: 'Revoked' }

// Admin Invites tab: one-time codes a school or organization types on its
// register page (#287). The full code exists only in the create response,
// so this is the one place it's ever shown.
export default function RegistrationCodesPanel() {
  const [codes, setCodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [form, setForm] = useState(null) // { kind, label, days } while the create dialog is open
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(null) // { code, kind, label, expiresAt } — the one-time reveal
  const [copied, setCopied] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/registration-codes/admin`, { headers: authHeaders() })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not load codes.')
      setCodes(data.codes || [])
      setErr('')
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const create = async () => {
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`${apiUrl}/registration-codes/admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ kind: form.kind, label: form.label.trim(), expiresInDays: Number(form.days) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not create a code.')
      setForm(null)
      setCopied(false)
      setCreated(data)
      load()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (id) => {
    setConfirmRevoke(null)
    const res = await fetch(`${apiUrl}/registration-codes/admin/${id}/revoke`, { method: 'POST', headers: authHeaders() })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setErr(data.error || 'Could not revoke the code.')
    }
    load()
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.code)
      setCopied(true)
    } catch { /* clipboard blocked — the code is selectable on screen */ }
  }

  return (
    <Card padded={false} className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><KeyRound className="w-4 h-4 text-brand-400" /> Registration codes</h2>
          <p className="text-sm text-earth-400 mt-0.5">
            A school or organization needs one of these (or an invite link) to register. Each works once.
          </p>
        </div>
        <button onClick={() => setForm({ kind: 'school', label: '', days: 14 })} className="btn-sm btn-primary">
          <Plus className="w-3.5 h-3.5 mr-1" /> New code
        </button>
      </div>

      {err && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg mb-3">{err}</div>}

      {loading ? (
        <p className="text-sm text-earth-400 py-4 text-center">Loading codes…</p>
      ) : codes.length === 0 ? (
        <p className="text-sm text-earth-400 py-4 text-center">No codes yet.</p>
      ) : (
        <ul className="divide-y divide-earth-200 dark:divide-earth-800">
          {codes.map((c) => (
            <li key={c.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              {c.kind === 'organization'
                ? <Building2 className="w-5 h-5 text-brand-600 shrink-0" />
                : <School className="w-5 h-5 text-brand-600 shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  <span className="font-mono text-earth-400">••••-••••-••••-{c.hint}</span>
                  {c.label && <span className="ml-2">{c.label}</span>}
                </p>
                <p className="text-xs text-earth-500">
                  {c.kind === 'organization' ? 'Organization' : 'School'}
                  {' · '}
                  {c.status === 'used' && c.usedBy
                    ? `Used by ${c.usedBy.name || c.usedBy.email} (${c.usedBy.email}) on ${new Date(c.usedAt).toLocaleDateString()}`
                    : c.status === 'used'
                    ? `Used ${new Date(c.usedAt).toLocaleDateString()}`
                    : `${c.status === 'expired' ? 'Expired' : 'Expires'} ${new Date(c.expiresAt).toLocaleDateString()}`}
                </p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[c.status] || STATUS_STYLE.revoked}`}>
                {STATUS_LABEL[c.status] || c.status}
              </span>
              {c.status === 'active' && (
                confirmRevoke === c.id ? (
                  <span className="flex gap-1">
                    <button onClick={() => revoke(c.id)} className="btn-sm bg-red-600 text-white hover:bg-red-700">Revoke</button>
                    <button onClick={() => setConfirmRevoke(null)} className="btn-sm btn-ghost">Keep</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmRevoke(c.id)} className="text-xs text-red-400 hover:text-red-300">Revoke</button>
                )
              )}
            </li>
          ))}
        </ul>
      )}

      {form && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setForm(null)}>
          <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2">New registration code</h3>
            <p className="text-sm text-earth-400 mb-4">Give it to the customer however you like — text, email, or on a call. It works once.</p>
            <div className="space-y-3">
              <div>
                <label className="label" htmlFor="rc-kind">For</label>
                <select id="rc-kind" className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  <option value="school">A school</option>
                  <option value="organization">An organization</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="rc-label">Note <span className="text-earth-400 font-normal">(optional)</span></label>
                <input id="rc-label" className="input" maxLength={120} placeholder="e.g. Lincoln High — Ms. Ortiz" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="rc-days">Expires after</label>
                <select id="rc-days" className="input" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })}>
                  <option value={3}>3 days</option>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setForm(null)} className="btn-ghost flex-1">Cancel</button>
                <button onClick={create} className="btn-primary flex-1" disabled={busy}>{busy ? 'Creating…' : 'Create code'}</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {created && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-sm" role="dialog" aria-modal="true" aria-labelledby="rc-reveal-title">
            <h3 id="rc-reveal-title" className="font-semibold mb-1">
              {created.kind === 'organization' ? 'Organization' : 'School'} registration code
            </h3>
            <p className="text-sm text-earth-400 mb-4">
              Copy it now — <strong>you won&apos;t be able to see it again</strong>. It expires {new Date(created.expiresAt).toLocaleDateString()}.
            </p>
            <div className="rounded-xl bg-earth-100 dark:bg-earth-900 px-4 py-3 text-center font-mono text-lg tracking-wider select-all break-all">
              {created.code}
            </div>
            <p className="text-xs text-earth-400 mt-2">
              They enter it at <span className="font-mono">/{created.kind === 'organization' ? 'organization' : 'school'}/register</span>.
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={copy} className="btn-ghost flex-1">
                {copied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy</>}
              </button>
              <button onClick={() => setCreated(null)} className="btn-primary flex-1">Done</button>
            </div>
          </Card>
        </div>
      )}
    </Card>
  )
}
