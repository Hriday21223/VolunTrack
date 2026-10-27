// Handing a school's or organization's main account to a new person (#550).
// The server side is server/handover.js.

const apiUrl = import.meta.env.VITE_API_URL || '/api'

async function call(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (auth) {
    let token = null
    try { token = localStorage.getItem('voluntrack:auth_token') } catch { /* private mode */ }
    if (!token) throw new Error('Sign in again to continue.')
    headers.Authorization = `Bearer ${token}`
  }
  const res = await fetch(`${apiUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.')
  return data
}

/** Where each starting point sends its request. */
export const HANDOVER_ENDPOINTS = {
  school: () => '/school/handover',
  orgSchool: (schoolId) => `/organization/schools/${encodeURIComponent(schoolId)}/handover`,
  org: () => '/organization/handover',
  adminOrg: (orgId) => `/organization/admin/${encodeURIComponent(orgId)}/handover`,
}

export const startHandover = (path, body) => call(path, { method: 'POST', body })
export const fetchHandover = (token) => call(`/handover/${encodeURIComponent(token)}`, { auth: false })
export const acceptHandover = (token, password) =>
  call(`/handover/${encodeURIComponent(token)}`, { method: 'POST', body: { password }, auth: false })
