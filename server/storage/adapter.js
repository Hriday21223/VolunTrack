import { presign, checkRoundTrip } from './s3.js'
import { publicFetch } from '../publicHost.js'
import { decryptSecret } from '../secrets.js'
import { sharepointUploadUrl, sharepointDownloadUrl, sharepointPut, sharepointRoundTrip } from './graph.js'

// One place that knows how to talk to a school's own storage (#924), so the
// routes don't care whether it's an S3-compatible bucket or SharePoint.
export const isSharepoint = (row) => row?.provider === 'sharepoint'

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

// → { url, method: 'PUT', kind: 's3' | 'sharepoint' }. A SharePoint upload URL
// takes a Content-Range header instead of a signed content-length.
export async function mintUpload(row, { key, bytes }) {
  if (isSharepoint(row)) return { url: await sharepointUploadUrl(spConfig(row), key), method: 'PUT', kind: 'sharepoint' }
  return { url: presign(s3Config(row), { method: 'PUT', key, expiresIn: 300, headers: { 'content-length': String(bytes) } }), method: 'PUT', kind: 's3' }
}

export async function mintDownload(row, key, expiresIn = 300) {
  if (isSharepoint(row)) return sharepointDownloadUrl(spConfig(row), key)
  return presign(s3Config(row), { method: 'GET', key, expiresIn })
}

// Server-side write of bytes we hold (the one-time move out of our database).
export async function putBytes(row, key, body, contentType) {
  if (isSharepoint(row)) return sharepointPut(spConfig(row), key, body)
  const url = presign(s3Config(row), { method: 'PUT', key, expiresIn: 300, headers: { 'content-length': String(body.length) } })
  const put = await publicFetch(url, { method: 'PUT', headers: { 'Content-Type': contentType || 'application/octet-stream', 'Content-Length': String(body.length) }, body })
  if (!put.ok) throw new Error(`bucket returned ${put.status}`)
}

export async function roundTrip(row) {
  if (isSharepoint(row)) return sharepointRoundTrip(spConfig(row))
  return checkRoundTrip(s3Config(row))
}
