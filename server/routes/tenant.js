import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'

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

export default router
