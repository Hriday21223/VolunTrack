import { useEffect, useRef, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth.jsx'
import { inTestSession, backToAdmin } from '@/lib/testSession.js'

// Shown while the admin is signed in as a live test account (#890): which
// account this is, and the way back to the admin's own session, which asks
// for the admin's test-account PIN (src/lib/testSession.js). Only the
// admin sees it, so it's in English like the admin page. It moves the page
// down by its own height (--test-banner, also read by the sticky header and
// side menu), so it never sits on top of a title or a form field.
export default function TestAccountBanner() {
  const { user, adoptSession, logout } = useAuth()
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [expired, setExpired] = useState(false)
  const barRef = useRef(null)
  const active = inTestSession(user)

  useEffect(() => {
    if (!active || !barRef.current) return undefined
    const height = `${barRef.current.offsetHeight}px`
    document.documentElement.style.setProperty('--test-banner', height)
    document.body.style.paddingTop = height
    return () => {
      document.documentElement.style.removeProperty('--test-banner')
      document.body.style.paddingTop = ''
    }
  }, [active])

  if (!active) return null

  const submit = async (e) => {
    e.preventDefault()
    if (!/^\d{6}$/.test(pin)) { setError('Enter your 6-digit PIN.'); return }
    setBusy(true)
    setError('')
    const result = await backToAdmin({ pin, adoptSession })
    if (result) { setError(result.error); setExpired(Boolean(result.expired)); setPin(''); setBusy(false) }
  }

  return (
    <div ref={barRef} role="status" className="fixed top-0 inset-x-0 z-[4000] bg-amber-400 text-amber-950 text-sm px-4 py-1.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 shadow">
      <FlaskConical className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="truncate">Test account: {user.email}</span>
      {!asking ? (
        <button type="button" onClick={() => setAsking(true)} className="underline font-semibold shrink-0">Back to admin</button>
      ) : (
        <form onSubmit={submit} className="flex items-center gap-2 shrink-0">
          <label htmlFor="back-to-admin-pin" className="font-semibold">Your test-account PIN</label>
          <input
            id="back-to-admin-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="w-24 rounded border border-amber-700/40 bg-white/80 px-2 py-0.5 tracking-widest text-amber-950"
          />
          <button type="submit" disabled={busy} className="underline font-semibold">{busy ? 'Checking…' : 'Go'}</button>
          <button type="button" onClick={() => { setAsking(false); setPin(''); setError('') }} className="underline">Cancel</button>
        </form>
      )}
      {error && (
        <span className="w-full text-center font-medium">
          {error}{' '}
          {expired && <button type="button" onClick={() => { logout(); window.location.assign('/login') }} className="underline font-semibold">Sign out</button>}
        </span>
      )}
    </div>
  )
}
