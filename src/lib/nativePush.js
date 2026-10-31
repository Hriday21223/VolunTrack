// Phone push in the Android and iOS apps (#603), with @capacitor/push-notifications.
//
//  - Permission is asked only when the person taps "Turn on" in Settings →
//    Notifications, never at launch (CLAUDE.md: native permissions on tap).
//  - The device token goes to POST /api/push/devices and is kept here
//    (voluntrack:push-token) so sign-out can remove it from the server.
//  - Tapping a notification opens its in-app link, routed like the widget's
//    voluntrack:// links (only plain paths).
//
// Never resolve a promise to the plugin object itself: the Capacitor proxy
// throws on the `.then` probe. load() returns the module.
import { Capacitor } from '@capacitor/core'
import { isNativeApp } from '@/lib/platform.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const TOKEN_KEY = 'voluntrack:push-token'

const load = () => import('@capacitor/push-notifications')

function read(key) { try { return localStorage.getItem(key) } catch { return null } }
function write(key, value) { try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value) } catch { /* storage blocked */ } }

function authHeaders() {
  const token = read('voluntrack:auth_token')
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

// The Android app crashes on register() without Firebase's google-services.json,
// so phone push is offered only in builds made with VITE_NATIVE_PUSH=1 (set in
// .env.app once that file and the iOS push capability are in place).
export const nativePushSupported = () => isNativeApp && import.meta.env.VITE_NATIVE_PUSH === '1'
export const nativePushOn = () => Boolean(read(TOKEN_KEY))

function openLink(link) {
  const path = String(link || '/')
  if (!/^\/[\w\-/?=&.%]*$/.test(path) || path.startsWith('//')) return
  if (window.location.pathname + window.location.search === path) return
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

async function sendToken(token) {
  const res = await fetch(`${apiUrl}/push/devices`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ token, platform: Capacitor.getPlatform() }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Could not turn on notifications.')
  }
  write(TOKEN_KEY, token)
}

// Resolves with the token from the next 'registration' event.
async function registerForToken() {
  const { PushNotifications } = await load()
  return new Promise((resolve, reject) => {
    const handles = []
    const finish = (fn, value) => { handles.forEach((h) => h.remove()); fn(value) }
    Promise.all([
      PushNotifications.addListener('registration', (t) => finish(resolve, t.value)),
      PushNotifications.addListener('registrationError', (e) => finish(reject, new Error(e?.error || 'Could not turn on notifications.'))),
    ]).then((hs) => { handles.push(...hs); return PushNotifications.register() }).catch(reject)
    setTimeout(() => finish(reject, new Error('The phone did not answer. Try again.')), 20_000)
  })
}

/** From the "Turn on" tap: asks permission, registers, tells the server. */
export async function enableNativePush() {
  if (!nativePushSupported()) throw new Error('Phone notifications aren’t set up in this version of the app yet.')
  const { PushNotifications } = await load()
  let perm = await PushNotifications.checkPermissions()
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions()
  if (perm.receive !== 'granted') throw new Error('Notifications are off for VolunTrack. Turn them on in your phone’s settings, then try again.')
  await sendToken(await registerForToken())
}

/** Turns phone push off for this install (and forgets the token on the server). */
export async function disableNativePush() {
  const token = read(TOKEN_KEY)
  write(TOKEN_KEY, null)
  if (token) {
    await fetch(`${apiUrl}/push/devices`, { method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ token }) }).catch(() => {})
  }
  try { (await load()).PushNotifications.unregister() } catch { /* older plugin or not registered */ }
}

/**
 * At app start: route notification taps, and if push was turned on before,
 * refresh the token quietly (permission is already granted, so no prompt).
 */
export async function startNativePush() {
  if (!nativePushSupported()) return
  try {
    const { PushNotifications } = await load()
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const data = action?.notification?.data || {}
      openLink(data.link)
    })
    if (!nativePushOn() || !read('voluntrack:auth_token')) return
    const perm = await PushNotifications.checkPermissions()
    if (perm.receive !== 'granted') return
    const token = await registerForToken()
    if (token !== read(TOKEN_KEY)) await sendToken(token)
  } catch { /* push is a nice-to-have; never block start-up */ }
}

/** On sign-out: remove this install's token while the old session still works. */
export function forgetNativePushOnSignOut() {
  const token = read(TOKEN_KEY)
  if (!token) return
  const headers = authHeaders()
  write(TOKEN_KEY, null)
  fetch(`${apiUrl}/push/devices`, { method: 'DELETE', headers, body: JSON.stringify({ token }) }).catch(() => {})
}
