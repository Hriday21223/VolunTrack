import { isNativeApp } from '@/lib/platform.js'
import { tr } from '@/lib/i18n.js'

// Client side of the volunteer portfolio (server/routes/portfolio.js): the
// student's own settings, and the public page at /p/<slug>.

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
  const res = await fetch(`${apiUrl}/portfolio${path}`, {
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

export const getMyPortfolio = () => call('/mine', { fallback: tr('Could not load your portfolio settings.') })

export const saveMyPortfolio = (changes) =>
  call('/mine', { method: 'PUT', body: changes, fallback: tr('Could not save your portfolio settings.') })

export const resetMyPortfolioLink = () =>
  call('/mine/reset', { method: 'POST', fallback: tr('Could not make a new link.') })

export const getPublicPortfolio = (slug) =>
  call(`/${encodeURIComponent(slug)}`, { fallback: tr('Could not load this portfolio.') })

// The shareable address. In the apps the page's own origin is
// capacitor://localhost, so use the website's address there instead.
export function portfolioUrl(path) {
  if (!path) return ''
  const origin = isNativeApp ? (import.meta.env.VITE_SITE_URL || '') : window.location.origin
  return `${String(origin).replace(/\/$/, '')}${path}`
}
