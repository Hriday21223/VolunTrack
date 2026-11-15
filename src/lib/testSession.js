import { ADMIN_RETURN_KEY } from '@/hooks/useAuth.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// True while the admin is signed in as a live test account (#890): the
// admin's own token is waiting to come back.
export function inTestSession(user) {
  if (!user || !String(user.email || '').endsWith('@test.com')) return false
  try { return Boolean(localStorage.getItem(ADMIN_RETURN_KEY)) } catch { return false }
}

// Leaves the test account for the admin's own session. Every sign-out button
// does this in a test session, so signing out never drops the admin session
// too. If the admin session ran out meanwhile, it signs out fully instead.
// (The away lock still signs out fully: someone at an unattended computer
// mustn't get the admin session back without a password.)
export async function backToAdmin({ adoptSession, logout }) {
  let token = null
  try { token = localStorage.getItem(ADMIN_RETURN_KEY) } catch { /* storage blocked */ }
  try {
    if (!token) throw new Error('none')
    const res = await fetch(`${apiUrl}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
    const d = await res.json().catch(() => ({}))
    if (!res.ok || d?.user?.role !== 'admin') throw new Error('expired')
    localStorage.removeItem(ADMIN_RETURN_KEY)
    adoptSession({ token, user: d.user })
    window.location.assign('/admin/users')
  } catch {
    logout()
    window.location.assign('/login')
  }
}
