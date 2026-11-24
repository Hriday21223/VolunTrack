import { useCallback, useEffect, useState } from 'react'
import { FlaskConical, KeyRound } from 'lucide-react'
import Card from '@/components/Card.jsx'
import PasswordInput from '@/components/PasswordInput.jsx'
import { useAuth, ADMIN_RETURN_KEY } from '@/hooks/useAuth.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const base = `${apiUrl}/admin/test-accounts`
const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

const ROLE_LABELS = { student: 'Student', volunteer: 'Task Maker', parent: 'Parent', school: 'School adviser', org: 'Organization' }

// Admin → Users (#890): sign in as one of the five live test accounts to try
// each kind of account. Only those five; behind 2FA and a 6-digit PIN.
export default function TestAccountsCard() {
  const { adoptSession } = useAuth()
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)
  const [pin, setPin] = useState('')
  const [settingPin, setSettingPin] = useState(false)
  const [newPin, setNewPin] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { headers: authHeaders() })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not load the test accounts.')
      setInfo(d)
    } catch (err) { setError(err.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const savePin = async (e) => {
    e.preventDefault()
    setBusy('pin'); setError(null)
    try {
      const res = await fetch(`${base}/pin`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ pin: newPin, password }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not save the PIN.')
      setNewPin(''); setPassword(''); setSettingPin(false)
      await load()
    } catch (err) { setError(err.message) } finally { setBusy(null) }
  }

  const signIn = async (role) => {
    setBusy(role); setError(null)
    try {
      const res = await fetch(`${base}/sign-in`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ role, pin }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.token) {
        throw new Error(d.triesLeft ? `${d.error} ${d.triesLeft} ${d.triesLeft === 1 ? 'try' : 'tries'} left.` : (d.error || 'Could not sign in.'))
      }
      // Keep only the one-time return ticket, never the admin's own token:
      // "Back to admin" needs it and the PIN again (src/lib/testSession.js).
      localStorage.setItem(ADMIN_RETURN_KEY, d.returnTicket || '')
      adoptSession(d)
      window.location.assign('/')
    } catch (err) { setError(err.message); setPin(''); setBusy(null) }
  }

  const showPinForm = info && (!info.hasPin || settingPin)

  return (
    <Card>
      <h3 className="font-display font-semibold mb-1 flex items-center gap-2"><FlaskConical className="w-4 h-4" aria-hidden="true" /> Sign in as a test account</h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
        Try VolunTrack as each kind of account on the live site. This only opens the five live-…@test.com test accounts, never a real person’s account, and each use goes in the audit log. A test session lasts 2 hours; use “Back to admin” at the top, with this PIN, to return. Signing out of a test account signs you out fully.
      </p>
      {!info && !error && <p className="text-sm text-earth-400">Loading…</p>}
      {info && !info.secondStep && (
        <p className="text-sm text-amber-700 dark:text-amber-300 mb-3">Turn on two-step sign-in for your admin account (Settings) before using this.</p>
      )}
      {showPinForm ? (
        <form onSubmit={savePin} className="space-y-3 max-w-sm">
          <p className="text-sm font-medium flex items-center gap-1"><KeyRound className="w-4 h-4" aria-hidden="true" /> {info.hasPin ? 'Change your test-account PIN' : 'Set a 6-digit PIN first'}</p>
          <PasswordInput
            inputMode="numeric" autoComplete="off" maxLength={6} placeholder="6 digits"
            aria-label="New 6-digit PIN" value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your admin password" autoComplete="current-password" aria-label="Your admin password" />
          <div className="flex gap-2">
            <button type="submit" disabled={busy !== null || newPin.length !== 6 || !password} className="btn-primary btn-sm">{busy === 'pin' ? 'Saving…' : 'Save PIN'}</button>
            {info.hasPin && <button type="button" onClick={() => setSettingPin(false)} className="btn-ghost btn-sm">Cancel</button>}
          </div>
        </form>
      ) : info && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <PasswordInput
              wrapperClassName="w-40" inputMode="numeric" autoComplete="off" maxLength={6} placeholder="PIN"
              aria-label="Your 6-digit test-account PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <button type="button" onClick={() => setSettingPin(true)} className="text-xs text-earth-500 hover:underline">Change PIN</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {info.accounts.map((a) => (
              <button
                key={a.role} type="button" onClick={() => signIn(a.role)}
                disabled={busy !== null || pin.length !== 6 || !info.secondStep || info.lockedSeconds > 0}
                className="btn-secondary btn-sm" title={a.email}
              >
                {busy === a.role ? 'Signing in…' : ROLE_LABELS[a.role] || a.role}
              </button>
            ))}
          </div>
          {info.lockedSeconds > 0 && <p className="text-sm text-red-500">Locked after too many wrong PINs. Try again in {Math.ceil(info.lockedSeconds / 60)} minutes.</p>}
          {info.accounts.some((a) => !a.exists) && <p className="text-xs text-earth-400">The first sign-in creates the test accounts and the “Live Test School” club.</p>}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-500 mt-3">{error}</p>}
    </Card>
  )
}
