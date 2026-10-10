// "Keep me signed in" for the native apps, locked behind the device's own
// unlock (Face ID / Touch ID / fingerprint, falling back to the passcode).
//
// The session token lives in the platform's secure storage (iOS Keychain,
// Android Keystore-encrypted prefs) via @capgo/capacitor-native-biometric —
// not in the WebView's localStorage. At launch, AppLock asks the user to
// unlock, then copies it into localStorage so the rest of the app, which
// reads the token from there, is unchanged. A session signed in *without*
// the box ticked isn't kept: it ends when the app is closed.
//
// The device check is a gate in front of a token the server already
// trusts, not a second factor — on a rooted or jailbroken phone it can be
// hooked. What it guarantees is that someone picking up an unlocked-but-idle
// phone, or a borrowed one, can't open VolunTrack as its owner.
//
// No-ops on the website.

import { isNativeApp } from '@/lib/platform.js'

const STORE_KEY = 'voluntrack.session'
const AUTH_TOKEN_KEY = 'voluntrack:auth_token'

// What the sign-in page chose for the session now being established.
// null = no choice made this launch (e.g. a restored session).
let keepChoice = null
export function setKeepSignedIn(keep) { keepChoice = !!keep }

// Returns the module, never the plugin object itself: a Capacitor plugin is a
// proxy that throws on any method it doesn't implement — including the
// `.then` an async function's return value is probed for — so resolving a
// promise *to* the plugin crashes ("NativeBiometric.then() is not implemented").
const biometric = () => import('@capgo/capacitor-native-biometric')

/**
 * Whether this device has a lock the app can require — biometrics or at
 * least a passcode. Without one, "Keep me signed in" would protect nothing.
 */
export async function deviceLockAvailable() {
  if (!isNativeApp) return false
  try {
    return (await (await biometric()).NativeBiometric.isAvailable({ useFallback: true })).isAvailable
  } catch {
    return false
  }
}

/** Ask for Face ID / Touch ID / fingerprint, or the device passcode. */
export async function unlockWithDevice() {
  const { NativeBiometric, BiometryType } = await biometric()
  await NativeBiometric.verifyIdentity({
    reason: 'Unlock VolunTrack',
    title: 'Unlock VolunTrack',
    subtitle: 'Confirm it’s you to continue',
    useFallback: true,
    // Android: biometrics plus the device PIN/pattern/password.
    allowedBiometryTypes: [
      BiometryType.FINGERPRINT,
      BiometryType.FACE_AUTHENTICATION,
      BiometryType.IRIS_AUTHENTICATION,
      BiometryType.DEVICE_CREDENTIAL,
    ],
  })
}

export async function loadKeptSession() {
  if (!isNativeApp) return null
  try {
    const { value } = await (await biometric()).NativeBiometric.getData({ key: STORE_KEY })
    const parsed = value ? JSON.parse(value) : null
    return parsed?.token && parsed?.user ? parsed : null
  } catch {
    return null
  }
}

async function saveKeptSession(session) {
  await (await biometric()).NativeBiometric.setData({ key: STORE_KEY, value: JSON.stringify(session) })
}

export async function clearKeptSession() {
  if (!isNativeApp) return
  try { await (await biometric()).NativeBiometric.deleteData({ key: STORE_KEY }) } catch { /* nothing kept */ }
}

/**
 * Called whenever the signed-in user changes (see AuthProvider). Keeps the
 * secure copy in step: saved when the user chose to stay signed in,
 * refreshed when their profile changes, removed on sign-out or when they
 * signed in without the box ticked.
 */
export async function syncKeptSession(user) {
  if (!isNativeApp) return
  if (!user) { await clearKeptSession(); return }
  const token = localStorage.getItem(AUTH_TOKEN_KEY)
  if (!token) return
  if (keepChoice === false) { await clearKeptSession(); return }
  if (keepChoice === true || (await loadKeptSession())) {
    try { await saveKeptSession({ token, user }) } catch { /* stays signed in for this launch only */ }
  }
}

/**
 * At launch, before anything reads the session: a session in localStorage
 * that wasn't kept is ended, so an unticked sign-in doesn't outlive the app.
 * A kept one is restored by AppLock only after the device unlock.
 */
export function dropUnkeptSession(sessionKey) {
  if (!isNativeApp) return
  localStorage.removeItem(AUTH_TOKEN_KEY)
  localStorage.removeItem(sessionKey)
}

export function restoreSession(session, sessionKey) {
  localStorage.setItem(AUTH_TOKEN_KEY, session.token)
  localStorage.setItem(sessionKey, JSON.stringify(session.user))
  keepChoice = true
}
