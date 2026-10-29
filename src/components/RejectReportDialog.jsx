import { useState } from 'react'
import { XCircle, X } from 'lucide-react'

// Common reasons a school sends back a report a student submitted (#583).
// Picking one fills the box, which stays editable.
const QUICK_REASONS = [
  'A supervisor signature is missing.',
  "The hours don't match what you logged.",
  'Some entries are from a different school year.',
  'Some entries are hard to read. Please add more detail.',
]

// Reject a submitted report, saying why. The reason goes to the student
// (bell and email) and shows on their Reports page.
export default function RejectReportDialog({ report, onClose, onReject }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const send = async (e) => {
    e.preventDefault()
    const text = reason.trim()
    if (!text) { setError('Say why, so the student can fix it.'); return }
    setBusy(true)
    setError('')
    try {
      await onReject(text)
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
      aria-labelledby="reject-report-title"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose?.() }}
    >
      <form onSubmit={send} className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f1813] p-5 text-white shadow-soft space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="reject-report-title" className="font-display font-semibold text-lg flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-400" /> Send this report back
            </h2>
            <p className="text-sm text-earth-400 mt-0.5 truncate">{report.user_name ? `${report.user_name} · ` : ''}{report.filename}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost p-1" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => { setReason(r); setError('') }}
              className={`text-xs rounded-full border px-3 py-1.5 text-left ${reason === r ? 'border-brand-400 bg-brand-500/20' : 'border-white/15 hover:border-white/30'}`}
            >
              {r}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="text-sm font-medium">Why are you sending it back?</span>
          <textarea
            className="input mt-1 min-h-[90px] text-sm"
            maxLength={500}
            value={reason}
            onChange={(e) => { setReason(e.target.value); setError('') }}
            placeholder="The student sees this, so say what to fix."
            autoFocus
          />
        </label>
        {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost flex-1">Cancel</button>
          <button type="submit" disabled={busy} className="btn-danger flex-1">{busy ? 'Sending…' : 'Send back'}</button>
        </div>
      </form>
    </div>
  )
}
