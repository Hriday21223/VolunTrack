// Wallet card (#716): a student's or volunteer's hours as a pass in Apple
// Wallet or Google Wallet: hours, school, goal and award level. Both are off
// until VolunTrack's own wallet credentials are set (see #228), and the pass
// shows the numbers at the moment it was added; adding it again refreshes it
// (Google's is updated in place).
//
// Apple: APPLE_PASS_CERT (the pass certificate as a base64 .p12),
// APPLE_PASS_CERT_PASSWORD, APPLE_PASS_TYPE_ID, APPLE_TEAM_ID, APPLE_WWDR_CERT
// (Apple's WWDR G4 intermediate, PEM or base64 PEM).
// Google: GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_SERVICE_ACCOUNT (JSON or base64 JSON).
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import forge from 'node-forge'
import { zipSync } from 'fflate'
import { query } from './db.js'
import { policyForUser } from './policy.js'
import { goalHoursFor, awardFor } from './requirements.js'

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'wallet-assets')
const COLORS = { bg: '#1f4d2b', fg: '#ffffff', label: '#c8e6c9' }

const decode = (raw) => {
  const t = String(raw || '').trim()
  if (!t) return ''
  return t.startsWith('-----') || t.startsWith('{') ? t : Buffer.from(t, 'base64').toString('utf8')
}

export function appleWalletConfigured() {
  const e = process.env
  return Boolean(e.APPLE_PASS_CERT && e.APPLE_PASS_TYPE_ID && e.APPLE_TEAM_ID && e.APPLE_WWDR_CERT)
}

function googleAccount() {
  if (!process.env.GOOGLE_WALLET_ISSUER_ID || !process.env.GOOGLE_WALLET_SERVICE_ACCOUNT) return null
  try {
    const sa = JSON.parse(decode(process.env.GOOGLE_WALLET_SERVICE_ACCOUNT))
    return sa.client_email && sa.private_key ? sa : null
  } catch {
    console.error('GOOGLE_WALLET_SERVICE_ACCOUNT is not valid JSON')
    return null
  }
}
export function googleWalletConfigured() { return Boolean(googleAccount()) }

const round = (n) => Math.round((Number(n) || 0) * 100) / 100
const site = () => ((process.env.FRONTEND_URL || '').split(',').map((x) => x.trim()).find(Boolean) || 'https://volunteer-track-two.vercel.app').replace(/\/$/, '')
// A stable, non-guessable id for the pass: not the account id itself.
const passId = (userId) => crypto.createHash('sha256').update(`voluntrack-wallet:${userId}`).digest('hex').slice(0, 32)

/** What the card shows: counted hours (rejected left out), school, goal, award. */
export async function walletSummary(userId) {
  const { rows } = await query(
    `SELECT u.name, COALESCE((SELECT SUM(l.hours) FROM logs l WHERE l.user_id = u.id AND l.verification_status IS DISTINCT FROM 'rejected'), 0)::float8 AS hours
       FROM users u WHERE u.id = $1`,
    [userId],
  )
  if (!rows[0]) return null
  const hours = round(rows[0].hours)
  const resolved = await policyForUser(userId).catch(() => null)
  const goal = resolved ? goalHoursFor(resolved.policy, resolved.grade) : null
  const award = resolved ? awardFor(resolved.policy, hours).current : null
  return { name: rows[0].name || 'Volunteer', hours, school: resolved?.schoolName || null, goal: goal || null, award: award?.name || null }
}

// --- Google Wallet ------------------------------------------------------------
const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url')
function signRs256(claims, privateKey) {
  const head = b64url({ alg: 'RS256', typ: 'JWT' })
  const body = b64url(claims)
  return `${head}.${body}.${crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`
}

export function googleObject(issuer, userId, s) {
  const text = (id, header, body) => ({ id, header, body: String(body) })
  return {
    id: `${issuer}.vt_${passId(userId)}`,
    classId: `${issuer}.voluntrack_hours`,
    state: 'ACTIVE',
    hexBackgroundColor: COLORS.bg,
    logo: { sourceUri: { uri: `${site()}/icons/icon-192.png` }, contentDescription: { defaultValue: { language: 'en-US', value: 'VolunTrack' } } },
    cardTitle: { defaultValue: { language: 'en-US', value: 'VolunTrack' } },
    subheader: { defaultValue: { language: 'en-US', value: 'Volunteer hours' } },
    header: { defaultValue: { language: 'en-US', value: `${s.hours} hours` } },
    textModulesData: [
      text('name', 'Name', s.name),
      ...(s.school ? [text('school', 'School', s.school)] : []),
      ...(s.goal ? [text('goal', 'Goal', `${s.hours} of ${s.goal} hours`)] : []),
      ...(s.award ? [text('award', 'Award level', s.award)] : []),
      text('updated', 'Updated', new Date().toISOString().slice(0, 10)),
    ],
  }
}

let googleToken = null
async function googleAccessToken(sa) {
  if (googleToken && googleToken.expiresAt > Date.now() + 60_000) return googleToken.value
  const now = Math.floor(Date.now() / 1000)
  const assertion = signRs256({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/wallet_object.issuer', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }, sa.private_key)
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(10_000),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) throw new Error(`Google Wallet auth failed (${res.status})`)
  googleToken = { value: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 }
  return googleToken.value
}

// A card already saved keeps its old numbers unless it's updated, so update
// it in place when it exists. Best effort: the save link works either way.
async function updateExistingGoogleObject(sa, object) {
  try {
    const token = await googleAccessToken(sa)
    const url = `https://walletobjects.googleapis.com/walletobjects/v1/genericObject/${encodeURIComponent(object.id)}`
    const res = await fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(object), signal: AbortSignal.timeout(10_000) })
    return res.ok
  } catch (error) {
    console.error('google wallet update failed:', error.message)
    return false
  }
}

/** A "Save to Google Wallet" link for the account, or null when not configured. */
export async function googleSaveUrl(userId) {
  const sa = googleAccount()
  if (!sa) return null
  const s = await walletSummary(userId)
  if (!s) return null
  const issuer = process.env.GOOGLE_WALLET_ISSUER_ID
  const object = googleObject(issuer, userId, s)
  await updateExistingGoogleObject(sa, object)
  const jwt = signRs256({
    iss: sa.client_email,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins: [site()],
    payload: { genericClasses: [{ id: object.classId }], genericObjects: [object] },
  }, sa.private_key)
  return `https://pay.google.com/gp/v/save/${jwt}`
}

// --- Apple Wallet -------------------------------------------------------------
let appleCreds = null
function appleSigner() {
  if (appleCreds) return appleCreds
  const p12Der = forge.util.decode64(String(process.env.APPLE_PASS_CERT).replace(/\s+/g, ''))
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(p12Der), process.env.APPLE_PASS_CERT_PASSWORD || '')
  const cert = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0]?.cert
  const keyBag = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]
    || p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0]
  if (!cert || !keyBag?.key) throw new Error('APPLE_PASS_CERT has no certificate and key.')
  const wwdr = forge.pki.certificateFromPem(decode(process.env.APPLE_WWDR_CERT))
  appleCreds = { cert, key: keyBag.key, wwdr }
  return appleCreds
}

function signManifest(manifest) {
  const { cert, key, wwdr } = appleSigner()
  const p7 = forge.pkcs7.createSignedData()
  p7.content = forge.util.createBuffer(manifest, 'utf8')
  p7.addCertificate(cert)
  p7.addCertificate(wwdr)
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  })
  p7.sign({ detached: true })
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary')
}

export function applePassJson(userId, s) {
  const field = (key, label, value) => ({ key, label, value: String(value) })
  return {
    formatVersion: 1,
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID,
    teamIdentifier: process.env.APPLE_TEAM_ID,
    serialNumber: passId(userId),
    organizationName: 'VolunTrack',
    description: 'VolunTrack volunteer hours',
    logoText: 'VolunTrack',
    foregroundColor: 'rgb(255, 255, 255)',
    backgroundColor: 'rgb(31, 77, 43)',
    labelColor: 'rgb(200, 230, 201)',
    generic: {
      primaryFields: [field('hours', 'VOLUNTEER HOURS', s.hours)],
      secondaryFields: [field('name', 'NAME', s.name), ...(s.school ? [field('school', 'SCHOOL', s.school)] : [])],
      auxiliaryFields: [
        ...(s.goal ? [field('goal', 'GOAL', `${s.hours} / ${s.goal} h`)] : []),
        ...(s.award ? [field('award', 'AWARD', s.award)] : []),
      ],
      backFields: [
        field('updated', 'Updated', new Date().toISOString().slice(0, 10)),
        field('about', 'About', `Hours counted in VolunTrack (rejected entries left out). Add the card again from Reports to update it. ${site()}`),
      ],
    },
  }
}

/** The .pkpass file for the account, or null when not configured. */
export async function applePass(userId) {
  if (!appleWalletConfigured()) return null
  const s = await walletSummary(userId)
  if (!s) return null
  const files = { 'pass.json': Buffer.from(JSON.stringify(applePassJson(userId, s))) }
  for (const f of fs.readdirSync(ASSETS)) if (f.endsWith('.png')) files[f] = fs.readFileSync(path.join(ASSETS, f))
  const manifest = JSON.stringify(Object.fromEntries(Object.entries(files).map(([n, b]) => [n, crypto.createHash('sha1').update(b).digest('hex')])))
  files['manifest.json'] = Buffer.from(manifest)
  files.signature = signManifest(manifest)
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([n, b]) => [n, new Uint8Array(b)]))))
}

// A short-lived link so the phone can open the pass without a sign-in header.
const linkKey = () => crypto.createHash('sha256').update(`voluntrack-wallet-link:${process.env.JWT_SECRET || 'dev'}`).digest()
export function appleLinkToken(userId, ttlSeconds = 300) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const body = `${Buffer.from(userId).toString('base64url')}.${exp}`
  return `${body}.${crypto.createHmac('sha256', linkKey()).update(body).digest('base64url')}`
}
export function userFromLinkToken(token) {
  const [u, exp, mac] = String(token || '').split('.')
  if (!u || !exp || !mac) return null
  const want = crypto.createHmac('sha256', linkKey()).update(`${u}.${exp}`).digest('base64url')
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null
  if (Number(exp) < Date.now() / 1000) return null
  return Buffer.from(u, 'base64url').toString('utf8')
}
