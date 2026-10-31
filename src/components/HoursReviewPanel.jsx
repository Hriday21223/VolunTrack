import { useCallback, useEffect, useState } from 'react'
import { CheckCircle, XCircle, MapPin, AlertTriangle, ClipboardCheck } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { fmtDate } from '@/utils/date.js'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const auth = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

// Common reasons to send an entry back; picking one fills the box.
const QUICK_REASONS = [
  tr('This place isn\'t on our approved list.'),
  tr('Please add a supervisor who can confirm these hours.'),
  tr('The hours look too high for this activity.'),
  tr('Please describe what you did in more detail.'),
]

// Students → Hours to check (#591): entries no supervisor or organizer has
// confirmed. Entries from a place not on the school's approved list come
// first and are marked. Approve one or several; send one back with a reason.
export default function HoursReviewPanel({ onSetPlaces }) {
  const [data, setData] = useState(null)
  const [show, setShow] = useState('all')
  const [error, setError] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState(null)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await fetch(`${apiUrl}/school/hours-review?show=${show}`, { headers: auth() })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not load the hours to check.')
      setData(d)
      setPicked(new Set())
    } catch (e) {
      setError(e.message)
    }
  }, [show])

  useEffect(() => { load() }, [load])

  const approve = async (ids) => {
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch(`${apiUrl}/school/hours-review-approve`, { method: 'POST', headers: auth(), body: JSON.stringify({ ids }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not approve.')
      setMessage(`${d.approved} approved.${d.skipped ? ` ${d.skipped} had already been decided.` : ''} Each student was told.`)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const sendBack = async () => {
    if (!reason.trim()) { setError(tr('Say why, so the student can fix it.')); return }
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/school/hours-review/${encodeURIComponent(rejecting.id)}`, {
        method: 'POST', headers: auth(), body: JSON.stringify({ decision: 'reject', note: reason.trim() }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not send it back.')
      setMessage(`Sent back to ${rejecting.student_name}. Those hours don't count until they fix the entry.`)
      setRejecting(null)
      setReason('')
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const entries = data?.entries || []
  const allPicked = entries.length > 0 && entries.every((e) => picked.has(e.id))
  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <Card>
      <h3 className="font-semibold mb-1 flex items-center gap-2"><ClipboardCheck className="w-4 h-4 text-brand-600" />{' '}{tr('Hours to check')}</h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">
        {tr('Entries no supervisor or event organizer has confirmed. They count for now; approve them, or send one back with a reason and it stops counting until the student fixes it.')}
      </p>
      {data && (
        <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
          <button type="button" className={`btn-sm ${show === 'all' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShow('all')}>{tr('All ({n})', { n: data.counts.unconfirmed })}</button>
          {data.hasPlaceList && (
            <button type="button" className={`btn-sm ${show === 'offlist' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShow('offlist')}>
              <AlertTriangle className="w-3.5 h-3.5 mr-1" />{' '}{tr('Not an approved place ({n})', { n: data.counts.offList })}
            </button>
          )}
          {!data.hasPlaceList && onSetPlaces && (
            <button type="button" className="text-xs text-brand-500 underline" onClick={onSetPlaces}>{tr('Set your approved places')}</button>
          )}
        </div>
      )}
      {message && <p className="text-sm text-emerald-600 dark:text-emerald-400 mb-2" role="status">{message}</p>}
      {error && <p className="text-sm text-red-500 mb-2" role="alert">{error}</p>}
      {!data && !error && <p className="text-sm text-earth-400">{tr('Loading…')}</p>}
      {data && entries.length === 0 && <p className="text-sm text-earth-500 py-4 text-center">{tr('Nothing to check. 🎉')}</p>}
      {entries.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(entries.map((e) => e.id)))} />
              {tr('Select all shown')}
            </label>
            <button type="button" className="btn-primary btn-sm" disabled={busy || picked.size === 0} onClick={() => approve([...picked].slice(0, 100))}>
              <CheckCircle className="w-4 h-4 mr-1" />{' '}{tr('Approve')}{' '}{picked.size || ''}
            </button>
          </div>
          <ul className="space-y-2">
            {entries.map((e) => (
              <li key={e.id} className={`rounded-xl border p-3 text-sm ${e.offList ? 'border-amber-400/60 bg-amber-500/5' : 'border-earth-200 dark:border-white/10'}`}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1" checked={picked.has(e.id)} onChange={() => toggle(e.id)} aria-label={`Select ${e.student_name}'s entry`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{e.student_name}{e.grade ? <span className="text-earth-500 font-normal"> · {tr('Grade {grade}', { grade: e.grade })}</span> : null}</p>
                    <p>{e.activity || tr('Untitled')} · <strong>{e.hours}h</strong> · {fmtDate(e.date)}</p>
                    <p className={`flex items-center gap-1 text-xs ${e.offList ? 'text-amber-700 dark:text-amber-300' : 'text-earth-500 dark:text-earth-400'}`}>
                      <MapPin className="w-3 h-3" /> {e.org_name || tr('No place given')}{e.offList ? ` · ${tr('not on your approved list')}` : ''}
                    </p>
                    {e.notes && <p className="text-xs text-earth-500 dark:text-earth-400 mt-1 line-clamp-3">{e.notes}</p>}
                    <p className="text-xs text-earth-400 mt-1">
                      {e.verification_status === 'pending' ? `Waiting on supervisor${e.supervisor_name ? ` ${e.supervisor_name}` : ''}` : e.supervisor_name ? `Supervisor: ${e.supervisor_name} (not asked to confirm)` : tr('No supervisor given')}
                      {e.has_proof ? ` · ${tr('proof attached')}` : ''}
                    </p>
                  </div>
                </div>
                {rejecting?.id === e.id ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_REASONS.map((r) => (
                        <button key={r} type="button" onClick={() => setReason(r)} className={`text-xs rounded-full border px-2.5 py-1 text-left ${reason === r ? 'border-brand-400 bg-brand-500/15' : 'border-earth-300 dark:border-white/15'}`}>{r}</button>
                      ))}
                    </div>
                    <textarea className="input text-sm min-h-[70px]" maxLength={500} placeholder={tr('What should the student fix? They see this.')} value={reason} onChange={(ev) => setReason(ev.target.value)} autoFocus />
                    <div className="flex gap-2">
                      <button type="button" className="btn-ghost btn-sm" onClick={() => { setRejecting(null); setReason('') }} disabled={busy}>{tr('Cancel')}</button>
                      <button type="button" className="btn-danger btn-sm" onClick={sendBack} disabled={busy}>{busy ? tr('Sending…') : tr('Send back')}</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex gap-2 justify-end">
                    <button type="button" className="btn-ghost btn-sm text-red-500" onClick={() => { setRejecting(e); setReason(e.offList ? QUICK_REASONS[0] : ''); setError('') }} disabled={busy}>
                      <XCircle className="w-4 h-4 mr-1" />{' '}{tr('Send back')}
                    </button>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => approve([e.id])} disabled={busy}>
                      <CheckCircle className="w-4 h-4 mr-1" />{' '}{tr('Approve')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {data.truncated && <p className="text-xs text-earth-400 mt-2">{tr('Showing the first 200. Approve or send back some to see more.')}</p>}
        </>
      )}
    </Card>
  )
}
