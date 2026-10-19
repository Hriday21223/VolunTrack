import { useState } from 'react'
import { Flag, X } from 'lucide-react'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// Same keys as REPORT_REASONS in server/routes/reports.js.
const REASONS = [
  ['unsafe', 'Unsafe or inappropriate'],
  ['spam', 'Spam or a scam'],
  ['misleading', 'Misleading or not a real event'],
  ['other', 'Something else'],
]

// Report a volunteer task, and optionally block its organizer (App Store
// guideline 1.2). Blocking hides all of that organizer's tasks and stops
// their messages; it can be undone in Settings → Blocked organizers.
export default function ReportTaskDialog({ task, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [block, setBlock] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const send = async (e) => {
    e.preventDefault()
    if (!reason) { setError('Choose a reason.'); return }
    setBusy(true)
    setError('')
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ taskId: task.id, reason, details, block }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not send the report.')
      onDone?.({ blocked: block })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-title"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose?.() }}
    >
      <form onSubmit={send} className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f1813] p-5 text-white shadow-soft space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="report-title" className="font-display font-semibold text-lg flex items-center gap-2"><Flag className="w-4 h-4 text-red-400" /> Report this task</h2>
            <p className="text-sm text-earth-400 mt-0.5">{task.title}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost p-1" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium mb-1">What's wrong?</legend>
          {REASONS.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="report-reason" value={key} checked={reason === key} onChange={() => setReason(key)} />
              {label}
            </label>
          ))}
        </fieldset>

        <div>
          <label className="label" htmlFor="report-details">Anything else we should know? (optional)</label>
          <textarea id="report-details" className="input min-h-[80px] resize-y" maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
        </div>

        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input type="checkbox" className="mt-1" checked={block} onChange={(e) => setBlock(e.target.checked)} />
          <span>Also block this organizer — you won't see their tasks or get their messages. You can undo this in Settings.</span>
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}
        <p className="text-xs text-earth-500">VolunTrack reviews reports within 24 hours. The organizer isn't told who reported.</p>

        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="btn-danger flex-1">{busy ? 'Sending…' : 'Send report'}</button>
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost flex-1">Cancel</button>
        </div>
      </form>
    </div>
  )
}
