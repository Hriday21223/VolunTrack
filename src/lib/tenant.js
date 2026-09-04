// Resolves which school/organization the current hostname belongs to, so the
// app can brand itself and offer that tenant's SSO buttons before anyone has
// signed in. An unknown host resolves to null and the app behaves exactly as
// it always has — that is the common case (the canonical domain), so this must
// stay cheap and must never block rendering.

const apiUrl = import.meta.env.VITE_API_URL || '/api'

const CACHE_KEY = 'voluntrack:tenant'
// Short: branding and SSO buttons change rarely, but a stale cache showing a
// removed SSO button is worse than one extra request per session.
const CACHE_TTL_MS = 10 * 60 * 1000

let inflight = null

function readCache(host) {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return undefined
    const entry = JSON.parse(raw)
    if (entry.host !== host) return undefined
    if (Date.now() - entry.at > CACHE_TTL_MS) return undefined
    return entry.tenant
  } catch {
    // Private mode / disabled storage — just skip the cache.
    return undefined
  }
}

function writeCache(host, tenant) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ host, tenant, at: Date.now() }))
  } catch { /* storage unavailable — caching is optional */ }
}

/**
 * @returns {Promise<null | {
 *   kind: 'vanity'|'custom', scope: 'school'|'organization',
 *   schoolId: string|null, organizationId: string|null, name: string,
 *   branding: { logoUrl: string|null, color: string|null },
 *   sso: Array<{ connectionId: string, displayName: string }>,
 * }>}
 */
export function resolveTenant() {
  if (typeof window === 'undefined') return Promise.resolve(null)
  const host = window.location.host

  const cached = readCache(host)
  if (cached !== undefined) return Promise.resolve(cached)

  // Several components may ask at once on first paint; only one request goes out.
  if (inflight) return inflight

  inflight = fetch(`${apiUrl}/tenant/by-host?host=${encodeURIComponent(host)}`)
    .then((res) => (res.ok ? res.json() : { tenant: null }))
    .then((data) => {
      const tenant = data?.tenant ?? null
      writeCache(host, tenant)
      return tenant
    })
    // Backend unreachable (client-only demo mode, offline) — untenanted.
    .catch(() => null)
    .finally(() => { inflight = null })

  return inflight
}

export function clearTenantCache() {
  try { sessionStorage.removeItem(CACHE_KEY) } catch { /* nothing to clear */ }
}
