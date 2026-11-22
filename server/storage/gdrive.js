// Google Drive as a school's own storage (#919). Same promise as the S3 and
// SharePoint paths: a proof file goes from the student's device straight to
// the school's Google Drive (a resumable upload session URL), and VolunTrack
// keeps only a pointer.
//
// Viewing is "pass-through" (the owner's choice, Option B): the school's
// people never leave VolunTrack and never need access to the Drive folder.
// Opening a file mints a 5-minute link to our own server (audited, like every
// other storage), which reads the file from Drive and sends it on. Nothing is
// kept on our side.
//
// Auth: a school's Google account signs in once with our Google app
// (GOOGLE_STORAGE_CLIENT_ID / _SECRET) and grants only the drive.file scope,
// which lets VolunTrack see the files and folders VolunTrack itself created,
// nothing else in that Drive. The refresh token is stored encrypted.
//
// Config mapping on tenant_storage (provider 'gdrive'): bucket = the id of
// the "VolunTrack proof files" folder we created, access_key_id = the Google
// account's email (shown to the school), secret_encrypted = refresh token,
// region = 'google', prefix = an optional sub-folder name.
import crypto from 'node:crypto'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DRIVE = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER = 'application/vnd.google-apps.folder'
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const ROOT_FOLDER_NAME = 'VolunTrack proof files'

export function gdriveConfigured(env = process.env) {
  return Boolean(env.GOOGLE_STORAGE_CLIENT_ID && env.GOOGLE_STORAGE_CLIENT_SECRET)
}

// The Google sign-in page for connecting a Drive.
export function gdriveAuthUrl({ redirectUri, state }) {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  u.searchParams.set('client_id', process.env.GOOGLE_STORAGE_CLIENT_ID || '')
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', `${DRIVE_SCOPE} openid email`)
  u.searchParams.set('access_type', 'offline')
  // Always ask, so Google hands back a refresh token even on a reconnect.
  u.searchParams.set('prompt', 'consent')
  u.searchParams.set('include_granted_scopes', 'false')
  u.searchParams.set('state', state)
  return u.toString()
}

async function tokenRequest(fields) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_STORAGE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_STORAGE_CLIENT_SECRET || '',
      ...fields,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok || !d.access_token) throw new Error(d.error_description || d.error || `Google sign-in failed (${res.status})`)
  return d
}

// The email inside Google's id_token. It came straight from Google over TLS
// in the token response, so reading the payload is enough here.
export function emailFromIdToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'))
    return typeof payload.email === 'string' ? payload.email.toLowerCase() : null
  } catch { return null }
}

/** Trades the code from Google's redirect for { refreshToken, accessToken, email }. */
export async function exchangeCode(code, redirectUri) {
  const d = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' })
  if (!String(d.scope || '').split(' ').includes(DRIVE_SCOPE)) throw new Error('Google Drive access wasn’t granted. Tick the box to let VolunTrack add files.')
  if (!d.refresh_token) throw new Error('Google didn’t return a long-lived token. Try connecting again.')
  return { refreshToken: d.refresh_token, accessToken: d.access_token, email: emailFromIdToken(d.id_token) }
}

export async function revokeToken(refreshToken) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: 'POST', signal: AbortSignal.timeout(10_000) }).catch(() => {})
}

// cfg: { id (tenant_storage id), refreshToken, rootId, prefix }
const tokens = new Map() // storage id -> { token, until }
async function accessToken(cfg) {
  const hit = tokens.get(cfg.id)
  if (hit && hit.until > Date.now() + 60_000) return hit.token
  let d
  try {
    d = await tokenRequest({ refresh_token: cfg.refreshToken, grant_type: 'refresh_token' })
  } catch (e) {
    throw new Error(/invalid_grant/i.test(e.message) ? 'Google Drive access was removed. Connect Google Drive again.' : e.message)
  }
  tokens.set(cfg.id, { token: d.access_token, until: Date.now() + (Number(d.expires_in) || 3600) * 1000 })
  return d.access_token
}
export function forgetToken(storageId) { tokens.delete(storageId) }

async function drive(cfg, url, init = {}) {
  const token = await accessToken(cfg)
  return fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    signal: init.signal || AbortSignal.timeout(20_000),
  })
}

async function driveError(res, what) {
  const d = await res.json().catch(() => ({}))
  return `${what}: ${d?.error?.message || `HTTP ${res.status}`}`
}

// Drive query strings quote with single quotes; our names and hashes never
// contain one, but escape anyway.
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
// A file is found by a hash of its key, stored in appProperties (which caps a
// key + value at 124 bytes; a sha256 hex always fits).
export const keyTag = (key) => crypto.createHash('sha256').update(String(key)).digest('hex')

/** Makes the "VolunTrack proof files" folder in the connected Drive; resolves to its id. */
export async function createRootFolder(accessTokenValue) {
  const res = await fetch(`${DRIVE}/files?fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessTokenValue}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: ROOT_FOLDER_NAME, mimeType: FOLDER, appProperties: { vt_root: '1' } }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(await driveError(res, 'Creating the VolunTrack folder'))
  return (await res.json()).id
}

// Folders under the root for each part of a key ("students/<id>/x.jpg" →
// students/<id>), found or made once and remembered.
const folders = new Map() // `${storageId}|${parentId}|${name}` -> id
async function folderIn(cfg, parentId, name) {
  const k = `${cfg.id}|${parentId}|${name}`
  if (folders.has(k)) return folders.get(k)
  const find = await drive(cfg, `${DRIVE}/files?${new URLSearchParams({
    q: `'${q(parentId)}' in parents and name = '${q(name)}' and mimeType = '${FOLDER}' and trashed = false`,
    fields: 'files(id)', pageSize: '1', spaces: 'drive',
  })}`)
  if (!find.ok) throw new Error(await driveError(find, 'Finding a folder'))
  let id = (await find.json()).files?.[0]?.id
  if (!id) {
    const made = await drive(cfg, `${DRIVE}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
    })
    if (!made.ok) throw new Error(await driveError(made, 'Making a folder'))
    id = (await made.json()).id
  }
  folders.set(k, id)
  return id
}

async function parentFor(cfg, key) {
  const parts = String(key).split('/').filter(Boolean)
  parts.pop() // the file name
  let parent = cfg.rootId
  for (const p of parts) parent = await folderIn(cfg, parent, p)
  return parent
}

const MIME_BY_EXT = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf', txt: 'text/plain' }
export const mimeForKey = (key) => MIME_BY_EXT[String(key).split('.').pop().toLowerCase()] || 'application/octet-stream'

/**
 * A resumable upload session for `key`. The student's device PUTs the whole
 * file to the returned URL; the URL is the credential, for about a week, for
 * this one file. `origin` lets that browser PUT pass Google's CORS check.
 */
export async function gdriveUploadUrl(cfg, key, { bytes, origin } = {}) {
  const parent = await parentFor(cfg, key)
  const mime = mimeForKey(key)
  const res = await drive(cfg, `${UPLOAD}/files?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mime,
      ...(bytes ? { 'X-Upload-Content-Length': String(bytes) } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify({ name: String(key).split('/').pop(), parents: [parent], mimeType: mime, appProperties: { vt_key: keyTag(key) } }),
  })
  if (!res.ok) throw new Error(await driveError(res, 'Preparing the upload'))
  const url = res.headers.get('location')
  if (!url) throw new Error('Google Drive didn’t return an upload address.')
  return url
}

/** The Drive file for a key, or null. */
export async function gdriveFind(cfg, key) {
  const res = await drive(cfg, `${DRIVE}/files?${new URLSearchParams({
    q: `appProperties has { key='vt_key' and value='${keyTag(key)}' } and trashed = false`,
    fields: 'files(id,mimeType,size)', pageSize: '1', spaces: 'drive',
  })}`)
  if (!res.ok) throw new Error(await driveError(res, 'Finding the file'))
  return (await res.json()).files?.[0] || null
}

/** The file's bytes as a fetch Response (for streaming on), or null when gone. */
export async function gdriveOpen(cfg, key) {
  const file = await gdriveFind(cfg, key)
  if (!file) return null
  const res = await drive(cfg, `${DRIVE}/files/${encodeURIComponent(file.id)}?alt=media`, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(await driveError(res, 'Opening the file'))
  return { res, mime: file.mimeType, size: Number(file.size) || null }
}

/** Server-side write (moving old documents out of our database, the test file). */
export async function gdrivePut(cfg, key, body) {
  const url = await gdriveUploadUrl(cfg, key, { bytes: body.length })
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': mimeForKey(key) }, body, signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`Google Drive returned ${res.status}`)
}

async function gdriveDelete(cfg, key) {
  const file = await gdriveFind(cfg, key)
  if (!file) return
  const res = await drive(cfg, `${DRIVE}/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) throw new Error(await driveError(res, 'Deleting the test file'))
}

// The gate for status='active': write, read back, delete a small file.
export async function gdriveRoundTrip(cfg) {
  if (!gdriveConfigured()) return { ok: false, error: 'Google Drive isn’t set up on this server yet.' }
  const key = `${cfg.prefix ? `${cfg.prefix}/` : ''}voluntrack-check-${Date.now()}.txt`
  const body = Buffer.from(`voluntrack storage check ${new Date().toISOString()}`)
  let written = false
  try {
    await gdrivePut(cfg, key, body)
    written = true
    const opened = await gdriveOpen(cfg, key)
    if (!opened) return { ok: false, error: 'Could not find the test file again.' }
    if ((await opened.res.text()) !== body.toString()) return { ok: false, error: 'The test file read back with different contents.' }
    await gdriveDelete(cfg, key)
    written = false
    return { ok: true, error: null }
  } catch (error) {
    return { ok: false, error: error.message }
  } finally {
    if (written) gdriveDelete(cfg, key).catch(() => {})
  }
}
