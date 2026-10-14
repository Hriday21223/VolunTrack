import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { uid, generateRegistrationCode } from '../ids.js'
import {
  REGISTRATION_CODE_KINDS, DEFAULT_CODE_TTL_DAYS, MAX_CODE_TTL_DAYS, hashCode, codeHint,
} from '../registrationCodes.js'

// Admin management of one-time registration codes (#287). Redeeming one
// happens inside POST /api/school/register and /api/organization/register.
const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// POST /api/registration-codes/admin — the response is the only time the
// full code is ever shown; we keep just its hash.
router.post('/admin', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const kind = String(req.body.kind || '')
  const label = String(req.body.label || '').trim().slice(0, 120) || null
  const days = req.body.expiresInDays == null ? DEFAULT_CODE_TTL_DAYS : Number(req.body.expiresInDays)

  if (!REGISTRATION_CODE_KINDS.includes(kind)) return res.status(400).json({ error: 'Choose school or organization.' })
  if (!Number.isInteger(days) || days < 1 || days > MAX_CODE_TTL_DAYS) {
    return res.status(400).json({ error: `Expiry must be between 1 and ${MAX_CODE_TTL_DAYS} days.` })
  }

  try {
    const code = generateRegistrationCode()
    const id = uid('rgc')
    const { rows } = await query(
      `INSERT INTO registration_codes (id, kind, code_hash, code_hint, label, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
       RETURNING expires_at`,
      [id, kind, hashCode(code), codeHint(code), label, days],
    )
    return res.status(201).json({ id, code, kind, label, expiresAt: rows[0].expires_at })
  } catch (error) {
    console.error('registration code create failed:', error)
    return res.status(500).json({ error: 'Could not create a code.' })
  }
})

// GET /api/registration-codes/admin — an active code past its expiry is
// reported as expired; nothing rewrites the row.
router.get('/admin', limiter, requireDb, requireAuth('admin'), async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.kind, c.code_hint, c.label, c.status, c.expires_at, c.created_at, c.used_at,
              u.name AS used_by_name, u.email AS used_by_email
         FROM registration_codes c
         LEFT JOIN users u ON u.id = c.used_by_user_id
        ORDER BY c.created_at DESC
        LIMIT 200`,
    )
    const now = Date.now()
    return res.json({
      codes: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        hint: r.code_hint,
        label: r.label,
        status: r.status === 'active' && new Date(r.expires_at).getTime() <= now ? 'expired' : r.status,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
        usedAt: r.used_at,
        usedBy: r.used_by_email ? { name: r.used_by_name, email: r.used_by_email } : null,
      })),
    })
  } catch (error) {
    console.error('registration code list failed:', error)
    return res.status(500).json({ error: 'Could not load codes.' })
  }
})

// POST /api/registration-codes/admin/:id/revoke — only an unused code; a used
// one already backs an account.
router.post('/admin/:id/revoke', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rowCount } = await query(
      `UPDATE registration_codes SET status = 'revoked' WHERE id = $1 AND status = 'active'`,
      [req.params.id],
    )
    if (rowCount === 0) return res.status(409).json({ error: 'Only an unused code can be revoked.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('registration code revoke failed:', error)
    return res.status(500).json({ error: 'Could not revoke the code.' })
  }
})

export default router
