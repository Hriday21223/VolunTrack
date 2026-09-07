// Cloudflare for SaaS custom hostnames — on-demand TLS for customer-owned
// domains (volunteer.lincolnhs.edu) pointed at our zone.
//
// Entirely opt-in, same pattern as server/turnstile.js: with
// CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID unset every call reports
// "not configured" and the routes degrade to a clear 503 rather than
// failing obscurely. That keeps local dev, the client-only demo, and any
// deployment without a Cloudflare zone working unchanged.
//
// Requires a zone (a domain on Cloudflare's nameservers) with a proxied
// fallback-origin record. See #124.

const API_BASE = 'https://api.cloudflare.com/client/v4'

function token() { return process.env.CLOUDFLARE_API_TOKEN || '' }
function zoneId() { return process.env.CLOUDFLARE_ZONE_ID || '' }

export function cloudflareConfigured() {
  return Boolean(token() && zoneId())
}

// The hostname customers CNAME to. Must live inside the Cloudflare zone.
// Surfaced to admins in the DNS instructions, so it has to be right.
export function cnameTarget() {
  return process.env.TENANT_CNAME_TARGET || ''
}

async function cf(path, { method = 'GET', body } = {}) {
  if (!cloudflareConfigured()) throw new Error('Cloudflare is not configured.')
  const res = await fetch(`${API_BASE}/zones/${zoneId()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  let data = null
  try { data = await res.json() } catch { /* non-JSON error page */ }

  if (!res.ok || !data?.success) {
    // Cloudflare returns a structured errors array; surface the first message
    // so an admin sees "hostname already exists" rather than a bare 500.
    const detail = data?.errors?.[0]?.message || `HTTP ${res.status}`
    const err = new Error(`Cloudflare: ${detail}`)
    err.cfCode = data?.errors?.[0]?.code
    err.status = res.status
    throw err
  }
  return data.result
}

/**
 * Registers a custom hostname. Cloudflare issues a certificate once it can
 * validate ownership; with the customer's CNAME already in place that happens
 * automatically (http/txt DCV), which is why we only call this *after* our own
 * TXT ownership check passes.
 */
export async function createCustomHostname(hostname) {
  return cf('/custom_hostnames', {
    method: 'POST',
    body: {
      hostname,
      ssl: {
        method: 'http',
        type: 'dv',
        settings: { min_tls_version: '1.2' },
      },
    },
  })
}

export async function getCustomHostname(id) {
  return cf(`/custom_hostnames/${encodeURIComponent(id)}`)
}

export async function deleteCustomHostname(id) {
  return cf(`/custom_hostnames/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// Cloudflare reports certificate progress under ssl.status; 'active' is the
// only value that means the hostname is actually serving traffic over TLS.
export function isHostnameActive(result) {
  return result?.status === 'active' && result?.ssl?.status === 'active'
}

export function hostnameStatusDetail(result) {
  if (!result) return null
  return {
    hostnameStatus: result.status || null,
    sslStatus: result.ssl?.status || null,
    // Present while Cloudflare still needs a DCV record; worth showing so an
    // admin knows whether they're waiting on us or on their DNS.
    validationErrors: (result.ssl?.validation_errors || []).map((e) => e.message).filter(Boolean),
  }
}
