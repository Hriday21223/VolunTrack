// Best-effort notification email to a supervisor listed on a volunteer hour
// log. Mirrors recovery.js's never-throw style — this is a side effect and
// should never block or fail the log save it's attached to.

const apiUrl = import.meta.env.VITE_API_URL || '/api'

export async function notifySupervisor({ supervisorEmail, supervisorName, studentName, studentEmail, hours, activity, logId }) {
  if (!supervisorEmail) return { ok: false }
  try {
    const signupUrl = `${window.location.origin}${import.meta.env.BASE_URL}register`
    const authToken = localStorage.getItem('voluntrack:auth_token')
    const headers = { 'Content-Type': 'application/json' }
    if (authToken) headers.Authorization = `Bearer ${authToken}`
    const response = await fetch(`${apiUrl}/notify-supervisor`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ supervisorEmail, supervisorName, studentName, studentEmail, hours, activity, signupUrl, logId: logId || null }),
    })
    if (!response.ok) return { ok: false }
    const body = await response.json().catch(() => ({}))
    return { ok: true, token: body.token || null }
  } catch {
    return { ok: false }
  }
}

/** Look up a supervisor verification's current status by its token. */
export async function getVerificationStatus(token) {
  try {
    const response = await fetch(`${apiUrl}/verify-hours/${encodeURIComponent(token)}`)
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}
