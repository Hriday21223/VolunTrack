// Web Push opt-in for reminders.
//
// localStorage stays the source of truth for reminders (the app must work with
// no backend, per CLAUDE.md) and the in-tab runner in useReminders.js is
// unchanged. This is purely additive: a signed-in user can also have the
// server push them when every tab is closed, which the in-page Notification
// API cannot do.

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export function pushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

/** @returns {Promise<{ pushEnabled: boolean, publicKey: string|null }>} */
export async function getPushConfig() {
  try {
    const res = await fetch(`${apiUrl}/reminders/config`)
    if (!res.ok) return { pushEnabled: false, publicKey: null }
    return await res.json()
  } catch {
    // No backend (client-only mode) — push simply isn't on offer.
    return { pushEnabled: false, publicKey: null }
  }
}

// VAPID keys travel as base64url but PushManager wants a Uint8Array.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export async function currentSubscription() {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return null
  return reg.pushManager.getSubscription()
}

/**
 * Asks for notification permission, subscribes, and registers the endpoint
 * with the server. Throws with a human-readable reason on refusal.
 */
export async function enablePush(publicKey) {
  if (!pushSupported()) throw new Error('This browser does not support push notifications.')
  if (!publicKey) throw new Error('Push is not configured on the server.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Notifications are blocked. Allow them in your browser settings, then try again.')
  }

  const reg = await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  const sub = existing || await reg.pushManager.subscribe({
    // Required by every browser: pushes must be user-visible.
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  })

  const json = sub.toJSON()
  const res = await fetch(`${apiUrl}/reminders/subscribe`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Could not register for push notifications.')
  }
  return sub
}

export async function disablePush() {
  const sub = await currentSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  // Unsubscribe locally first so the browser stops accepting pushes even if
  // the server call fails.
  await sub.unsubscribe().catch(() => {})
  await fetch(`${apiUrl}/reminders/unsubscribe`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ endpoint }),
  }).catch(() => {})
}

/**
 * Mirrors the local reminder set to the server so it knows when to push.
 * Best-effort: a failure here must never break local reminder editing.
 */
export async function syncReminders(reminders) {
  if (!localStorage.getItem('voluntrack:auth_token')) return false
  try {
    const res = await fetch(`${apiUrl}/reminders/sync`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        reminders,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}
