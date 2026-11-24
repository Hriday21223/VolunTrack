import { ADMIN_RETURN_KEY } from '@/hooks/useAuth.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// True while the admin is signed in as a live test account (#890). What's
// kept on the device is a one-time return ticket, never the admin's own
// session: getting back into admin needs the ticket AND the admin's PIN,
// checked by the server (POST /api/test-return).
export function inTestSession(user) {
  if (!user || !String(user.email || '').endsWith('@test.com')) return false
  try { return Boolean(localStorage.getItem(ADMIN_RETURN_KEY)) } catch { return false }
}

/**
 * Back to the admin's own session with the test-account PIN.
 * Resolves to null on success (the page moves to /admin/users), or to
 * { error, expired } to show beside the PIN box.
 */
export async function backToAdmin({ pin, adoptSession }) {
  let ticket = null
  try { ticket = localStorage.getItem(ADMIN_RETURN_KEY) } catch { /* storage blocked */ }
  const token = localStorage.getItem('voluntrack:auth_token')
  try {
    const res = await fetch(`${apiUrl}/test-return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ ticket, pin }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok || d?.user?.role !== 'admin' || !d.token) {
      if (d.lockedSeconds) return { error: `Too many wrong PINs. Try again in ${Math.ceil(d.lockedSeconds / 60)} min, or sign out.` }
      if (d.triesLeft) return { error: `Wrong PIN. ${d.triesLeft} ${d.triesLeft === 1 ? 'try' : 'tries'} left.` }
      return { error: d.error || 'Could not go back to admin.', expired: Boolean(d.expired) || res.status === 401 }
    }
    localStorage.removeItem(ADMIN_RETURN_KEY)
    adoptSession({ token: d.token, user: d.user })
    window.location.assign('/admin/users')
    return null
  } catch {
    return { error: 'Could not reach the server. Try again.' }
  }
}
