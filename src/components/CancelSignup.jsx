import { useState } from 'react'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// "Cancel sign-up" / "Leave waitlist", with an inline "are you sure" instead
// of a browser dialog. Cancelling frees the slot for the first person on the
// waitlist (DELETE /api/school/public-tasks/:id/signup).
export default function CancelSignup({ task, onDone, onError }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const status = task.my_signup_status || task.signup_status
  const waitlisted = status === 'waitlisted'
  // Nothing held a slot yet while a parent decides (or after they said no).
  const parentHeld = status === 'parent_pending' || status === 'parent_declined'
  const label = waitlisted ? tr('Leave waitlist') : status === 'parent_declined' ? tr('Remove') : tr('Cancel sign-up')

  const cancel = async () => {
    setBusy(true)
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${encodeURIComponent(task.id)}/signup`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` },
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not cancel.')
      onDone?.(waitlisted ? 'You left the waitlist.' : parentHeld ? tr('Sign-up removed.') : 'Sign-up cancelled. Your spot goes to the next person waiting.')
    } catch (e) {
      onError?.(e.message)
    } finally {
      setBusy(false)
      setAsking(false)
    }
  }

  if (!asking) {
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); setAsking(true) }} className="text-xs text-earth-500 hover:text-red-400 hover:underline">
        {label}
      </button>
    )
  }
  return (
    <span className="text-xs flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <span className="text-earth-400">{label}?</span>
      <button type="button" onClick={cancel} disabled={busy} className="text-red-400 font-medium hover:underline">{busy ? '…' : tr('Yes')}</button>
      <button type="button" onClick={() => setAsking(false)} disabled={busy} className="text-earth-400 hover:underline">{tr('No')}</button>
    </span>
  )
}
