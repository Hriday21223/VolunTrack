import { useCallback, useEffect, useMemo, useState } from 'react'
import { Quote, Send, Trash2, Globe } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { fmtDate } from '@/utils/date.js'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const token = () => { try { return localStorage.getItem('voluntrack:auth_token') } catch { return null } }
const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` })
const day = (iso) => fmtDate(new Date(iso).toLocaleDateString('en-CA'))

// Reports → References (#593): ask someone who saw you volunteer for a short
// written reference, see who answered, read what they wrote, and choose which
// ones show on your public portfolio (only those the writer agreed to share).
// `logs` gives suggestions: the supervisors and places in your entries.
export default function ReferencesCard({ logs = [], notify }) {
  const [refs, setRefs] = useState(null)
  const [asking, setAsking] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', organization: '', message: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)

  const load = useCallback(async () => {
    if (!token()) { setRefs([]); return }
    try {
      const res = await fetch(`${apiUrl}/references/mine`, { headers: headers() })
      const d = await res.json().catch(() => ({}))
      setRefs(res.ok ? d.references || [] : [])
    } catch { setRefs([]) }
  }, [])
  useEffect(() => { load() }, [load])

  // People from your own entries: a supervisor with an email on this device.
  const suggestions = useMemo(() => {
    const seen = new Map()
    for (const l of logs) {
      const email = String(l.supervisorEmail || '').trim().toLowerCase()
      if (!email || seen.has(email)) continue
      seen.set(email, { name: l.supervisorName || '', email, organization: l.orgName || '' })
    }
    return [...seen.values()].slice(0, 6)
  }, [logs])
  const places = useMemo(() => [...new Set(logs.map((l) => String(l.orgName || '').trim()).filter(Boolean))].slice(0, 30), [logs])

  if (!token() || refs === null) return null

  const send = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/references`, { method: 'POST', headers: headers(), body: JSON.stringify(form) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || tr('Could not send the request.'))
      notify?.(tr('Request sent to {name}.', { name: form.name }))
      setForm({ name: '', email: '', organization: '', message: '' })
      setAsking(false)
      load()
    } catch (err) {
      setError(err.message)
    } finally { setBusy(false) }
  }

  const remove = async (r) => {
    try {
      await fetch(`${apiUrl}/references/${encodeURIComponent(r.id)}`, { method: 'DELETE', headers: headers() })
      load()
    } catch { /* stays listed; nothing else to do */ }
  }

  const togglePortfolio = async (r) => {
    try {
      const res = await fetch(`${apiUrl}/references/${encodeURIComponent(r.id)}`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ onPortfolio: !r.onPortfolio }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error)
      load()
    } catch (err) { notify?.(err.message || tr('Could not save that.')) }
  }

  const statusText = (r) => (r.status === 'written' ? '' : r.status === 'declined' ? tr("Can't write one right now") : r.expired ? tr('No answer (link expired)') : tr('Waiting for their answer'))

  return (
    <Card className="mb-6">
      <h3 className="font-semibold mb-1 flex items-center gap-2"><Quote className="w-4 h-4 text-brand-600" />{' '}{tr('References')}</h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">
        {tr('Ask a supervisor or organizer who saw you volunteer to write a few lines about it, for college and scholarship applications. They get an email link and don’t need an account.')}
      </p>

      {refs.length > 0 && (
        <ul className="space-y-2 mb-3">
          {refs.map((r) => (
            <li key={r.id} className="rounded-xl border border-earth-200 dark:border-white/10 p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{r.writerName}{r.writerTitle ? <span className="font-normal text-earth-500">, {r.writerTitle}</span> : null}</p>
                  <p className="text-xs text-earth-500 dark:text-earth-400">
                    {r.organization ? `${r.organization} · ` : ''}{r.status === 'written' ? tr('Written {date}', { date: day(r.writtenAt) }) : `${statusText(r)} · ${tr('asked {date}', { date: day(r.askedAt) })}`}
                  </p>
                </div>
                <button type="button" className="btn-ghost p-1.5 shrink-0" onClick={() => remove(r)} aria-label={r.status === 'pending' ? tr('Cancel request') : tr('Remove')} title={r.status === 'pending' ? tr('Cancel request') : tr('Remove')}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              {r.status === 'written' && (
                <>
                  <p className={`mt-2 whitespace-pre-line text-earth-700 dark:text-earth-200 ${open === r.id ? '' : 'line-clamp-4'}`}>{r.text}</p>
                  {r.text.length > 240 && (
                    <button type="button" className="text-xs text-brand-500 underline mt-1" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? tr('Show less') : tr('Read all')}</button>
                  )}
                  {r.shareable ? (
                    <label className="flex items-center gap-2 mt-2 text-xs">
                      <input type="checkbox" checked={Boolean(r.onPortfolio)} onChange={() => togglePortfolio(r)} />
                      <Globe className="w-3.5 h-3.5" />{' '}{tr('Show on my public portfolio')}
                    </label>
                  ) : (
                    <p className="text-xs text-earth-500 dark:text-earth-400 mt-2">{tr('Only for you: the writer didn’t agree to share it publicly.')}</p>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {!asking ? (
        <button type="button" className="btn-secondary w-full" onClick={() => setAsking(true)}>
          <Send className="w-4 h-4" />{' '}{tr('Ask for a reference')}
        </button>
      ) : (
        <form onSubmit={send} className="space-y-3">
          {suggestions.length > 0 && (
            <div>
              <p className="text-xs text-earth-500 dark:text-earth-400 mb-1">{tr('From your entries:')}</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button key={s.email} type="button" className="chip" onClick={() => setForm((f) => ({ ...f, ...s }))}>{s.name || s.email}{s.organization ? ` · ${s.organization}` : ''}</button>
                ))}
              </div>
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-sm">{tr('Their name')}
              <input className="input mt-1" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="block text-sm">{tr('Their email')}
              <input className="input mt-1" type="email" required maxLength={254} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
          </div>
          <label className="block text-sm">{tr('Where you volunteered with them')}
            <input className="input mt-1" list="reference-places" maxLength={120} value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} />
            <datalist id="reference-places">{places.map((p) => <option key={p} value={p} />)}</datalist>
          </label>
          <label className="block text-sm">{tr('A note to them (optional)')}
            <textarea className="input mt-1 min-h-[80px]" maxLength={600} placeholder={tr('e.g. I’m applying for a scholarship in March. Thank you for having me at the food bank!')} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          </label>
          {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn-ghost flex-1" onClick={() => { setAsking(false); setError('') }} disabled={busy}>{tr('Cancel')}</button>
            <button type="submit" className="btn-primary flex-1" disabled={busy}>{busy ? tr('Sending…') : tr('Send request')}</button>
          </div>
        </form>
      )}
    </Card>
  )
}
