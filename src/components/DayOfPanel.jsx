import { useState } from 'react'
import { MapPin, Phone, Clock3, XCircle } from 'lucide-react'
import { format } from 'date-fns'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const ETAS = [10, 20, 30]

// "Running late (~20 min)" — 30 means "30 or more".
export function lateLabel(eta) {
  if (eta == null) return tr('Running late')
  return tr('Running late (~{n} min)', { n: Number(eta) >= 30 ? '30+' : eta })
}

// Day-of details on an Attendance row (#438). The server sends the meeting
// point and contact only to approved volunteers; on the task's own day (the
// viewer's local date) they also get "Running late" and "Can't make it".
// "Can't make it" is the ordinary cancel, so the waitlist moves up.
export default function DayOfPanel({ task, onDone, onError }) {
  const [mode, setMode] = useState(null) // null | 'late' | 'cancel'
  const [busy, setBusy] = useState(false)
  const approved = task.signup_status === 'approved' && task.task_status !== 'cancelled'
  const today = String(task.date || '').slice(0, 10) === format(new Date(), 'yyyy-MM-dd')
  const isLate = Boolean(task.late_at)
  if (!approved) return null
  const hasDetails = task.meeting_point || task.day_of_contact
  const showButtons = today && !task.attendance_status
  if (!hasDetails && !showButtons) return null

  const post = async (path, body) => {
    setBusy(true)
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${encodeURIComponent(task.id)}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` },
        body: JSON.stringify(body || {}),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || tr('Something went wrong.'))
      setMode(null)
      return true
    } catch (e) {
      onError?.(e.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const sendLate = async (eta) => {
    if (await post('running-late', { etaMinutes: eta })) onDone?.(tr('The organizer knows you are running late.'))
  }
  const cantMakeIt = async () => {
    if (await post('cant-make-it')) onDone?.(tr('Sign-up cancelled. The organizer has been told, and your spot goes to the next person waiting.'))
  }

  return (
    <div className="mt-3 p-3 rounded-xl bg-brand-500/5 border border-brand-500/20 space-y-2 text-sm">
      {task.meeting_point && (
        <p className="flex items-start gap-2">
          <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-brand-400" aria-hidden="true" />
          <span><span className="text-earth-400">{tr('Meeting point')}:</span>{' '}<span className="break-words">{task.meeting_point}</span></span>
        </p>
      )}
      {task.day_of_contact && (
        <p className="flex items-start gap-2">
          <Phone className="w-4 h-4 mt-0.5 shrink-0 text-brand-400" aria-hidden="true" />
          <span><span className="text-earth-400">{tr('Day-of contact')}:</span>{' '}<span className="break-words">{task.day_of_contact}</span></span>
        </p>
      )}
      {showButtons && (
        <div className="pt-1 space-y-2">
          {isLate && (
            <p className="text-xs text-amber-400 flex items-center gap-1"><Clock3 className="w-3.5 h-3.5" aria-hidden="true" />{' '}{lateLabel(task.late_eta_minutes)}</p>
          )}
          {mode === null && (
            <div className="flex flex-wrap gap-2">
              {!task.checked_in_at && (
                <button type="button" className="btn-sm btn-ghost" onClick={() => setMode('late')} disabled={busy}>
                  <Clock3 className="w-4 h-4" aria-hidden="true" />{' '}{isLate ? tr('Change my ETA') : tr('Running late')}
                </button>
              )}
              <button type="button" className="btn-sm btn-ghost text-red-400" onClick={() => setMode('cancel')} disabled={busy}>
                <XCircle className="w-4 h-4" aria-hidden="true" />{' '}{tr("Can't make it")}
              </button>
            </div>
          )}
          {mode === 'late' && (
            <div className="space-y-2">
              <p className="text-xs text-earth-400">{tr('About how late? The organizer gets a notification.')}</p>
              <div className="flex flex-wrap gap-2">
                {ETAS.map((n) => (
                  <button key={n} type="button" className="btn-sm btn-ghost" disabled={busy} onClick={() => sendLate(n)}>
                    {n === 30 ? tr('30+ min') : tr('{n} min', { n })}
                  </button>
                ))}
                <button type="button" className="btn-sm btn-ghost" disabled={busy} onClick={() => sendLate(null)}>{tr('Not sure')}</button>
                <button type="button" className="btn-sm btn-ghost text-earth-400" disabled={busy} onClick={() => setMode(null)}>{tr('Cancel')}</button>
              </div>
            </div>
          )}
          {mode === 'cancel' && (
            <div className="space-y-2">
              <p className="text-xs text-earth-400">{tr("This cancels your sign-up and tells the organizer. Your spot goes to the next person waiting.")}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-sm btn-ghost text-red-400" disabled={busy} onClick={cantMakeIt}>{busy ? '…' : tr("Yes, I can't make it")}</button>
                <button type="button" className="btn-sm btn-ghost" disabled={busy} onClick={() => setMode(null)}>{tr('Keep my spot')}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
