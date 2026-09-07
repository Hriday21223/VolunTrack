import { query, hasDatabase } from './db.js'

// A tenant on its own hostname calls this API cross-origin, so the static CORS
// allowlist has to grow to include every active tenant domain.
//
// This is deliberately a lookup against a cached *set of known hostnames*, not
// a predicate over the incoming Origin. Reflecting whatever Origin arrives
// would hand any site credentialed access to the API.

const TTL_MS = 60 * 1000

let cache = new Set()
let loadedAt = 0
let inflight = null

async function load() {
  const { rows } = await query(
    "SELECT hostname FROM tenant_domains WHERE status = 'active'",
  )
  cache = new Set(rows.map((r) => r.hostname))
  loadedAt = Date.now()
  return cache
}

async function activeHostnames() {
  if (!hasDatabase()) return new Set()
  if (Date.now() - loadedAt < TTL_MS) return cache
  if (inflight) return inflight
  inflight = load()
    .catch((error) => {
      // Keep serving the last known good set rather than locking tenants out
      // on a transient database blip.
      console.error('tenant origin refresh failed:', error.message)
      return cache
    })
    .finally(() => { inflight = null })
  return inflight
}

// Call after any write that changes which hostnames are active, so an admin
// doesn't wait out the TTL to see a domain start working.
export function invalidateTenantOrigins() {
  loadedAt = 0
}

/**
 * @param {string} origin e.g. "https://volunteer.lincolnhs.edu"
 * @returns {Promise<boolean>}
 */
export async function isAllowedTenantOrigin(origin) {
  if (!origin) return false
  let host
  try {
    const url = new URL(origin)
    // Tenants are always served over TLS; permitting http would let a
    // plaintext origin borrow a tenant's credentialed access.
    if (url.protocol !== 'https:') return false
    host = url.hostname.toLowerCase()
  } catch {
    return false
  }
  const hosts = await activeHostnames()
  return hosts.has(host)
}
