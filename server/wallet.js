// Wallet card (#716): a student's or volunteer's hours as a pass in Apple
// Wallet or Google Wallet: hours, school, goal and award level. Both are off
// until VolunTrack's own wallet credentials are set (see #228). Cards update
// themselves (#730): server/walletUpdates.js notices changed numbers, updates
// a Google card in place and tells phones holding an Apple card to fetch it
// again through Apple's web service (routes in server/routes/wallet.js).
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
export const passId = (userId) => crypto.createHash('sha256').update(`voluntrack-wallet:${userId}`).digest('hex').slice(0, 32)

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

/** What the card shows, minus the date, so a change can be noticed. */
export const cardFingerprint = (s) => JSON.stringify([s.name, s.hours, s.school, s.goal, s.award])

/** Remembers that this account holds a card in `wallet` ('apple' | 'google'). */
export async function rememberCard(userId, wallet, s) {
  const col = wallet === 'apple' ? 'apple' : 'google'
  await query(
    `INSERT INTO wallet_cards (user_id, serial, ${col}, shown, updated_at, checked_at) VALUES ($1, $2, true, $3, now(), now())
     ON CONFLICT (user_id) DO UPDATE SET ${col} = true,
       updated_at = CASE WHEN wallet_cards.shown IS DISTINCT FROM EXCLUDED.shown THEN now() ELSE wallet_cards.updated_at END,
       shown = EXCLUDED.shown, checked_at = now()`,
    [userId, passId(userId), cardFingerprint(s)],
  )
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
export async function updateGoogleCard(userId, s) {
  const sa = googleAccount()
  if (!sa) return false
  return updateExistingGoogleObject(sa, googleObject(process.env.GOOGLE_WALLET_ISSUER_ID, userId, s))
}
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
  await rememberCard(userId, 'google', s).catch((e) => console.error('wallet card record failed:', e.message))
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

// Apple's web service (#730): the phone calls webServiceURL with this token
// to register for updates and fetch the newest pass. Apple requires https.
const apiBase = () => (process.env.PUBLIC_API_URL || '').replace(/\/$/, '')
export const appleWebServiceUrl = () => (apiBase().startsWith('https://') ? `${apiBase()}/api/wallet/apple-ws` : null)
const wsKey = () => crypto.createHash('sha256').update(`voluntrack-wallet-ws:${process.env.JWT_SECRET || 'dev'}`).digest()
export const appleAuthToken = (serial) => crypto.createHmac('sha256', wsKey()).update(String(serial)).digest('hex')
export function appleAuthOk(serial, header) {
  const got = String(header || '').replace(/^ApplePass\s+/i, '')
  const want = appleAuthToken(serial)
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))
}

export function applePassJson(userId, s) {
  const field = (key, label, value) => ({ key, label, value: String(value) })
  const ws = appleWebServiceUrl()
  return {
    ...(ws ? { webServiceURL: ws, authenticationToken: appleAuthToken(passId(userId)) } : {}),
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
        field('about', 'About', `Hours counted in VolunTrack (rejected entries left out). ${ws ? 'The card updates by itself when your hours change.' : 'Add the card again from Reports to update it.'} ${site()}`),
      ],
    },
  }
}

/** The .pkpass file for the account, or null when not configured. */
export async function applePass(userId) {
  if (!appleWalletConfigured()) return null
  const s = await walletSummary(userId)
  if (!s) return null
  const file = buildPkpass(applePassJson(userId, s))
  await rememberCard(userId, 'apple', s).catch((e) => console.error('wallet card record failed:', e.message))
  return file
}

function buildPkpass(passJson) {
  const files = { 'pass.json': Buffer.from(JSON.stringify(passJson)) }
  for (const f of fs.readdirSync(ASSETS)) if (f.endsWith('.png')) files[f] = fs.readFileSync(path.join(ASSETS, f))
  const manifest = JSON.stringify(Object.fromEntries(Object.entries(files).map(([n, b]) => [n, crypto.createHash('sha1').update(b).digest('hex')])))
  files['manifest.json'] = Buffer.from(manifest)
  files.signature = signManifest(manifest)
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([n, b]) => [n, new Uint8Array(b)]))))
}

// --- Event badge as a wallet ticket (#732) -------------------------------------
// The same QR code as the on-screen badge (staff open /badge/<code>, which
// checks it live), so a cancelled sign-up stops working even on a saved ticket.
const badgeSerial = (code) => crypto.createHash('sha256').update(`voluntrack-badge:${code}`).digest('hex').slice(0, 32)
const badgeUrl = (code) => `${site()}/badge/${code}`
const nextDay = (date) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 2); return d.toISOString().replace(/\.\d{3}Z$/, 'Z') }

// "Sat, Nov 14 · 2:00 PM" from the task's date and 24-hour time.
export function badgeWhen(date, time) {
  const day = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time || ''))
  if (!m) return day
  const h = Number(m[1])
  return `${day} · ${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

export function appleBadgeJson(badge, place) {
  const field = (key, label, value) => ({ key, label, value: String(value) })
  const when = badgeWhen(badge.date, badge.time)
  const qr = { format: 'PKBarcodeFormatQR', message: badgeUrl(badge.code), messageEncoding: 'iso-8859-1', altText: 'Staff: scan to check' }
  return {
    formatVersion: 1,
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID,
    teamIdentifier: process.env.APPLE_TEAM_ID,
    serialNumber: badgeSerial(badge.code),
    organizationName: 'VolunTrack',
    description: `Volunteer badge: ${badge.title}`,
    logoText: 'VolunTrack',
    foregroundColor: 'rgb(255, 255, 255)',
    backgroundColor: 'rgb(5, 150, 105)',
    labelColor: 'rgb(209, 250, 229)',
    expirationDate: nextDay(badge.date),
    barcodes: [qr],
    barcode: qr,
    ...(place ? { locations: [{ ...place, relevantText: `Your volunteer badge for ${badge.title}` }] } : {}),
    eventTicket: {
      primaryFields: [field('event', 'VOLUNTEER', badge.title)],
      secondaryFields: [field('name', 'NAME', badge.name)],
      auxiliaryFields: [field('when', 'WHEN', when), ...(badge.location ? [field('where', 'WHERE', badge.location)] : [])],
      backFields: [
        ...(badge.organizer ? [field('organizer', 'Organized by', badge.organizer)] : []),
        field('about', 'About', `Your approved volunteer badge. Staff scan the code to check it with VolunTrack. If the event or your sign-up is cancelled, the code stops working. ${site()}`),
      ],
    },
  }
}

/** The badge's .pkpass, or null when Apple Wallet isn't set up. */
export function appleBadgePass(badge, place) {
  if (!appleWalletConfigured()) return null
  return buildPkpass(appleBadgeJson(badge, place))
}

/** A "Save to Google Wallet" link for the badge, or null when not configured. */
export function googleBadgeSaveUrl(badge) {
  const sa = googleAccount()
  if (!sa) return null
  const issuer = process.env.GOOGLE_WALLET_ISSUER_ID
  const text = (id, header, body) => ({ id, header, body: String(body) })
  const lang = (value) => ({ defaultValue: { language: 'en-US', value } })
  const object = {
    id: `${issuer}.vtb_${badgeSerial(badge.code)}`,
    classId: `${issuer}.voluntrack_badge`,
    state: 'ACTIVE',
    hexBackgroundColor: '#059669',
    logo: { sourceUri: { uri: `${site()}/icons/icon-192.png` }, contentDescription: lang('VolunTrack') },
    cardTitle: lang('VolunTrack volunteer'),
    subheader: lang(badge.name),
    header: lang(badge.title),
    barcode: { type: 'QR_CODE', value: badgeUrl(badge.code), alternateText: 'Staff: scan to check' },
    textModulesData: [
      text('when', 'When', badgeWhen(badge.date, badge.time)),
      ...(badge.location ? [text('where', 'Where', badge.location)] : []),
      ...(badge.organizer ? [text('organizer', 'Organized by', badge.organizer)] : []),
    ],
  }
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

/** PEM certificate and key of the pass certificate, for pushes to Apple. */
export function applePushCredentials() {
  const { cert, key } = appleSigner()
  return { cert: forge.pki.certificateToPem(cert), key: forge.pki.privateKeyToPem(key) }
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
