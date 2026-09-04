import express from 'express'
import rateLimit from 'express-rate-limit'
import { timingSafeEqual } from 'crypto'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { pruneAuditEvents, retentionDays } from '../audit.js'

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// Same pattern as the parent weekly digest: the x-cron-key header is the
// credential, compared in constant time.
function checkCronKey(req) {
  const secret = process.env.CRON_SECRET
  if (!secret) return { code: 503, error: 'Audit pruning is not configured.' }
  const provided = Buffer.from(String(req.get('x-cron-key') || ''))
  const expected = Buffer.from(secret)
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { code: 401, error: 'Not authorized.' }
  }
  return null
}

// Which tenant's events the caller may read. A school sees its own school's
// trail, an org its own; admin sees everything. There is deliberately no
// route that lets anyone read another tenant's trail.
async function scopeFor(auth) {
  if (auth.role === 'admin') return { unrestricted: true }
  const { rows } = await query('SELECT school_id, organization_id FROM users WHERE id = $1', [auth.sub])
  const me = rows[0]
  if (!me) return null
  if (auth.role === 'school' || auth.role === 'school_staff') {
    return me.school_id ? { schoolId: me.school_id } : null
  }
  if (auth.role === 'org') {
    return me.organization_id ? { organizationId: me.organization_id } : null
  }
  return null
}

function publicEvent(row) {
  return {
    id: row.id,
    // actor_id is null once that account is deleted; role and hash survive so
    // the event stays attributable without retaining the identity.
    actorId: row.actor_id,
    actorRole: row.actor_role,
    actorName: row.actor_name || null,
    actorRef: row.actor_hash ? row.actor_hash.slice(0, 8) : null,
    action: row.action,
    outcome: row.outcome,
    subjectUserId: row.subject_user_id,
    subjectName: row.subject_name || null,
    objectType: row.object_type,
    objectId: row.object_id,
    ip: row.ip,
    meta: row.meta,
    createdAt: row.created_at,
  }
}

// GET /api/audit — the tenant's own access trail, newest first.
// Filters: subjectUserId, action, before (ISO cursor), limit.
router.get(
  '/',
  limiter,
  requireDb,
  requireAuth('school', 'school_staff', 'org', 'admin'),
  async (req, res) => {
    try {
      const scope = await scopeFor(req.auth)
      if (!scope) return res.status(403).json({ error: 'Not allowed.' })

      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500)
      const conditions = []
      const params = []

      if (!scope.unrestricted) {
        params.push(scope.schoolId || null, scope.organizationId || null)
        conditions.push(`(($1::text IS NOT NULL AND e.school_id = $1)
                       OR ($2::text IS NOT NULL AND e.organization_id = $2))`)
      }
      if (req.query.subjectUserId) {
        params.push(String(req.query.subjectUserId))
        conditions.push(`e.subject_user_id = $${params.length}`)
      }
      if (req.query.action) {
        params.push(String(req.query.action))
        conditions.push(`e.action = $${params.length}`)
      }
      if (req.query.before) {
        const before = new Date(String(req.query.before))
        if (Number.isNaN(before.getTime())) return res.status(400).json({ error: 'Invalid cursor.' })
        params.push(before.toISOString())
        conditions.push(`e.created_at < $${params.length}`)
      }
      params.push(limit)

      const { rows } = await query(
        `SELECT e.*, a.name AS actor_name, s.name AS subject_name
           FROM audit_events e
           LEFT JOIN users a ON a.id = e.actor_id
           LEFT JOIN users s ON s.id = e.subject_user_id
          ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
          ORDER BY e.created_at DESC
          LIMIT $${params.length}`,
        params,
      )

      return res.json({
        events: rows.map(publicEvent),
        // Cursor for the next page; null once a short page comes back.
        nextBefore: rows.length === limit ? rows[rows.length - 1].created_at : null,
        retentionDays: retentionDays(),
      })
    } catch (error) {
      console.error('list audit events failed:', error)
      return res.status(500).json({ error: 'Could not load the audit trail.' })
    }
  },
)

// POST /api/audit/internal/prune — retention. Called on a schedule by
// .github/workflows/audit-prune.yml, since Render's free tier has no cron.
// Deletes by age only; there is no route that deletes a specific event.
router.post('/internal/prune', requireDb, async (req, res) => {
  const bad = checkCronKey(req)
  if (bad) return res.status(bad.code).json({ error: bad.error })
  try {
    return res.json(await pruneAuditEvents())
  } catch (error) {
    console.error('audit prune failed:', error)
    return res.status(500).json({ error: 'Could not prune the audit trail.' })
  }
})

export default router
