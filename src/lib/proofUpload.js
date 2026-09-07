// Uploads a proof-of-service file straight from the browser to the school's
// own bucket (#143). The bytes never pass through the VolunTrack backend, so
// we never hold a student's document — the server only mints a short-lived
// presigned URL and later stores a pointer.
//
// Every failure path returns null, which means "carry on the way the app
// always has": the file stays in localStorage as a base64 data URL. A school
// without storage configured, an offline student, and a signed-out user all
// take that path, so this can never block someone logging their hours.

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } : null
}

// FileDrop hands us a base64 data URL; the bucket needs the raw bytes.
function dataUrlToBlob(dataUrl, mimeType) {
  const comma = String(dataUrl).indexOf(',')
  if (comma === -1) return null
  const binary = atob(String(dataUrl).slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' })
}

/**
 * @returns {Promise<{key, storageId, mime, bytes}|null>} a pointer to store on
 * the log, or null to fall back to keeping the file locally.
 */
export async function uploadProof(proof) {
  const headers = authHeaders()
  if (!headers || !proof?.dataUrl) return null

  try {
    const blob = dataUrlToBlob(proof.dataUrl, proof.mimeType)
    if (!blob) return null

    // The server signs content-length, so the size declared here is the size
    // that must actually be sent — blob.size, never the FileDrop metadata,
    // which can differ after the data-URL round trip.
    const res = await fetch(`${apiUrl}/storage/upload-url`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ contentType: blob.type, bytes: blob.size }),
    })
    if (!res.ok) return null
    const body = await res.json().catch(() => ({}))
    // { available: false } is the normal answer for a school with no bucket.
    if (!body.available || !body.url || !body.key) return null

    const put = await fetch(body.url, { method: 'PUT', body: blob })
    if (!put.ok) return null

    return { key: body.key, storageId: body.storageId, mime: blob.type, bytes: blob.size }
  } catch {
    return null
  }
}

/**
 * Asks the server for a short-lived URL to view a log's stored proof. Every
 * call is recorded in the audit trail (#146), so callers should request one
 * when the viewer actually opens the file — not speculatively.
 */
export async function proofDownloadUrl(serverLogId) {
  const headers = authHeaders()
  if (!headers || !serverLogId) return null
  try {
    const res = await fetch(`${apiUrl}/storage/download-url/${encodeURIComponent(serverLogId)}`, { headers })
    if (!res.ok) return null
    const body = await res.json().catch(() => ({}))
    return body.url || null
  } catch {
    return null
  }
}
