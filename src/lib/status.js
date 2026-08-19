const apiUrl = () => import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// Real backend/DB health — replaces the old per-browser feature-detection
// list. Returns null if the backend itself is unreachable.
export async function getHealth() {
  try {
    const res = await fetch(`${apiUrl()}/status/health`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// Real, shared incident history (server-persisted) — replaces the old
// per-browser localStorage list.
export async function getIncidents() {
  try {
    const res = await fetch(`${apiUrl()}/status/incidents`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

export async function createIncident({ service, detail }) {
  const res = await fetch(`${apiUrl()}/status/incidents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ service, detail }),
  })
  if (!res.ok) throw new Error('Failed to create incident')
  return res.json()
}

export async function resolveIncident(id, status = 'resolved') {
  const res = await fetch(`${apiUrl()}/status/incidents/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ status }),
  })
  if (!res.ok) throw new Error('Failed to update incident')
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

export async function confirmSubscription(token) {
  const res = await fetch(`${apiUrl()}/status/subscribe/confirm/${token}`)
  if (!res.ok) throw new Error('Failed to confirm subscription')
  return res.json()
}

export async function unsubscribeFromStatus(token) {
  const res = await fetch(`${apiUrl()}/status/subscribe/unsubscribe/${token}`)
  if (!res.ok) throw new Error('Failed to unsubscribe')
  return res.json()
}
