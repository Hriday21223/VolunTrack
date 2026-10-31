// Best-effort notification email to a supervisor listed on a volunteer hour
// log. Mirrors recovery.js's never-throw style — this is a side effect and
// should never block or fail the log save it's attached to.

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// Both ways of asking a supervisor to sign go through here. The server derives
// the student's name and email from the session and requires one, so a
// signed-out (localStorage-only) user gets a silent no-op rather than a
// request. Returns the response body, or null on any failure.
async function requestVerification(path, { supervisorEmail, supervisorName, supervisorPhone, hours, activity, logId }) {
  if (!supervisorEmail) return null
  const authToken = localStorage.getItem('voluntrack:auth_token')
  if (!authToken) return null
  try {
    const signupUrl = `${window.location.origin}${import.meta.env.BASE_URL}register`
    const response = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ supervisorEmail, supervisorName, hours, activity, signupUrl, logId: logId || null, ...(supervisorPhone ? { supervisorPhone } : {}) }),
    })
    if (!response.ok) return null
    return await response.json().catch(() => ({}))
  } catch {
    return null
  }
}

// VolunTrack emails the supervisor. Only a read-only status handle comes
// back — the token that can approve or reject lives in their inbox alone.
export async function notifySupervisor(details) {
  const body = await requestVerification('/notify-supervisor', details)
  return body ? { ok: true, statusToken: body.statusToken || null, texted: Boolean(body.texted) } : { ok: false }
}

/** Whether VolunTrack can also text the supervisor (#609). */
export async function smsAvailable() {
  try {
    const res = await fetch(`${apiUrl}/notify-supervisor/sms`)
    return res.ok ? Boolean((await res.json()).available) : false
  } catch {
    return false
  }
}

// The student sends the signing link themselves (to the supervisor, or the
// task's organizer). Unlike notifySupervisor this hands back the approve link
// itself — the server records that the student held it, so the school can
// see that.
export async function createVerificationLink(details) {
  const body = await requestVerification('/verify-hours/link', details)
  return body?.verifyUrl
    ? { ok: true, verifyUrl: body.verifyUrl, statusToken: body.statusToken || null, studentName: body.studentName || '' }
    : { ok: false }
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
