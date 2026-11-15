import { useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { useAuth, ADMIN_RETURN_KEY } from '@/hooks/useAuth.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function readReturnToken() {
  try { return localStorage.getItem(ADMIN_RETURN_KEY) || null } catch { return null }
}

// Shown while the admin is signed in as a live test account (#890): which
// account this is, and the way back to the admin's own session. Only the
// admin sees it, so it's in English like the admin page.
export default function TestAccountBanner() {
  const { user, adoptSession, logout } = useAuth()
  const [busy, setBusy] = useState(false)
  const returnToken = readReturnToken()
  if (!user || !returnToken || !String(user.email || '').endsWith('@test.com')) return null

  const back = async () => {
    setBusy(true)
    try {
      const res = await fetch(`${apiUrl}/auth/me`, { headers: { Authorization: `Bearer ${returnToken}` } })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d?.user?.role !== 'admin') throw new Error('expired')
      localStorage.removeItem(ADMIN_RETURN_KEY)
      adoptSession({ token: returnToken, user: d.user })
      window.location.assign('/admin/users')
    } catch {
      // The admin session ran out meanwhile: sign out and sign in again.
      logout()
      window.location.assign('/login')
    }
  }

  return (
    <div role="status" className="fixed top-0 inset-x-0 z-[4000] bg-amber-400 text-amber-950 text-sm px-4 py-1.5 flex items-center justify-center gap-3 shadow">
      <FlaskConical className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="truncate">Test account: {user.email}</span>
      <button type="button" onClick={back} disabled={busy} className="underline font-semibold shrink-0">
        {busy ? 'Going back…' : 'Back to admin'}
      </button>
    </div>
  )
}
