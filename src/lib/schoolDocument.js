// Submitting a document to a school (#143 step 6).
//
// Where the school has connected its own bucket, the file goes straight from
// the browser to that bucket and VolunTrack stores only a pointer — the same
// path proof files already take. Where it hasn't, we fall back to the old
// base64 upload, so a school that never configures storage keeps working.
//
// Shared by the School dashboard and Reports so the two can't drift.

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsDataURL(file)
  })
}

/**
 * Uploads `file` (a File or Blob) and records it against the caller's school.
 * Returns { id, direct } — `direct` is true when the bytes went to the
 * school's own storage and never passed through us.
 */
export async function submitDocumentToSchool(file, { filename, fileType } = {}) {
  const name = filename || file.name || `document-${Date.now()}.pdf`
  const type = fileType || file.type || 'application/pdf'

  // Ask for a presigned PUT first. `available: false` just means this student's
  // school has no active bucket — not an error.
  let minted = null
  try {
    const res = await fetch(`${apiUrl}/storage/upload-url`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ contentType: type, bytes: file.size, kind: 'document' }),
    })
    if (res.ok) {
      const data = await res.json()
      if (data.available) minted = data
    }
  } catch {
    // Network trouble reaching us: fall through to the base64 path, which
    // fails loudly on its own if the server is really unreachable.
  }

  if (minted) {
    // content-length is signed into the URL, so the PUT must match the size
    // declared above exactly.
    const put = await fetch(minted.url, {
      method: 'PUT',
      headers: { 'Content-Type': type },
      body: file,
    })
    if (!put.ok) throw new Error('Could not upload the file to your school’s storage.')

    const res = await fetch(`${apiUrl}/school/upload`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        filename: name,
        fileType: type,
        storageId: minted.storageId,
        objectKey: minted.key,
        fileBytes: file.size,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Upload failed')
    return { id: data.id, direct: true }
  }

  const fileData = await readAsBase64(file)
  const res = await fetch(`${apiUrl}/school/upload`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ filename: name, fileData, fileType: type }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Upload failed')
  return { id: data.id, direct: false }
}
