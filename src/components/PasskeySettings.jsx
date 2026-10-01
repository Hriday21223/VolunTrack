import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Trash2 } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { fmtDate } from '@/utils/date.js'
import {
  passkeysAvailable, addPasskey, listPasskeys, removePasskey, defaultPasskeyName, isPasskeyCancel,
} from '@/lib/passkey.js'

/**
 * Passkeys as a second sign-in step (server/routes/passkeys.js). Works the
 * same on the website and in the apps; a passkey saved to iCloud Keychain or
 * Google Password Manager follows the user to their other devices.
 */
export default function PasskeySettings() {
  const token = localStorage.getItem('voluntrack:auth_token')
  const [supported, setSupported] = useState(null)
  const [passkeys, setPasskeys] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [removing, setRemoving] = useState(null) // passkey id awaiting password
  const [password, setPassword] = useState('')

  const load = useCallback(async () => {
    try { setPasskeys(await listPasskeys(token)) } catch (e) { setErr(e.message) }
  }, [token])

  useEffect(() => {
    passkeysAvailable().then(setSupported)
    load()
  }, [load])

  const onAdd = async () => {
    setErr(''); setMsg(''); setBusy(true)
    try {
      await addPasskey(token, defaultPasskeyName())
      setMsg('Passkey added. You can use it the next time you sign in.')
      await load()
    } catch (e) {
      if (!isPasskeyCancel(e)) setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const onRemove = async (e) => {
    e.preventDefault()
    setErr(''); setMsg(''); setBusy(true)
    try {
      await removePasskey(token, removing, password)
      setRemoving(null); setPassword('')
      setMsg('Passkey removed.')
      await load()
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <h3 className="font-display font-semibold mb-3 flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-brand-600" /> Passkeys
      </h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
        After your password, confirm it’s you with Face ID, Touch ID, your fingerprint or your
        device PIN instead of typing a code. Keep your authenticator app too — its backup codes are
        how you get back in if you lose every device with a passkey.
      </p>

      {passkeys.length > 0 && (
        <ul className="mb-4 divide-y divide-earth-200/60 dark:divide-white/10 rounded-xl border border-earth-200/60 dark:border-white/10">
          {passkeys.map((p) => (
            <li key={p.id} className="p-3">
              <div className="flex items-center gap-3">
                <KeyRound className="w-4 h-4 text-earth-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-xs text-earth-500 dark:text-earth-400">
                    Added {fmtDate(p.createdAt)}{p.lastUsedAt ? ` · last used ${fmtDate(p.lastUsedAt)}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setRemoving(p.id); setPassword(''); setErr('') }}
                  className="btn-ghost p-2"
                  aria-label={`Remove ${p.name}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              {removing === p.id && (
                <form onSubmit={onRemove} className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="password"
                    required
                    autoComplete="current-password"
                    placeholder="Your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input flex-1"
                  />
                  <button type="submit" className="btn-primary" disabled={busy}>Remove</button>
                  <button type="button" className="btn-ghost" onClick={() => setRemoving(null)}>Cancel</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {supported === false ? (
        <p className="text-sm text-earth-500 dark:text-earth-400">This device can’t create passkeys.</p>
      ) : (
        <button type="button" onClick={onAdd} disabled={busy || supported === null} className="btn-primary">
          {busy && !removing ? 'Waiting for passkey…' : 'Add a passkey'}
        </button>
      )}
      {msg && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{msg}</p>}
      {err && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{err}</p>}
    </Card>
  )
}
