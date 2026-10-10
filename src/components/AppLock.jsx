import { useCallback, useEffect, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import { isNativeApp } from '@/lib/platform.js'
import { SESSION_KEY } from '@/hooks/useAuth.jsx'
import {
  loadKeptSession, unlockWithDevice, restoreSession, dropUnkeptSession, clearKeptSession,
} from '@/lib/appSession.js'

// How long the app may sit in the background before it asks again.
const RELOCK_AFTER_MS = 60 * 1000
const UNLOCK_FAILED = 'Couldn’t confirm it’s you. Try again, or sign out.'

/**
 * The apps' "Keep me signed in" gate (src/lib/appSession.js). On launch, a
 * kept session is restored only after Face ID / fingerprint / passcode — the
 * app isn't rendered until then, so nothing signed-in loads behind the lock.
 * Coming back after a minute in the background locks it again. On the
 * website this renders its children and nothing else.
 */
export default function AppLock({ children }) {
  const [phase, setPhase] = useState(isNativeApp ? 'starting' : 'open') // starting | locked | open
  const [relocked, setRelocked] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const kept = useRef(null)
  const backgroundedAt = useRef(0)

  const unlock = useCallback(async () => {
    setErr('')
    setBusy(true)
    try {
      await unlockWithDevice()
      if (kept.current && phase !== 'open') restoreSession(kept.current, SESSION_KEY)
      setRelocked(false)
      setPhase('open')
    } catch {
      setErr(UNLOCK_FAILED)
    } finally {
      setBusy(false)
    }
  }, [phase])

  // Launch: restore a kept session behind the device check, or end an unkept one.
  useEffect(() => {
    if (!isNativeApp) return
    let live = true
    loadKeptSession().then((session) => {
      if (!live) return
      if (!session) {
        dropUnkeptSession(SESSION_KEY)
        setPhase('open')
        return
      }
      kept.current = session
      setPhase('locked')
    })
    return () => { live = false }
  }, [])

  // Ask straight away rather than making them tap Unlock first.
  const asked = useRef(false)
  useEffect(() => {
    if (phase === 'locked' && !asked.current) { asked.current = true; unlock() }
  }, [phase, unlock])

  // Re-lock after time away.
  useEffect(() => {
    if (!isNativeApp) return
    let handle
    import('@capacitor/app').then(({ App }) =>
      App.addListener('appStateChange', async ({ isActive }) => {
        if (!isActive) { backgroundedAt.current = Date.now(); return }
        if (!backgroundedAt.current || Date.now() - backgroundedAt.current < RELOCK_AFTER_MS) return
        // Consume the timestamp before asking. Capacitor reports "inactive"
        // only on onStop but "active" on every onResume, and the system
        // prompt is translucent — it pauses the app without stopping it. Left
        // set, the return from the prompt (cancelled or passed) read as
        // another long absence and asked again, forever.
        backgroundedAt.current = 0
        if (!(await loadKeptSession())) return
        setErr('')
        setRelocked(true)
        unlockWithDevice().then(() => setRelocked(false)).catch(() => setErr(UNLOCK_FAILED))
      })).then((h) => { handle = h })
    return () => { handle?.remove() }
  }, [])

  const signOut = async () => {
    await clearKeptSession()
    dropUnkeptSession(SESSION_KEY)
    // A full reload so every provider starts signed out.
    window.location.replace('/')
  }

  if (phase === 'starting') return <div className="min-h-screen bg-[#071117]" />

  const lockScreen = (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#071117] px-8 text-center text-earth-100">
      <img src={`${import.meta.env.BASE_URL}app-icon.png`} alt="" className="h-20 w-20 rounded-2xl" />
      <div className="mt-6 flex items-center gap-2 text-lg font-semibold">
        <Lock className="h-5 w-5" /> VolunTrack is locked
      </div>
      <p className="mt-2 text-sm text-earth-400">Use Face ID, your fingerprint or your passcode to continue.</p>
      {err && <p className="mt-4 text-sm text-rose-300">{err}</p>}
      <button type="button" onClick={unlock} disabled={busy} className="btn-primary mt-8 w-full max-w-xs py-3">
        {busy ? 'Waiting…' : 'Unlock'}
      </button>
      <button type="button" onClick={signOut} className="mt-4 text-sm text-earth-400 underline">
        Sign out instead
      </button>
    </div>
  )

  if (phase === 'locked') return lockScreen
  return (
    <>
      {children}
      {relocked && lockScreen}
    </>
  )
}
