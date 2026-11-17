import { useCallback, useEffect, useState } from 'react'
import { PartyPopper, Plus, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react'
import Card from '@/components/Card.jsx'
import useEscapeKey from '@/hooks/useEscapeKey.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const base = `${apiUrl}/registration-codes/admin/event`
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

// A suggestion from the team member's name and the event: "Alex" + "Fall Fair
// 2026" → ALEXFALLFA26. The admin can change it.
function suggestCode(member, event) {
  const clean = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const digits = (String(event || '').match(/\d{2}(?!.*\d)/) || [''])[0]
  return (clean(member).slice(0, 6) + clean(event).replace(/\d/g, '').slice(0, 6) + digits).slice(0, 16)
}

const AUDIENCE_LABEL = { school: 'Schools', organization: 'Organizations', both: 'Schools & organizations' }

function gives(c) {
  const parts = []
  if (c.trialDays) parts.push(`${c.trialDays}-day free trial`)
  if (c.percentOff) parts.push(`${c.percentOff}% off first invoice`)
  if (c.clubUpgrade) parts.push('free club upgrade')
  return parts.join(' + ')
}

// Admin Invites tab: event codes (#907). One code per team member for an
// event, used by many schools, so the admin sees who brought in whom.
export default function EventCodesPanel() {
  const [codes, setCodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(null)
  const [open, setOpen] = useState(null)
  useEscapeKey(() => setForm(null), Boolean(form))

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { headers: authHeaders() })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not load codes.')
      setCodes(data.codes || [])
      setErr('')
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const newForm = () => setForm({ teamMember: '', eventName: '', code: '', codeEdited: false, audience: 'both', trialDays: '30', percentOff: '', clubUpgrade: true, maxUses: '', expiresInDays: '30' })
  const update = (patch) => setForm((f) => {
    const next = { ...f, ...patch }
    if (!next.codeEdited && ('teamMember' in patch || 'eventName' in patch)) next.code = suggestCode(next.teamMember, next.eventName)
    return next
  })

  const create = async () => {
    setBusy(true); setErr('')
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          teamMember: form.teamMember, eventName: form.eventName, code: form.code, audience: form.audience,
          trialDays: Number(form.trialDays) || null, percentOff: form.percentOff === '' ? null : Number(form.percentOff),
          clubUpgrade: form.audience !== 'organization' && form.clubUpgrade,
          maxUses: form.maxUses === '' ? null : Number(form.maxUses), expiresInDays: form.expiresInDays === '' ? null : Number(form.expiresInDays),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not create the code.')
      setForm(null)
      load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const setActive = async (id, active) => {
    await fetch(`${base}/${id}/active`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ active }) })
    load()
  }

  const copy = async (code) => {
    try { await navigator.clipboard.writeText(code); setCopied(code) } catch { /* selectable on screen */ }
  }

  const expired = (c) => c.expiresAt && new Date(c.expiresAt) < new Date()
  const full = (c) => c.maxUses != null && c.uses >= c.maxUses

  return (
    <Card padded={false} className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold flex items-center gap-2"><PartyPopper className="w-4 h-4 text-brand-400" /> Event codes</h2>
          <p className="text-sm text-earth-400 mt-0.5">
            For an event: one code per team member, which many schools can use. It can give a free trial, a discount on the first invoice and a free club upgrade. A school or organization can sign up with it, and a free club can upgrade with it. Each school still gets one free trial.
          </p>
        </div>
        <button onClick={newForm} className="btn-sm btn-primary shrink-0">
          <Plus className="w-3.5 h-3.5 mr-1" /> New code
        </button>
      </div>

      {err && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg mb-3">{err}</div>}

      {loading ? (
        <p className="text-sm text-earth-400 py-4 text-center">Loading codes…</p>
      ) : codes.length === 0 ? (
        <p className="text-sm text-earth-400 py-4 text-center">No event codes yet.</p>
      ) : (
        <ul className="divide-y divide-earth-200 dark:divide-earth-800">
          {codes.map((c) => (
            <li key={c.id} className="py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium flex flex-wrap items-center gap-2">
                    <span className="font-mono">{c.code}</span>
                    <button onClick={() => copy(c.code)} className="text-earth-400 hover:text-earth-200" aria-label={`Copy ${c.code}`}>
                      {copied === c.code ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <span>{c.teamMember}</span>
                    {c.eventName && <span className="text-earth-400">· {c.eventName}</span>}
                    {(!c.active || expired(c) || full(c)) && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-earth-500/15 text-earth-300">{!c.active ? 'Turned off' : expired(c) ? 'Expired' : 'All used'}</span>
                    )}
                  </p>
                  <p className="text-xs text-earth-500">
                    {gives(c)} · {AUDIENCE_LABEL[c.audience]} · Used {c.uses}{c.maxUses != null ? ` of ${c.maxUses}` : ''}
                    {c.expiresAt ? ` · Expires ${new Date(c.expiresAt).toLocaleDateString()}` : ''}
                  </p>
                </div>
                {c.usedBy.length > 0 && (
                  <button onClick={() => setOpen(open === c.id ? null : c.id)} className="text-xs text-earth-400 hover:text-earth-200 inline-flex items-center gap-1">
                    Who used it {open === c.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                )}
                <button onClick={() => setActive(c.id, !c.active)} className={`text-xs ${c.active ? 'text-red-400 hover:text-red-300' : 'text-brand-400 hover:text-brand-300'}`}>
                  {c.active ? 'Turn off' : 'Turn on'}
                </button>
              </div>
              {open === c.id && (
                <ul className="mt-2 ml-1 space-y-1 text-xs text-earth-400">
                  {c.usedBy.map((u, i) => (
                    <li key={i}>{u.name || 'Deleted account'} · {u.entityType === 'organization' ? 'organization' : 'school'} · {u.kind === 'upgrade' ? 'upgraded a club' : 'signed up'} · {new Date(u.usedAt).toLocaleDateString()}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {form && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setForm(null)}>
          <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="ec-new-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="ec-new-title" className="font-semibold mb-3">New event code</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="ec-member">Team member</label>
                  <input id="ec-member" className="input" maxLength={80} placeholder="e.g. Alex" value={form.teamMember} onChange={(e) => update({ teamMember: e.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor="ec-event">Event <span className="text-earth-400 font-normal">(optional)</span></label>
                  <input id="ec-event" className="input" maxLength={120} placeholder="e.g. Fall Fair 26" value={form.eventName} onChange={(e) => update({ eventName: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="ec-code">Code</label>
                <input id="ec-code" className="input font-mono uppercase tracking-wider" maxLength={16} value={form.code} onChange={(e) => update({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''), codeEdited: true })} />
                <p className="text-xs text-earth-400 mt-1">6–16 letters and numbers. People type this, so keep it easy to say.</p>
              </div>
              <div>
                <label className="label" htmlFor="ec-aud">Who can use it</label>
                <select id="ec-aud" className="input" value={form.audience} onChange={(e) => update({ audience: e.target.value })}>
                  <option value="both">Schools and organizations</option>
                  <option value="school">Schools only</option>
                  <option value="organization">Organizations only</option>
                </select>
              </div>
              <fieldset className="space-y-2">
                <legend className="label">What it gives</legend>
                <div className="flex items-center gap-2">
                  <label className="text-sm w-28" htmlFor="ec-trial">Free trial</label>
                  <select id="ec-trial" className="input flex-1" value={form.trialDays} onChange={(e) => update({ trialDays: e.target.value })}>
                    <option value="">None</option>
                    <option value="14">14 days</option>
                    <option value="30">1 month (30 days)</option>
                    <option value="60">2 months (60 days)</option>
                    <option value="90">3 months (90 days)</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm w-28" htmlFor="ec-off">Discount %</label>
                  <input id="ec-off" className="input flex-1" inputMode="decimal" placeholder="None (e.g. 20)" value={form.percentOff} onChange={(e) => update({ percentOff: e.target.value.replace(/[^0-9.]/g, '') })} />
                </div>
                <label className={`flex items-center gap-2 text-sm ${form.audience === 'organization' ? 'opacity-50' : ''}`}>
                  <input type="checkbox" disabled={form.audience === 'organization'} checked={form.audience !== 'organization' && form.clubUpgrade} onChange={(e) => update({ clubUpgrade: e.target.checked })} />
                  Free clubs can upgrade to a school plan with it
                </label>
              </fieldset>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="ec-max">Most uses <span className="text-earth-400 font-normal">(optional)</span></label>
                  <input id="ec-max" className="input" inputMode="numeric" placeholder="No limit" value={form.maxUses} onChange={(e) => update({ maxUses: e.target.value.replace(/\D/g, '') })} />
                </div>
                <div>
                  <label className="label" htmlFor="ec-exp">Expires after</label>
                  <select id="ec-exp" className="input" value={form.expiresInDays} onChange={(e) => update({ expiresInDays: e.target.value })}>
                    <option value="7">7 days</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="365">1 year</option>
                    <option value="">Never</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setForm(null)} className="btn-ghost flex-1">Cancel</button>
                <button onClick={create} className="btn-primary flex-1" disabled={busy || !form.teamMember.trim() || form.code.length < 6}>{busy ? 'Creating…' : 'Create code'}</button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </Card>
  )
}
