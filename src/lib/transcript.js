// Signed, portable transcripts (#143 Part B). The server signs; this module
// just moves the JSON file between the student, the API, and whoever receives
// it. See server/routes/transcript.js.

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authToken() {
  return localStorage.getItem('voluntrack:auth_token')
}

export function hasAccountSession() {
  return Boolean(authToken())
}

async function call(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (auth) {
    const token = authToken()
    if (!token) throw new Error('Sign in to a VolunTrack account to use signed transcripts.')
    headers.Authorization = `Bearer ${token}`
  }
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.')
  return data
}

export async function downloadSignedTranscript() {
  const { transcript } = await call('/transcript', { method: 'POST', auth: true })
  const blob = new Blob([JSON.stringify(transcript, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `voluntrack-transcript-${String(transcript.issued_at).slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  return transcript
}

// Matches the server's 1MB JSON body limit — anything larger can't be one of
// our transcripts, and would be rejected before it reached the verifier.
const MAX_FILE_BYTES = 1024 * 1024

export async function readTranscriptFile(file) {
  if (!file) throw new Error('Choose a transcript file.')
  if (file.size > MAX_FILE_BYTES) throw new Error('That file is too large to be a VolunTrack transcript.')
  try {
    return JSON.parse(await file.text())
  } catch {
    throw new Error('That file is not a VolunTrack transcript.')
  }
}

// Resolves to { valid, reason?, message?, summary? } — an invalid transcript
// is a normal answer, not an error.
export function verifyTranscript(doc) {
  return call('/transcript/verify', { method: 'POST', body: doc })
}

export function importTranscript(doc) {
  return call('/transcript/import', { method: 'POST', body: doc, auth: true })
}
