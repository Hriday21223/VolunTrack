// Push to the Android and iOS apps (#603). Two senders, no SDKs:
//
//  - Android: Firebase Cloud Messaging HTTP v1. FIREBASE_SERVICE_ACCOUNT is the
//    service-account JSON (raw or base64) from Firebase → Project settings →
//    Service accounts. We sign a JWT with its private key (RS256) and trade it
//    for an OAuth token, cached until a minute before it expires.
//  - iOS: Apple Push Notification service over HTTP/2 with a token key
//    (APNS_KEY = the .p8 file's contents, APNS_KEY_ID, APPLE_TEAM_ID,
//    APNS_TOPIC = the app's bundle id, APNS_ENV = 'sandbox' for Xcode debug
//    builds, production otherwise). The Capacitor plugin hands iOS apps a raw
//    APNs token, so they don't go through Firebase.
//
// Each sender is off until its variables are set, like email: sendNative()
// then reports `skipped`, and nothing else changes.
import crypto from 'node:crypto'
import http2 from 'node:http2'

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) return null
  try {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
    const sa = JSON.parse(text)
    return sa.client_email && sa.private_key && sa.project_id ? sa : null
  } catch {
    console.error('FIREBASE_SERVICE_ACCOUNT is not valid JSON')
    return null
  }
}

export function fcmConfigured() { return Boolean(serviceAccount()) }
export function apnsConfigured() {
  return Boolean(process.env.APNS_KEY && process.env.APNS_KEY_ID && process.env.APPLE_TEAM_ID && process.env.APNS_TOPIC)
}

let fcmToken = null // { value, expiresAt }
async function fcmAccessToken(sa) {
  if (fcmToken && fcmToken.expiresAt > Date.now() + 60_000) return fcmToken.value
  const now = Math.floor(Date.now() / 1000)
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))
  const signature = b64url(crypto.sign('RSA-SHA256', Buffer.from(`${head}.${claims}`), sa.private_key))
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${signature}` }),
    signal: AbortSignal.timeout(10_000),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) throw new Error(`FCM auth failed (${res.status})`)
  fcmToken = { value: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 }
  return fcmToken.value
}

async function sendFcm(token, { title, body, link }) {
  const sa = serviceAccount()
  if (!sa) return { ok: false, skipped: true }
  const access = await fcmAccessToken(sa)
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body: body || '' },
        data: { link: link || '/' },
        android: { priority: 'high' },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (res.ok) return { ok: true }
  const err = await res.json().catch(() => ({}))
  const code = err?.error?.details?.find?.((d) => d.errorCode)?.errorCode || err?.error?.status
  // The token belongs to an uninstalled app or a reset device: forget it.
  const gone = res.status === 404 || code === 'UNREGISTERED' || (res.status === 400 && code === 'INVALID_ARGUMENT')
  return { ok: false, gone, error: `FCM ${res.status} ${code || ''}`.trim() }
}

let apnsJwt = null // { value, issuedAt }
function apnsAuth() {
  // Apple wants the token refreshed at most every hour and at least every 20 minutes.
  if (apnsJwt && Date.now() - apnsJwt.issuedAt < 40 * 60_000) return apnsJwt.value
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: process.env.APNS_KEY_ID }))
  const claims = b64url(JSON.stringify({ iss: process.env.APPLE_TEAM_ID, iat: Math.floor(Date.now() / 1000) }))
  const key = process.env.APNS_KEY.includes('BEGIN') ? process.env.APNS_KEY : Buffer.from(process.env.APNS_KEY, 'base64').toString('utf8')
  const signature = b64url(crypto.sign('SHA256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' }))
  apnsJwt = { value: `${head}.${claims}.${signature}`, issuedAt: Date.now() }
  return apnsJwt.value
}

function sendApns(token, { title, body, link }) {
  if (!apnsConfigured()) return Promise.resolve({ ok: false, skipped: true })
  const host = process.env.APNS_ENV === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com'
  return new Promise((resolve) => {
    let settled = false
    const done = (r) => { if (!settled) { settled = true; resolve(r) } }
    const client = http2.connect(host)
    client.on('error', (e) => { done({ ok: false, error: e.message }); client.close() })
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${apnsAuth()}`,
      'apns-topic': process.env.APNS_TOPIC,
      'apns-push-type': 'alert',
      'content-type': 'application/json',
    })
    req.setTimeout(10_000, () => { done({ ok: false, error: 'APNs timeout' }); req.close() })
    let status = 0
    let data = ''
    req.on('response', (h) => { status = h[':status'] })
    req.on('data', (c) => { data += c })
    req.on('end', () => {
      client.close()
      if (status === 200) return done({ ok: true })
      let reason = ''
      try { reason = JSON.parse(data).reason || '' } catch { /* empty body */ }
      done({ ok: false, gone: status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered', error: `APNs ${status} ${reason}`.trim() })
    })
    req.end(JSON.stringify({ aps: { alert: { title, body: body || '' }, sound: 'default' }, link: link || '/' }))
  })
}

/**
 * One push to one app install. Never throws.
 * @returns {Promise<{ ok: boolean, gone?: boolean, skipped?: boolean, error?: string }>}
 */
export async function sendNative(device, message) {
  try {
    if (device.platform === 'android') return await sendFcm(device.token, message)
    if (device.platform === 'ios') return await sendApns(device.token, message)
    return { ok: false, skipped: true }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}
