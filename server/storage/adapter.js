import { presign, checkRoundTrip } from './s3.js'
import { publicFetch } from '../publicHost.js'
import { decryptSecret } from '../secrets.js'
import { sharepointUploadUrl, sharepointDownloadUrl, sharepointPut, sharepointRoundTrip } from './graph.js'
import { gdriveUploadUrl, gdrivePut, gdriveRoundTrip } from './gdrive.js'
import jwt from 'jsonwebtoken'

// One place that knows how to talk to a school's own storage (#924), so the
// routes don't care whether it's an S3-compatible bucket, SharePoint or
// Google Drive (#919).
export const isSharepoint = (row) => row?.provider === 'sharepoint'
export const isGdrive = (row) => row?.provider === 'gdrive'
// Not an S3 bucket: no access key pair, no bucket CORS rule to check.
export const isExternal = (row) => isSharepoint(row) || isGdrive(row)

function gdConfig(row) {
  return { id: row.id, refreshToken: decryptSecret(row.secret_encrypted), rootId: row.bucket, prefix: row.prefix }
}

// Google Drive files are read through our own server (#919, Option B): this
// signed link, good for `expiresIn` seconds, names the storage and key, and
// GET /api/storage/gdrive/file streams the file from Drive. Like a presigned
// URL, it works for whoever holds it until it expires.
export function gdriveViewUrl(row, key, expiresIn = 300) {
  const t = jwt.sign({ purpose: 'gdrive_view', sid: row.id, key }, process.env.JWT_SECRET, { expiresIn })
  const base = (process.env.PUBLIC_API_URL || '').replace(/\/$/, '')
  return `${base}/api/storage/gdrive/file?t=${encodeURIComponent(t)}`
}

function s3Config(row) {
  return {
    bucket: row.bucket, region: row.region, endpoint: row.endpoint, prefix: row.prefix,
    accessKeyId: row.access_key_id, secretAccessKey: decryptSecret(row.secret_encrypted),
  }
}
function spConfig(row) {
  // The school's own Entra app, when they gave one (#926); else ours.
  const own = row.access_key_id && row.secret_encrypted
  return {
    tenant: row.region, site: row.endpoint, library: row.bucket, prefix: row.prefix,
    ...(own ? { clientId: row.access_key_id, clientSecret: decryptSecret(row.secret_encrypted) } : {}),
  }
}

// → { url, method: 'PUT', kind: 's3' | 'sharepoint' | 'gdrive' }. A SharePoint
// upload URL takes a Content-Range header instead of a signed content-length;
// a Google Drive session takes the whole file in one PUT.
export async function mintUpload(row, { key, bytes, origin }) {
  if (isGdrive(row)) return { url: await gdriveUploadUrl(gdConfig(row), key, { bytes, origin }), method: 'PUT', kind: 'gdrive' }
  if (isSharepoint(row)) return { url: await sharepointUploadUrl(spConfig(row), key), method: 'PUT', kind: 'sharepoint' }
  return { url: presign(s3Config(row), { method: 'PUT', key, expiresIn: 300, headers: { 'content-length': String(bytes) } }), method: 'PUT', kind: 's3' }
}

export async function mintDownload(row, key, expiresIn = 300) {
  if (isGdrive(row)) return gdriveViewUrl(row, key, expiresIn)
  if (isSharepoint(row)) return sharepointDownloadUrl(spConfig(row), key)
  return presign(s3Config(row), { method: 'GET', key, expiresIn })
}

// Server-side write of bytes we hold (the one-time move out of our database).
export async function putBytes(row, key, body, contentType) {
  if (isGdrive(row)) return gdrivePut(gdConfig(row), key, body)
  if (isSharepoint(row)) return sharepointPut(spConfig(row), key, body)
  const url = presign(s3Config(row), { method: 'PUT', key, expiresIn: 300, headers: { 'content-length': String(body.length) } })
  const put = await publicFetch(url, { method: 'PUT', headers: { 'Content-Type': contentType || 'application/octet-stream', 'Content-Length': String(body.length) }, body })
  if (!put.ok) throw new Error(`bucket returned ${put.status}`)
}

export async function roundTrip(row) {
  if (isGdrive(row)) return gdriveRoundTrip(gdConfig(row))
  if (isSharepoint(row)) return sharepointRoundTrip(spConfig(row))
  return checkRoundTrip(s3Config(row))
}
