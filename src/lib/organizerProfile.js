// Organizer profiles (server/routes/organizerProfile.js): the About/website/
// causes an organizer fills in Settings, and the /organizers/:id page.

const apiUrl = import.meta.env.VITE_API_URL || '/api'

export const MAX_ABOUT = 500

function token() {
  try { return localStorage.getItem('voluntrack:auth_token') } catch { return null }
}

export const hasSession = () => Boolean(token())

async function call(path, init = {}) {
  const t = token()
  if (!t) return null
  const res = await fetch(`${apiUrl}/school/organizers${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${t}` },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed')
    err.status = res.status
    throw err
  }
  return data
}

export const fetchMyOrganizerProfile = () => call('/me').then((d) => d?.profile ?? null)
export const saveMyOrganizerProfile = (profile) => call('/me', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(profile),
}).then((d) => d?.profile ?? null)
export const fetchOrganizer = (id) => call(`/${encodeURIComponent(id)}`)

// Follow / unfollow: the same endpoints as the Follow button on Opportunities.
export async function setFollowOrganizer(id, follow) {
  const t = token()
  const res = await fetch(`${apiUrl}/school/public-tasks/organizers/${encodeURIComponent(id)}/follow`, {
    method: follow ? 'POST' : 'DELETE',
    headers: { Authorization: `Bearer ${t}` },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

// Matches the server's rule: a full https:// address (the server re-checks).
export function isHttpsUrl(v) {
  const s = String(v || '').trim()
  if (!s) return true
  try {
    const u = new URL(s)
    return u.protocol === 'https:' && u.hostname.includes('.') && !u.username && !u.password
  } catch { return false }
}

export function organizerPath(id) {
  return `/organizers/${encodeURIComponent(id)}`
}

export function organizerShareUrl(id, origin) {
  return `${String(origin || '').replace(/\/+$/, '')}${organizerPath(id)}`
}
