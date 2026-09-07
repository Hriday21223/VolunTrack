import express from 'express'
import rateLimit from 'express-rate-limit'
import validator from 'validator'
import { resolveTxt } from 'dns/promises'
import { query, hasDatabase } from '../db.js'
import { uid, generateToken } from '../ids.js'
import { requireAuth } from '../auth.js'
import {
  cloudflareConfigured, cnameTarget, createCustomHostname, getCustomHostname,
  deleteCustomHostname, isHostnameActive, hostnameStatusDetail,
} from '../cloudflare.js'
import { invalidateTenantOrigins } from '../tenantOrigins.js'

const router = express.Router()

// Public and unauthenticated — the SPA calls this before anyone has signed in,
// so it must never return more than a tenant's public face: display name,
// branding, and the SSO buttons GET /api/auth/sso/discover already exposes.
const tenantLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// Hostnames arrive from window.location.host, so they can carry a port, a
// trailing dot, or mixed case. Normalise before matching the UNIQUE column.
export function normalizeHostname(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return null
  const noPort = raw.replace(/:\d+$/, '')
  const noTrailingDot = noPort.replace(/\.$/, '')
  // Anything that isn't plausibly a hostname is rejected rather than queried.
  if (!/^[a-z0-9.-]{1,253}$/.test(noTrailingDot)) return null
  return noTrailingDot
}

// GET /api/tenant/by-host?host=lincoln.voluntrack.app
// Returns { tenant: null } for an unknown host — the app then behaves exactly
// as it does today. A miss and a disabled/unprovisioned domain are
// deliberately indistinguishable, so this can't be used to enumerate which
// hostnames are claimed but not yet live.
router.get('/by-host', tenantLimiter, requireDb, async (req, res) => {
  const host = normalizeHostname(req.query.host)
  if (!host) return res.json({ tenant: null })

  try {
    const { rows } = await query(
      `SELECT d.school_id, d.organization_id, d.kind,
              s.name AS school_name, s.brand_logo_url AS school_logo, s.brand_color AS school_color,
              o.name AS org_name,    o.brand_logo_url AS org_logo,    o.brand_color AS org_color
         FROM tenant_domains d
         LEFT JOIN schools       s ON s.id = d.school_id
         LEFT JOIN organizations o ON o.id = d.organization_id
        WHERE d.hostname = $1 AND d.status = 'active'
        LIMIT 1`,
      [host],
    )
    const row = rows[0]
    if (!row) return res.json({ tenant: null })

    // A domain belongs to either a school or an organization; prefer the
    // school when both somehow resolve, since that is the narrower scope.
    const isSchool = Boolean(row.school_id)
    const name = isSchool ? row.school_name : row.org_name
    if (!name) return res.json({ tenant: null }) // owner row deleted underneath us

    // Only connections that are enabled AND hold a verified domain can be
    // offered, matching the gate in /api/auth/sso/discover.
    const { rows: ssoRows } = await query(
      `SELECT DISTINCT c.id, c.display_name
         FROM sso_connections c
         JOIN sso_email_domains d ON d.connection_id = c.id AND d.verified_at IS NOT NULL
        WHERE c.enabled = true
          AND ($1::text IS NOT NULL AND c.school_id = $1
               OR $2::text IS NOT NULL AND c.organization_id = $2)`,
      [row.school_id, row.organization_id],
    )

    return res.json({
      tenant: {
        kind: row.kind,
        scope: isSchool ? 'school' : 'organization',
        schoolId: row.school_id,
        organizationId: row.organization_id,
        name,
        branding: {
          logoUrl: (isSchool ? row.school_logo : row.org_logo) || null,
          color: (isSchool ? row.school_color : row.org_color) || null,
        },
        sso: ssoRows.map((c) => ({ connectionId: c.id, displayName: c.display_name })),
      },
    })
  } catch (error) {
    console.error('tenant by-host failed:', error)
    // Fail open to the untenanted app rather than breaking the login page.
    return res.json({ tenant: null })
  }
})

// ---------------------------------------------------------------------------
// Admin: a school or organization claims a hostname
// ---------------------------------------------------------------------------

// Ownership of a customer-owned domain is proven with a TXT record at this
// prefix, so we never provision TLS for a hostname the claimant doesn't
// control. Without it, anyone could claim volunteer.<someone-else>.edu and
// have Cloudflare attempt a certificate for it.
const TXT_PREFIX = '_voluntrack-verify'

function txtRecordName(hostname) {
  return `${TXT_PREFIX}.${hostname}`
}

// Which school/org the caller may act for. Mirrors authSso.js's scoping.
async function ownerFor(auth) {
  const { rows } = await query('SELECT school_id, organization_id FROM users WHERE id = $1', [auth.sub])
  const me = rows[0] || {}
  if (auth.role === 'school' || auth.role === 'school_staff') {
    return me.school_id ? { schoolId: me.school_id, orgId: null } : null
  }
  if (auth.role === 'org') {
    return me.organization_id ? { schoolId: null, orgId: me.organization_id } : null
  }
  if (auth.role === 'admin') return { schoolId: null, orgId: null, unrestricted: true }
  return null
}

async function canManage(auth, row) {
  if (auth.role === 'admin') return true
  const owner = await ownerFor(auth)
  if (!owner) return false
  if (owner.schoolId && row.school_id === owner.schoolId) return true
  if (owner.orgId && row.organization_id === owner.orgId) return true
  return false
}

function publicDomain(row) {
  return {
    id: row.id,
    hostname: row.hostname,
    kind: row.kind,
    status: row.status,
    tlsStatus: row.tls_status,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    // Everything an admin needs to put in their DNS, so the UI never has to
    // reconstruct it.
    dns: {
      txtName: txtRecordName(row.hostname),
      txtValue: row.verify_token,
      cnameName: row.hostname,
      cnameTarget: cnameTarget() || null,
    },
  }
}

// GET /api/tenant/domains — list the caller's claimed hostnames.
router.get('/domains', requireDb, requireAuth('school', 'school_staff', 'org', 'admin'), async (req, res) => {
  try {
    const owner = await ownerFor(req.auth)
    if (!owner) return res.status(400).json({ error: 'Your account is not linked to a school or organization.' })

    const { rows } = owner.unrestricted
      ? await query('SELECT * FROM tenant_domains ORDER BY created_at DESC')
      : await query(
          `SELECT * FROM tenant_domains
            WHERE ($1::text IS NOT NULL AND school_id = $1)
               OR ($2::text IS NOT NULL AND organization_id = $2)
            ORDER BY created_at DESC`,
          [owner.schoolId, owner.orgId],
        )

    return res.json({
      domains: rows.map(publicDomain),
      cnameTarget: cnameTarget() || null,
      // The UI needs to explain *why* activation is unavailable rather than
      // letting an admin add a domain that can never go live.
      provisioningConfigured: cloudflareConfigured(),
    })
  } catch (error) {
    console.error('list tenant domains failed:', error)
    return res.status(500).json({ error: 'Could not load domains.' })
  }
})

// POST /api/tenant/domains { hostname } — claim a hostname.
router.post('/domains', requireDb, requireAuth('school', 'school_staff', 'org', 'admin'), async (req, res) => {
  try {
    const owner = await ownerFor(req.auth)
    if (!owner) return res.status(400).json({ error: 'Your account is not linked to a school or organization.' })

    const hostname = normalizeHostname(req.body.hostname)
    if (!hostname || !validator.isFQDN(hostname)) {
      return res.status(400).json({ error: 'A valid hostname is required, e.g. volunteer.yourschool.edu.' })
    }

    // UNIQUE(hostname) would catch this, but a clear 409 beats a constraint
    // error — and it must not reveal *who* holds it.
    const { rows: existing } = await query('SELECT id FROM tenant_domains WHERE hostname = $1', [hostname])
    if (existing[0]) return res.status(409).json({ error: 'That hostname is already claimed.' })

    let schoolId = owner.schoolId
    let orgId = owner.orgId
    if (owner.unrestricted) {
      schoolId = req.body.schoolId || null
      orgId = req.body.organizationId || null
      if (!schoolId && !orgId) return res.status(400).json({ error: 'A schoolId or organizationId is required.' })
    }

    const id = uid('tdom')
    await query(
      `INSERT INTO tenant_domains (id, school_id, organization_id, hostname, kind, status, verify_token)
       VALUES ($1,$2,$3,$4,'custom','pending',$5)`,
      [id, schoolId, orgId, hostname, `voluntrack-verify=${generateToken().slice(0, 32)}`],
    )

    const { rows } = await query('SELECT * FROM tenant_domains WHERE id = $1', [id])
    return res.status(201).json({ domain: publicDomain(rows[0]) })
  } catch (error) {
    console.error('claim tenant domain failed:', error)
    return res.status(500).json({ error: 'Could not add the domain.' })
  }
})

// POST /api/tenant/domains/:id/verify — check the TXT record, then ask
// Cloudflare to start issuing a certificate.
router.post('/domains/:id/verify', requireDb, requireAuth('school', 'school_staff', 'org', 'admin'), async (req, res) => {
  try {
    const { rows: found } = await query('SELECT * FROM tenant_domains WHERE id = $1', [req.params.id])
    const row = found[0]
    if (!row) return res.status(404).json({ error: 'Domain not found.' })
    if (!(await canManage(req.auth, row))) return res.status(403).json({ error: 'Not allowed.' })
    if (row.status === 'active') return res.json({ domain: publicDomain(row) })

    let records = []
    try {
      records = await resolveTxt(txtRecordName(row.hostname))
    } catch {
      return res.status(400).json({
        error: `No TXT record found at ${txtRecordName(row.hostname)} yet. DNS changes can take a while to propagate.`,
      })
    }
    // resolveTxt returns chunked strings per record; join before comparing.
    const flat = records.map((chunks) => chunks.join('').trim())
    if (!flat.includes(row.verify_token)) {
      return res.status(400).json({ error: 'The expected TXT value was not found on that record yet.' })
    }

    await query('UPDATE tenant_domains SET verified_at = now() WHERE id = $1', [row.id])

    // Ownership is proven. Without Cloudflare configured we stop here rather
    // than pretending the domain is live — it cannot serve TLS yet.
    if (!cloudflareConfigured()) {
      const { rows: after } = await query('SELECT * FROM tenant_domains WHERE id = $1', [row.id])
      return res.status(503).json({
        error: 'Ownership verified, but TLS provisioning is not configured on this server yet.',
        domain: publicDomain(after[0]),
      })
    }

    let created
    try {
      created = await createCustomHostname(row.hostname)
    } catch (error) {
      console.error('cloudflare custom hostname failed:', error.message)
      return res.status(502).json({ error: error.message })
    }

    await query(
      `UPDATE tenant_domains
          SET status = $1, cf_hostname_id = $2, tls_status = $3
        WHERE id = $4`,
      [isHostnameActive(created) ? 'active' : 'verifying', created.id, created.ssl?.status || null, row.id],
    )
    // A domain that just went active must be accepted by CORS immediately,
    // not after the 60s cache TTL.
    invalidateTenantOrigins()

    const { rows: after } = await query('SELECT * FROM tenant_domains WHERE id = $1', [row.id])
    return res.json({ domain: publicDomain(after[0]), cloudflare: hostnameStatusDetail(created) })
  } catch (error) {
    console.error('verify tenant domain failed:', error)
    return res.status(500).json({ error: 'Could not verify the domain.' })
  }
})

// POST /api/tenant/domains/:id/refresh — re-read certificate progress.
// Certificate issuance is asynchronous, so the admin needs a way to check
// without us polling Cloudflare on a timer.
router.post('/domains/:id/refresh', requireDb, requireAuth('school', 'school_staff', 'org', 'admin'), async (req, res) => {
  try {
    const { rows: found } = await query('SELECT * FROM tenant_domains WHERE id = $1', [req.params.id])
    const row = found[0]
    if (!row) return res.status(404).json({ error: 'Domain not found.' })
    if (!(await canManage(req.auth, row))) return res.status(403).json({ error: 'Not allowed.' })
    if (!row.cf_hostname_id) return res.status(400).json({ error: 'This domain has not been submitted for a certificate yet.' })
    if (!cloudflareConfigured()) return res.status(503).json({ error: 'TLS provisioning is not configured on this server.' })

    let result
    try {
      result = await getCustomHostname(row.cf_hostname_id)
    } catch (error) {
      return res.status(502).json({ error: error.message })
    }

    await query(
      'UPDATE tenant_domains SET status = $1, tls_status = $2 WHERE id = $3',
      [isHostnameActive(result) ? 'active' : 'verifying', result.ssl?.status || null, row.id],
    )
    invalidateTenantOrigins()

    const { rows: after } = await query('SELECT * FROM tenant_domains WHERE id = $1', [row.id])
    return res.json({ domain: publicDomain(after[0]), cloudflare: hostnameStatusDetail(result) })
  } catch (error) {
    console.error('refresh tenant domain failed:', error)
    return res.status(500).json({ error: 'Could not refresh the domain.' })
  }
})

// DELETE /api/tenant/domains/:id — release a hostname.
router.delete('/domains/:id', requireDb, requireAuth('school', 'school_staff', 'org', 'admin'), async (req, res) => {
  try {
    const { rows: found } = await query('SELECT * FROM tenant_domains WHERE id = $1', [req.params.id])
    const row = found[0]
    if (!row) return res.status(404).json({ error: 'Domain not found.' })
    if (!(await canManage(req.auth, row))) return res.status(403).json({ error: 'Not allowed.' })

    // Best effort: a stale custom hostname left in Cloudflare would keep
    // serving the old certificate and block anyone re-claiming the name, but
    // a failure here must not prevent releasing our own row.
    if (row.cf_hostname_id && cloudflareConfigured()) {
      try { await deleteCustomHostname(row.cf_hostname_id) } catch (error) {
        console.error('cloudflare hostname delete failed (continuing):', error.message)
      }
    }

    await query('DELETE FROM tenant_domains WHERE id = $1', [row.id])
    // Stop honouring the released hostname's Origin right away.
    invalidateTenantOrigins()
    return res.json({ ok: true })
  } catch (error) {
    console.error('delete tenant domain failed:', error)
    return res.status(500).json({ error: 'Could not remove the domain.' })
  }
})

export default router
