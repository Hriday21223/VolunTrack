// Write-through sync of a student's logs to the server, for authenticated
// (server-backed) accounts only. Never throws — a failed sync just means
// that log stays local-only, matching the app's existing dual-mode design.

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } : null
}

export async function syncCreateLog(log) {
  const headers = authHeaders()
  if (!headers) return null
  try {
    const res = await fetch(`${apiUrl}/logs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        date: log.date,
        activity: log.activity,
        category: log.category,
        hours: log.hours,
        notes: log.notes,
        supervisorName: log.supervisorName || null,
        supervisorEmail: log.supervisorEmail || null,
        supervisorSignature: log.supervisorSignature || null,
        proofPhotoData: log.proof?.dataUrl || null,
        proofPhotoType: log.proof?.mimeType || null,
      }),
    })
    if (!res.ok) return null
    const body = await res.json().catch(() => ({}))
    return body.id || null
  } catch {
    return null
  }
}

export async function syncUpdateLog(serverId, patch) {
  const headers = authHeaders()
  if (!headers || !serverId) return
  // `proof` is a FileDrop value object ({ dataUrl, mimeType, name }) in the
  // local log shape; the server expects it flattened, same as syncCreateLog.
  const { proof, ...rest } = patch
  const body = { ...rest }
  if (proof !== undefined) {
    body.proofPhotoData = proof?.dataUrl || null
    body.proofPhotoType = proof?.mimeType || null
  }
  try {
    await fetch(`${apiUrl}/logs/${serverId}`, { method: 'PATCH', headers, body: JSON.stringify(body) })
  } catch {
    // best-effort
  }
}

export async function syncDeleteLog(serverId) {
  const headers = authHeaders()
  if (!headers || !serverId) return
  try {
    await fetch(`${apiUrl}/logs/${serverId}`, { method: 'DELETE', headers })
  } catch {
    // best-effort
  }
}
