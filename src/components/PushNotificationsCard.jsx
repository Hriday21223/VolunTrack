import { useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { tr } from '@/lib/i18n.js'
import { isNativeApp } from '@/lib/platform.js'
import { nativePushOn, enableNativePush, disableNativePush, nativePushSupported } from '@/lib/nativePush.js'
import { pushSupported, getPushConfig, currentSubscription, enablePush, disablePush } from '@/lib/push.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

const GROUPS = [
  { key: 'hours', label: () => tr('Hours and reports'), help: () => tr('Hours approved or sent back, report decisions, reaching your goal, references.') },
  { key: 'tasks', label: () => tr('Volunteer tasks'), help: () => tr('Sign-ups approved, a waitlist spot, new tasks, answers, thank-you notes.') },
  { key: 'family', label: () => tr('Family'), help: () => tr('Cheers from a parent, and tasks waiting for a parent’s OK.') },
  { key: 'reminders', label: () => tr('Reminders'), help: () => tr('Deadlines coming up and reminders to log hours.') },
]

function headers() {
  let token = null
  try { token = localStorage.getItem('voluntrack:auth_token') } catch { /* storage blocked */ }
  return token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } : null
}

// Settings → Notifications (#603): turn on push for this phone or browser, and
// choose which kinds of notice are pushed. The bell keeps everything either way.
export default function PushNotificationsCard() {
  const [state, setState] = useState(null) // { prefs, available }
  const [deviceOn, setDeviceOn] = useState(false)
  const [webKey, setWebKey] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const h = headers()
    if (!h) return
    let live = true
    fetch(`${apiUrl}/push/prefs`, { headers: h })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d) setState(d) })
      .catch(() => {})
    if (isNativeApp) setDeviceOn(nativePushOn())
    else if (pushSupported()) {
      getPushConfig().then((c) => live && setWebKey(c.publicKey))
      currentSubscription().then((s) => live && setDeviceOn(Boolean(s))).catch(() => {})
    }
    return () => { live = false }
  }, [])

  if (!state) return null
  const canDevice = isNativeApp ? (state.available.native && nativePushSupported()) : (state.available.web && pushSupported() && webKey)

  const toggleDevice = async () => {
    setBusy(true)
    setError('')
    try {
      if (deviceOn) {
        if (isNativeApp) await disableNativePush(); else await disablePush()
        setDeviceOn(false)
      } else {
        if (isNativeApp) await enableNativePush(); else await enablePush(webKey)
        setDeviceOn(true)
      }
    } catch (e) {
      setError(tr(e.message))
    } finally {
      setBusy(false)
    }
  }

  const toggleGroup = async (key) => {
    const next = !state.prefs[key]
    setState((s) => ({ ...s, prefs: { ...s.prefs, [key]: next } }))
    try {
      const r = await fetch(`${apiUrl}/push/prefs`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ [key]: next }) })
      if (!r.ok) throw new Error()
    } catch {
      setState((s) => ({ ...s, prefs: { ...s.prefs, [key]: !next } }))
      setError(tr('Could not save your notification settings.'))
    }
  }

  return (
    <Card>
      <h3 className="font-display font-semibold mb-1 flex items-center gap-2"><BellRing className="w-4 h-4 text-brand-600" />{' '}{tr('Push notifications')}</h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">
        {isNativeApp
          ? tr('Get a notification on this phone when something happens, even when VolunTrack is closed.')
          : tr('Get a notification from this browser when something happens, even when VolunTrack is closed.')}
      </p>
      {canDevice ? (
        <button type="button" className={deviceOn ? 'btn-ghost' : 'btn-primary'} onClick={toggleDevice} disabled={busy}>
          {busy ? tr('Saving…') : deviceOn
            ? (isNativeApp ? tr('Turn off on this phone') : tr('Turn off in this browser'))
            : (isNativeApp ? tr('Turn on for this phone') : tr('Turn on for this browser'))}
        </button>
      ) : (
        <p className="text-xs text-earth-500">{tr('Push notifications aren’t available here yet. Everything still shows in the bell.')}</p>
      )}
      {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
      <div className="mt-4 space-y-3">
        <p className="text-xs font-medium text-earth-500 uppercase tracking-wide">{tr('What to send')}</p>
        {GROUPS.map((g) => (
          <label key={g.key} className="flex items-start justify-between gap-3 cursor-pointer">
            <span>
              <span className="text-sm font-medium block">{g.label()}</span>
              <span className="text-xs text-earth-500 dark:text-earth-400">{g.help()}</span>
            </span>
            <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={state.prefs[g.key]} onChange={() => toggleGroup(g.key)} />
          </label>
        ))}
      </div>
    </Card>
  )
}
