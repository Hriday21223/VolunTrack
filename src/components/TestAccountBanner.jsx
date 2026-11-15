import { useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth.jsx'
import { inTestSession, backToAdmin } from '@/lib/testSession.js'

// Shown while the admin is signed in as a live test account (#890): which
// account this is, and the way back to the admin's own session. Only the
// admin sees it, so it's in English like the admin page.
export default function TestAccountBanner() {
  const { user, adoptSession, logout } = useAuth()
  const [busy, setBusy] = useState(false)
  if (!inTestSession(user)) return null

  const back = () => { setBusy(true); backToAdmin({ adoptSession, logout }) }

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
