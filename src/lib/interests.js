// A student's interests (server/routes/interests.js): the causes they care
// about, from ACTIVITY_CATEGORIES. Signed-in students only; every call
// resolves to null when there's no session or the server can't answer.

const apiUrl = import.meta.env.VITE_API_URL || '/api'

export const MAX_INTERESTS = 10

function token() {
  try { return localStorage.getItem('voluntrack:auth_token') } catch { return null }
}

export const hasSession = () => Boolean(token())

async function call(path, init = {}) {
  const t = token()
  if (!t) return null
  const res = await fetch(`${apiUrl}/interests${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${t}` },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export const fetchInterests = () => call('').then((d) => d?.interests ?? null)
export const fetchForYou = () => call('/for-you')
export const saveInterests = (interests) => call('', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ interests }),
}).then((d) => d?.interests ?? null)

// The one-time prompt on Opportunities, once dismissed, stays dismissed on
// this device.
const DISMISS_KEY = 'voluntrack:interests-prompt-dismissed'
export function promptDismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
}
export function dismissPrompt() {
  try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* private mode */ }
}

// New opportunity alerts (#543): a weekly bell + email of new tasks in these causes.
export const fetchAlerts = () => call('/alerts').then((d) => d?.enabled ?? null)
export const saveAlerts = (enabled) => call('/alerts', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ enabled }),
}).then((d) => d?.enabled ?? null)
