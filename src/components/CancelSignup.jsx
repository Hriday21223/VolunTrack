import { useState } from 'react'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// "Cancel sign-up" / "Leave waitlist", with an inline "are you sure" instead
// of a browser dialog. Cancelling frees the slot for the first person on the
// waitlist (DELETE /api/school/public-tasks/:id/signup).
export default function CancelSignup({ task, onDone, onError }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const waitlisted = (task.my_signup_status || task.signup_status) === 'waitlisted'
  const label = waitlisted ? 'Leave waitlist' : 'Cancel sign-up'

  const cancel = async () => {
    setBusy(true)
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${encodeURIComponent(task.id)}/signup`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` },
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not cancel.')
      onDone?.(waitlisted ? 'You left the waitlist.' : 'Sign-up cancelled. Your spot goes to the next person waiting.')
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
      <button type="button" onClick={cancel} disabled={busy} className="text-red-400 font-medium hover:underline">{busy ? '…' : 'Yes'}</button>
      <button type="button" onClick={() => setAsking(false)} disabled={busy} className="text-earth-400 hover:underline">No</button>
    </span>
  )
}
