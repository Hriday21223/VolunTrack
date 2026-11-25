// Passkeys as a second sign-in step (server/routes/passkeys.js).
//
// The website uses the browser's WebAuthn API. The apps can't — their page
// origin is https://localhost / capacitor://localhost, which can't own a
// passkey — so they go through the native passkey APIs via
// @capgo/capacitor-passkey, naming the website's origin, which the site's
// /.well-known association files vouch for. Both paths send the server the
// same JSON.

import { isNativeApp } from '@/lib/platform.js'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// The relying-party origin the apps claim. Must be the site the passkeys
// belong to (WEBAUTHN_RP_ID on the server) and serve the association files.
const SITE_ORIGIN = (() => {
  try { return new URL(import.meta.env.VITE_SITE_URL || '').origin } catch { return null }
})()

// The module, not the plugin: resolving a promise to a Capacitor plugin
// proxy probes its `.then`, which the proxy throws on.
const passkeyModule = () => import('@capgo/capacitor-passkey')

/** Whether this device can use a passkey at all. */
export async function passkeysAvailable() {
  if (isNativeApp) {
    if (!SITE_ORIGIN) return false
    try { return (await (await passkeyModule()).CapacitorPasskey.isSupported()).available } catch { return false }
  }
  return typeof window !== 'undefined' && !!window.PublicKeyCredential
}

async function createCredential(optionsJSON) {
  if (isNativeApp) {
    return (await passkeyModule()).CapacitorPasskey.createCredential({ origin: SITE_ORIGIN, publicKey: optionsJSON })
  }
  const { startRegistration } = await import('@simplewebauthn/browser')
  return startRegistration({ optionsJSON })
}

async function getCredential(optionsJSON) {
  if (isNativeApp) {
    return (await passkeyModule()).CapacitorPasskey.getCredential({ origin: SITE_ORIGIN, publicKey: optionsJSON })
  }
  const { startAuthentication } = await import('@simplewebauthn/browser')
  return startAuthentication({ optionsJSON })
}

// The user closing the system sheet isn't an error worth a red message.
export function isPasskeyCancel(err) {
  const s = `${err?.name || ''} ${err?.code || ''} ${err?.message || ''}`
  return /NotAllowedError|cancel/i.test(s)
}

/**
 * What to tell someone whose passkey check at sign-in didn't work. Browsers
 * report "no passkey for this account on this device" and "cancelled" as the
 * same error, so one message covers both, and every case points to the other
 * ways on the screen (authenticator, emailed code, backup code).
 */
export function passkeyErrorMessage(err) {
  const s = `${err?.name || ''} ${err?.code || ''} ${err?.message || ''}`
  if (/NotSupported|not supported|isn.t supported|PublicKeyCredential/i.test(s)) {
    return tr('This browser can’t use passkeys. Use a different way below.')
  }
  if (isPasskeyCancel(err)) {
    return tr('No passkey was used. This device may not have a passkey for your account, or the check was cancelled. Try again, or use a different way below.')
  }
  if (/isn.t registered to this account|No passkey is set up/i.test(s)) {
    return tr('That passkey isn’t set up for this account. Use a different way below.')
  }
  return `${err?.message || tr('Passkey check didn’t work.')} ${tr('Use a different way below.')}`
}

async function post(path, body, token) {
  const res = await fetch(`${apiUrl}/auth/passkey${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Passkey request failed.')
  return data
}

/** Second step of sign-in: answer the server's challenge with a passkey. */
export async function signInWithPasskey(tempToken) {
  const options = await post('/challenge/options', { tempToken })
  const response = await getCredential(options)
  return post('/challenge/verify', { tempToken, response }) // { token, user }
}

/** Register a new passkey on the signed-in account. */
export async function addPasskey(token, name) {
  const options = await post('/register/options', {}, token)
  const response = await createCredential(options)
  return post('/register/verify', { response, name }, token)
}

export async function listPasskeys(token) {
  const res = await fetch(`${apiUrl}/auth/passkey`, { headers: { Authorization: `Bearer ${token}` } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not load passkeys.')
  return data.passkeys || []
}

export async function removePasskey(token, id, password) {
  const res = await fetch(`${apiUrl}/auth/passkey/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not remove passkey.')
}

/** A default name for a new passkey, so the list tells them apart. */
export function defaultPasskeyName() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android phone'
  if (/Mac/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows PC'
  return 'Passkey'
}
