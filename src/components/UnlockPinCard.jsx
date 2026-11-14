import { useState } from 'react'
import { Shield } from 'lucide-react'
import Card from '@/components/Card.jsx'
import PasswordInput from '@/components/PasswordInput.jsx'
import { useAuth } from '@/hooks/useAuth.jsx'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

// Unlock PIN (#871): a quicker way past the away lock (AwayLock.jsx). Kept
// hashed on the server; setting one needs the current password when the
// account has one. The password always still works.
export default function UnlockPinCard() {
  const { user, refreshUser } = useAuth()
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { text, ok }
  const hasPin = Boolean(user?.hasUnlockPin)
  const needsPassword = user?.hasPassword !== false

  const save = async (e) => {
    e.preventDefault()
    if (!/^[0-9]{4,8}$/.test(pin)) { setMsg({ text: tr('The PIN must be 4 to 8 digits.'), ok: false }); return }
    if (pin !== confirm) { setMsg({ text: tr("The two PINs don't match."), ok: false }); return }
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`${apiUrl}/auth/me/unlock-pin`, { method: 'PUT', headers: headers(), body: JSON.stringify({ pin, password }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || tr('Could not save the PIN.'))
      setPin(''); setConfirm(''); setPassword('')
      await refreshUser?.()
      setMsg({ text: tr('Unlock PIN saved.'), ok: true })
    } catch (err) { setMsg({ text: err.message, ok: false }) } finally { setBusy(false) }
  }

  const remove = async () => {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`${apiUrl}/auth/me/unlock-pin`, { method: 'DELETE', headers: headers() })
      if (!res.ok) throw new Error(tr('Could not remove the PIN.'))
      await refreshUser?.()
      setMsg({ text: tr('Unlock PIN removed.'), ok: true })
    } catch (err) { setMsg({ text: err.message, ok: false }) } finally { setBusy(false) }
  }

  return (
    <Card>
      <div className="flex items-center gap-2 mb-2">
        <Shield className="w-4 h-4 text-brand-600" aria-hidden="true" />
        <h3 className="font-display font-semibold">{tr('Unlock PIN')}</h3>
      </div>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
        {tr('After 5 minutes away, VolunTrack locks. Set a PIN to unlock it quickly instead of typing your password. After 5 wrong tries you are signed out.')}
      </p>
      {hasPin && <p className="text-sm mb-3 text-emerald-600 dark:text-emerald-400">{tr('An unlock PIN is set.')}</p>}
      <form onSubmit={save} className="space-y-3 max-w-sm">
        <div>
          <label htmlFor="unlock-pin" className="label">{hasPin ? tr('New PIN (4–8 digits)') : tr('PIN (4–8 digits)')}</label>
          <input id="unlock-pin" type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="input tracking-widest" />
        </div>
        <div>
          <label htmlFor="unlock-pin-confirm" className="label">{tr('Type the PIN again')}</label>
          <input id="unlock-pin-confirm" type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))} className="input tracking-widest" />
        </div>
        {needsPassword && (
          <div>
            <label htmlFor="unlock-pin-password" className="label">{tr('Current password')}</label>
            <PasswordInput id="unlock-pin-password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary btn-sm" disabled={busy || !pin || !confirm || (needsPassword && !password)}>{hasPin ? tr('Change PIN') : tr('Save PIN')}</button>
          {hasPin && <button type="button" onClick={remove} className="btn-ghost btn-sm" disabled={busy}>{tr('Remove PIN')}</button>}
        </div>
      </form>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm mt-3 ${msg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>{msg.text}</p>}
    </Card>
  )
}
