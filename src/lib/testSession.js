import { ADMIN_RETURN_KEY } from '@/hooks/useAuth.jsx'

// True while the admin is signed in as a live test account (#890): the
// admin's own token is waiting to come back. Sign-out buttons are hidden
// then, because signing out would drop the admin session too; the banner's
// "Back to admin" is the way out.
export function inTestSession(user) {
  if (!user || !String(user.email || '').endsWith('@test.com')) return false
  try { return Boolean(localStorage.getItem(ADMIN_RETURN_KEY)) } catch { return false }
}
