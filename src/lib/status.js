const apiUrl = () => import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// A poll that reached the backend but came back without usable health data —
// most often a 429, since /status polls on a timer and shares one rate-limit
// budget. It means "no new information", NOT "the backend is down": callers
// must keep the last known state rather than paint the page red, or the
// status page reports a false outage for the server that just answered it.
export const HEALTH_UNKNOWN = 'unknown'

// Gateway-level failures are the ones that really do mean the backend isn't
// there (Render asleep, proxy with nothing behind it).
const DOWN_STATUSES = [502, 503, 504]

// Real backend/DB health — replaces the old per-browser feature-detection
// list. Returns null if the backend itself is unreachable, or HEALTH_UNKNOWN
// if it answered but told us nothing about its health.
export async function getHealth() {
  try {
    const res = await fetch(`${apiUrl()}/status/health`, { signal: AbortSignal.timeout(5000) })
    if (res.ok) return await res.json()
    return DOWN_STATUSES.includes(res.status) ? null : HEALTH_UNKNOWN
  } catch {
    // Network error or timeout — nothing answered at all.
    return null
  }
}

// Real, shared incident history (server-persisted) — replaces the old
// per-browser localStorage list. Returns null when the fetch didn't produce a
// list, so a rate-limited poll leaves the incidents already on screen alone
// instead of blanking them to "no incidents".
export async function getIncidents() {
  try {
    const res = await fetch(`${apiUrl()}/status/incidents`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const data = await res.json()
    return Array.isArray(data) ? data : null
  } catch {
    return null
  }
}

export async function createIncident({ service, detail, issueUrl }) {
  const res = await fetch(`${apiUrl()}/status/incidents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ service, detail, issueUrl }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Failed to create incident')
  return res.json()
}

export async function resolveIncident(id, status = 'resolved') {
  const res = await fetch(`${apiUrl()}/status/incidents/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ status }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Failed to update incident')
  return res.json()
}

// Resolving only marks an incident closed — it stays in the public list. This
// removes it outright, and can't be undone.
export async function deleteIncident(id) {
  const res = await fetch(`${apiUrl()}/status/incidents/${id}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Failed to delete incident')
  return res.json()
}

// Opt in to incident emails — double opt-in, a confirmation link is sent
// before this address actually starts receiving anything.
export async function subscribeToStatus(email) {
  const res = await fetch(`${apiUrl()}/status/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Failed to subscribe')
  return res.json()
}

// Both of these are POSTs on purpose — see the route comment in
// server/routes/status.js. They must only ever run from an explicit click,
// never from a page load, or an email link scanner will trigger them.
export async function confirmSubscription(token) {
  const res = await fetch(`${apiUrl()}/status/subscribe/confirm/${token}`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to confirm subscription')
  return res.json()
}

export async function unsubscribeFromStatus(token) {
  const res = await fetch(`${apiUrl()}/status/subscribe/unsubscribe/${token}`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to unsubscribe')
  return res.json()
}
