import { useState } from 'react'
import { UserPlus, X } from 'lucide-react'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const MAX_INVITES = 5

// "Invite friends" on a task the student is going to (Opportunities and
// Attendance). POST /api/school/public-tasks/:id/invite emails each address
// once with a link back to the task; the server keeps only a hash of each
// address, caps it at five per task, and never says whether an address has
// an account.
export default function InviteFriends({ task, className = '' }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const emails = text.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean)

  const send = async (e) => {
    e.preventDefault()
    if (emails.length === 0) return
    if (emails.length > MAX_INVITES) { setError(tr('You can invite up to {n} friends at a time.', { n: MAX_INVITES })); return }
    setBusy(true)
    setError('')
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/public-tasks/${encodeURIComponent(task.id)}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ emails }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (typeof d.remaining === 'number') setResult((r) => ({ invited: r?.invited || 0, remaining: d.remaining }))
        throw new Error(d.error || tr('Something went wrong. Try again.'))
      }
      setResult((r) => ({ invited: (r?.invited || 0) + d.invited, remaining: d.remaining }))
      setText('')
    } catch (err) {
      setError(err.message)
    } finally { setBusy(false) }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        className={`inline-flex items-center gap-1 text-xs text-brand-400 hover:underline ${className}`}
      >
        <UserPlus className="w-3.5 h-3.5" />{' '}{tr('Invite friends')}
      </button>
    )
  }

  const remaining = result?.remaining ?? MAX_INVITES
  return (
    <form onSubmit={send} onClick={(e) => e.stopPropagation()} className={`rounded-xl border border-white/10 p-3 space-y-2 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium flex items-center gap-1.5"><UserPlus className="w-4 h-4 text-brand-400" />{tr('Invite friends')}</p>
        <button type="button" onClick={() => setOpen(false)} className="text-earth-500 hover:text-earth-300" aria-label={tr('Close')}>
          <X className="w-4 h-4" />
        </button>
      </div>
      {result && (
        <p className="text-xs text-emerald-400" role="status">
          {tr('Invited {n}.', { n: result.invited })}{' '}
          {remaining > 0 ? tr('You can invite {n} more.', { n: remaining }) : tr("That's the most for this task.")}
        </p>
      )}
      {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
      {remaining > 0 && (
        <>
          <label className="block text-xs text-earth-400" htmlFor={`invite-${task.id}`}>
            {tr("Friends' email addresses, separated by commas (up to {n})", { n: remaining })}
          </label>
          <input
            id={`invite-${task.id}`}
            type="text"
            inputMode="email"
            autoComplete="off"
            value={text}
            onChange={(e) => { setText(e.target.value); setError('') }}
            placeholder={tr('friend@example.com, another@example.com')}
            className="input text-sm w-full"
          />
          <p className="text-xs text-earth-500">{tr("We email each friend once with a link to this task, and don't keep their address.")}</p>
          <button type="submit" disabled={busy || emails.length === 0} className="btn-primary btn-sm">
            {busy ? tr('Sending…') : tr('Send')}
          </button>
        </>
      )}
    </form>
  )
}
