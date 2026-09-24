// Best-effort notification email to a supervisor listed on a volunteer hour
// log. Mirrors recovery.js's never-throw style — this is a side effect and
// should never block or fail the log save it's attached to.

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// The server now derives the student's name and email from the session and
// requires one, so a signed-out (localStorage-only) user gets a silent
// no-op here rather than an email. It also returns only a read-only status
// handle — the token that can approve or reject lives in the supervisor's
// inbox alone.
export async function notifySupervisor({ supervisorEmail, supervisorName, hours, activity, logId }) {
  if (!supervisorEmail) return { ok: false }
  const authToken = localStorage.getItem('voluntrack:auth_token')
  if (!authToken) return { ok: false }
  try {
    const signupUrl = `${window.location.origin}${import.meta.env.BASE_URL}register`
    const response = await fetch(`${apiUrl}/notify-supervisor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ supervisorEmail, supervisorName, hours, activity, signupUrl, logId: logId || null }),
    })
    if (!response.ok) return { ok: false }
    const body = await response.json().catch(() => ({}))
    return { ok: true, statusToken: body.statusToken || null }
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
