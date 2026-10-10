// Relying-party configuration for passkeys (WebAuthn), used as a second
// factor alongside TOTP — see server/routes/passkeys.js.
//
// A passkey is bound to its relying-party ID (a domain) for life: one made for
// volunteer-track-two.vercel.app can never be used on getvoluntrack.com, so
// changing WEBAUTHN_RP_ID strands every passkey already registered. Users then
// fall back to their password + TOTP and add a new passkey.
//
// The apps can't be a relying party of their own (their origin is
// https://localhost / capacitor://localhost), so they use the website's RP ID,
// proven by /.well-known/apple-app-site-association and assetlinks.json
// (scripts/generate-well-known.mjs). iOS reports the website's origin; Android
// reports the app's signing certificate instead ("android:apk-key-hash:…"),
// which is why those origins are allowed alongside the web ones.

import crypto from 'crypto'
import { query } from './db.js'

export const RP_NAME = 'VolunTrack'

function frontendOrigins() {
  return (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((u) => { try { return new URL(u).origin } catch { return null } })
    .filter(Boolean)
}

/** The domain passkeys belong to. Defaults to the first FRONTEND_URL's host. */
export function rpId() {
  if (process.env.WEBAUTHN_RP_ID) return process.env.WEBAUTHN_RP_ID.trim()
  return new URL(frontendOrigins()[0] || 'http://localhost:5173').hostname
}

// "AB:CD:…" SHA-256 signing-cert fingerprint → the origin Android's
// Credential Manager puts in clientDataJSON for an app signed with it.
export function androidOriginForFingerprint(fingerprint) {
  const hex = String(fingerprint).replace(/[^0-9a-f]/gi, '')
  if (hex.length !== 64) return null
  return `android:apk-key-hash:${Buffer.from(hex, 'hex').toString('base64url')}`
}

/** SHA-256 fingerprints of every key the Android app may be signed with. */
export function androidCertFingerprints() {
  return (process.env.ANDROID_CERT_SHA256 || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Every origin a passkey response may legitimately come from. */
export function expectedOrigins() {
  const android = androidCertFingerprints().map(androidOriginForFingerprint).filter(Boolean)
  return [...new Set([...frontendOrigins(), ...android])]
}

/** A stable, opaque WebAuthn user handle — not the raw account ID. */
export function userHandle(userId) {
  return new Uint8Array(crypto.createHash('sha256').update(`voluntrack-passkey:${userId}`).digest())
}

export const CHALLENGE_TTL_MS = 5 * 60 * 1000
export const MAX_PASSKEYS_PER_USER = 10

/** Whether an account can answer a passkey challenge. Used by the login gates. */
export async function hasPasskeys(userId) {
  const { rows } = await query('SELECT 1 FROM passkeys WHERE user_id = $1 LIMIT 1', [userId])
  return rows.length > 0
}
