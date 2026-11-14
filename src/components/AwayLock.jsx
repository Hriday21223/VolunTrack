import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Lock } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth.jsx'
import { isNativeApp } from '@/lib/platform.js'
import { loadKeptSession } from '@/lib/appSession.js'
import PasswordInput from '@/components/PasswordInput.jsx'
import { tr } from '@/lib/i18n.js'

// Away lock (#869). When every VolunTrack tab has been out of sight (another
// tab or app, or the computer asleep) for AWAY_MS, the app covers itself and
// asks for the password again, then the account's second step if it has one.
// The page underneath keeps its state, so a half-filled form survives.
//
// Shared across tabs through localStorage: a visible tab writes LAST_KEY every
// HEARTBEAT_MS, any tab coming back reads it, and LOCK_KEY locks or unlocks
// every tab at once (the `storage` event). LAST_KEY carries the end of the
// session token, so a fresh sign-in never inherits an old "last seen" and is
// locked straight away. Server sessions only; a local-only account has no
// password on the server to check.
export const AWAY_MS = 5 * 60 * 1000
const HEARTBEAT_MS = 30 * 1000
const LAST_KEY = 'voluntrack:last-active'
const LOCK_KEY = 'voluntrack:away-locked'

const token = () => localStorage.getItem('voluntrack:auth_token') || ''
const tokenTag = () => token().slice(-16)

function readLast() {
  try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null') } catch { return null }
}
function markActive() {
  try { localStorage.setItem(LAST_KEY, JSON.stringify({ tag: tokenTag(), at: Date.now() })) } catch { /* private mode */ }
}
function lockedFlag() {
  try { return localStorage.getItem(LOCK_KEY) === tokenTag() } catch { return false }
}
function setLockedFlag(on) {
  try { if (on) localStorage.setItem(LOCK_KEY, tokenTag()); else localStorage.removeItem(LOCK_KEY) } catch { /* private mode */ }
}

export default function AwayLock() {
  const { user, reauth, verifyTotp, verifyPasskey, sendEmailCode, verifyEmailCode, logout } = useAuth()
  const [enabled, setEnabled] = useState(false)
  const [locked, setLocked] = useState(false)
  const [step, setStep] = useState('password') // password | pin | second | noPassword
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [code, setCode] = useState('')
  const [second, setSecond] = useState(null) // { tempToken, methods, emailSent }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  // Only for a server session. In the phone app a "Keep me signed in" session
  // is already relocked by Face ID / fingerprint after a minute (AppLock).
  useEffect(() => {
    let live = true
    if (!user || !token()) { setEnabled(false); return }
    if (!isNativeApp) { setEnabled(true); return }
    loadKeptSession().then((kept) => { if (live) setEnabled(!kept) })
    return () => { live = false }
  }, [user])

  const lock = useCallback(() => {
    setLockedFlag(true)
    setLocked(true)
    setStep(user?.hasUnlockPin ? 'pin' : 'password'); setPassword(''); setPin(''); setCode(''); setSecond(null); setError('')
  }, [user?.hasUnlockPin])

  // Is it time to lock? Called on load and whenever a tab comes back.
  const check = useCallback(() => {
    if (lockedFlag()) { if (!locked) lock(); return }
    const last = readLast()
    if (last && last.tag === tokenTag() && Date.now() - last.at >= AWAY_MS) { lock(); return }
    markActive()
  }, [locked, lock])

  useEffect(() => {
    if (!enabled) { setLocked(false); return }
    check()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') check()
      else if (!lockedFlag()) markActive() // the moment it was last seen
    }
    // Another tab locked or unlocked.
    const onStorage = (e) => {
      if (e.key !== LOCK_KEY) return
      if (lockedFlag()) lock()
      else { setLocked(false); markActive() }
    }
    const beat = setInterval(() => {
      if (document.visibilityState === 'visible' && !lockedFlag()) markActive()
    }, HEARTBEAT_MS)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', check)
    window.addEventListener('storage', onStorage)
    return () => {
      clearInterval(beat)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', check)
      window.removeEventListener('storage', onStorage)
    }
  }, [enabled, check, lock])

  useEffect(() => { if (locked) setTimeout(() => inputRef.current?.focus(), 50) }, [locked, step])

  // While locked, the app behind can't be reached: `inert` takes it out of
  // tab order, clicks and screen readers. The lock itself renders outside
  // #root (a portal), above every dialog the app can open — a PDF preview,
  // a volunteer badge or a check-in QR left open must not show through.
  // Every other child of <body> is made inert, so a dialog that portals out
  // of #root (the check-in scanner) is covered too.
  const lockRef = useRef(null)
  useEffect(() => {
    if (!enabled || !locked) return
    const others = [...document.body.children].filter((el) => el !== lockRef.current && !el.hasAttribute('inert'))
    for (const el of others) { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true') }
    return () => { for (const el of others) { el.removeAttribute('inert'); el.removeAttribute('aria-hidden') } }
  }, [enabled, locked])

  const unlocked = () => {
    setLockedFlag(false)
    markActive() // the new session token's tag
    setLocked(false)
    setPassword(''); setCode(''); setSecond(null); setError('')
  }

  const signOut = async () => {
    setLockedFlag(false)
    await logout()
    window.location.assign('/login')
  }

  const submitPassword = async (e) => {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true); setError('')
    try {
      const r = await reauth(password)
      if (r.noPassword) setStep('noPassword')
      else if (r.requiresTotp) {
        setSecond({ tempToken: r.tempToken, methods: r.methods })
        setStep('second')
        // An emailed code is the only second step: send it straight away.
        if (r.methods.length === 1 && r.methods[0] === 'email') {
          await sendEmailCode(r.tempToken)
          setSecond({ tempToken: r.tempToken, methods: r.methods, emailSent: true })
        }
      }
      else unlocked()
    } catch (err) {
      failed(err)
      setPassword('')
    } finally { setBusy(false) }
  }

  const failed = (err) => {
    if (err.signOut) {
      setError(tr('Too many wrong tries, so we signed you out.'))
      setTimeout(signOut, 1500)
    } else if (err.triesLeft != null) {
      // Name the PIN only to someone who has one.
      const n = err.triesLeft
      setError(user?.hasUnlockPin
        ? (n === 1 ? tr('Wrong PIN or password. 1 try left.') : tr('Wrong PIN or password. {n} tries left.', { n }))
        : (n === 1 ? tr('Wrong password. 1 try left.') : tr('Wrong password. {n} tries left.', { n })))
    } else {
      setError(err.message)
    }
  }

  // Unlock PIN (#871): stands in for the password and second step.
  const submitPin = async (e) => {
    e.preventDefault()
    if (!pin || busy) return
    setBusy(true); setError('')
    try { await reauth(null, { pin }); unlocked() } catch (err) { failed(err) } finally { setPin(''); setBusy(false) }
  }

  const submitCode = async (e) => {
    e.preventDefault()
    if (!code.trim() || busy) return
    setBusy(true); setError('')
    try {
      if (second.emailSent) await verifyEmailCode(second.tempToken, code.trim())
      else await verifyTotp(second.tempToken, code.trim())
      unlocked()
    } catch (err) { setError(err.message); setCode('') } finally { setBusy(false) }
  }

  const tryPasskey = async () => {
    setBusy(true); setError('')
    try { await verifyPasskey(second.tempToken); unlocked() } catch { setError(tr('Passkey check was cancelled.')) } finally { setBusy(false) }
  }

  const emailCode = async () => {
    setBusy(true); setError('')
    try { await sendEmailCode(second.tempToken); setSecond((s) => ({ ...s, emailSent: true })); setCode('') } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  if (!enabled || !locked) return null
  const methods = second?.methods || []

  return createPortal(
    <div ref={lockRef} role="dialog" aria-modal="true" aria-labelledby="away-lock-title" className="fixed inset-0 z-[5000] flex items-center justify-center bg-[#071117] px-4">
      <div className="w-full max-w-sm text-center text-earth-100">
        <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="" className="h-11 w-11 object-contain" />
        </span>
        <h2 id="away-lock-title" className="flex items-center justify-center gap-2 text-lg font-semibold">
          <Lock className="h-5 w-5" aria-hidden="true" />{' '}{tr('You were away for a while')}
        </h2>
        {user?.email && <p className="mt-1 text-sm text-earth-400">{user.email}</p>}

        {step === 'pin' && (
          <form onSubmit={submitPin} className="mt-5 space-y-3 text-left">
            <p className="text-sm text-earth-300 text-center">{tr('Enter your unlock PIN to keep going. Your page is just as you left it.')}</p>
            <label htmlFor="away-lock-pin" className="label">{tr('Unlock PIN')}</label>
            <input id="away-lock-pin" type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="input text-center tracking-[0.5em]" />
            <button type="submit" className="btn-primary w-full py-3" disabled={busy || pin.length < 4}>{busy ? tr('Checking…') : tr('Unlock')}</button>
            <button type="button" onClick={() => { setStep('password'); setError('') }} className="btn-ghost w-full">{tr('Use your password instead')}</button>
          </form>
        )}

        {step === 'password' && (
          <form onSubmit={submitPassword} className="mt-5 space-y-3 text-left">
            <p className="text-sm text-earth-300 text-center">{tr('Enter your password to keep going. Your page is just as you left it.')}</p>
            <label htmlFor="away-lock-password" className="label">{tr('Password')}</label>
            <PasswordInput id="away-lock-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="input" />
            <button type="submit" className="btn-primary w-full py-3" disabled={busy || !password}>{busy ? tr('Checking…') : tr('Unlock')}</button>
            {user?.hasUnlockPin && (
              <button type="button" onClick={() => { setStep('pin'); setError('') }} className="btn-ghost w-full">{tr('Use your PIN instead')}</button>
            )}
          </form>
        )}

        {step === 'second' && (
          <div className="mt-5 space-y-3 text-left">
            {(methods.includes('totp') || second?.emailSent) && (
              <form onSubmit={submitCode} className="space-y-3">
                <p className="text-sm text-earth-300 text-center">
                  {second?.emailSent ? tr('We emailed you a 6-digit code. Enter it to finish signing in.') : tr('Enter the 6-digit code from your authenticator app')}
                </p>
                <label htmlFor="away-lock-code" className="label">{second?.emailSent ? tr('Email code') : tr('Authenticator code')}</label>
                <input id="away-lock-code" ref={inputRef} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={12} className="input text-center tracking-widest" />
                <button type="submit" className="btn-primary w-full py-3" disabled={busy || !code.trim()}>{busy ? tr('Checking…') : tr('Verify')}</button>
              </form>
            )}
            {methods.includes('passkey') && (
              <button type="button" onClick={tryPasskey} className="btn-secondary w-full py-3" disabled={busy}>{busy ? tr('Waiting for passkey…') : tr('Use passkey')}</button>
            )}
            {methods.includes('email') && !second?.emailSent && (
              <button type="button" onClick={emailCode} className="btn-ghost w-full" disabled={busy}>{tr('Email me a code')}</button>
            )}
          </div>
        )}

        {step === 'noPassword' && (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-earth-300">{tr("You signed in with Google, Apple or your school, so there's no password to enter here. Sign in again to keep going.")}</p>
            <button type="button" onClick={signOut} className="btn-primary w-full py-3">{tr('Sign in again')}</button>
          </div>
        )}

        {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
        {step !== 'noPassword' && (
          <button type="button" onClick={signOut} className="mt-5 text-sm text-earth-400 underline">{tr('Sign out instead')}</button>
        )}
      </div>
    </div>,
    document.body,
  )
}
