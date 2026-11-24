import { tr } from '@/lib/i18n.js'
import { SITE } from '@/lib/starterKit.js'

// Client side of Year in review share links (server/routes/yearShare.js, #1005).

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return token ? { Authorization: `Bearer ${token}` } : null
}

export function hasServerSession() {
  return Boolean(authHeaders())
}

async function call(path, { method = 'GET', body, fallback } = {}) {
  const headers = { ...(authHeaders() || {}) }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${apiUrl}/year-share${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = new Error(data.error ? tr(data.error) : fallback)
    error.status = res.status
    error.code = data.code
    throw error
  }
  return data
}

export const getMyYearShares = () => call('/mine', { fallback: tr('Could not load your share links.') })

export const saveYearShare = (year, showName) =>
  call(`/mine/${year}`, { method: 'PUT', body: { showName }, fallback: tr('Could not make your share link.') })

export const deleteYearShare = (year) =>
  call(`/mine/${year}`, { method: 'DELETE', fallback: tr('Could not turn off your share link.') })

export const getPublicYearShare = (slug) =>
  call(`/public/${encodeURIComponent(slug)}`, { fallback: tr('Could not load this page.') })

export const yearShareUrl = (slug) => `${SITE}/y/${slug}`
