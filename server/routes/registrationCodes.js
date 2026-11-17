import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { uid, generateRegistrationCode, generateUpgradeCode } from '../ids.js'
import {
  REGISTRATION_CODE_KINDS, DEFAULT_CODE_TTL_DAYS, MAX_CODE_TTL_DAYS, hashCode, codeHint,
} from '../registrationCodes.js'
import { hashUpgradeCode, upgradeCodeHint, readTrialDays } from '../upgradeCodes.js'
import { validEventCode, EVENT_AUDIENCES } from '../eventCodes.js'

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
  // An optional free trial (#892): the account starts paid until it ends.
  const trial = readTrialDays(req.body.trialDays)
  if (trial.error) return res.status(400).json({ error: trial.error })
  if (!Number.isInteger(days) || days < 1 || days > MAX_CODE_TTL_DAYS) {
    return res.status(400).json({ error: `Expiry must be between 1 and ${MAX_CODE_TTL_DAYS} days.` })
  }

  try {
    const code = generateRegistrationCode()
    const id = uid('rgc')
    const { rows } = await query(
      `INSERT INTO registration_codes (id, kind, code_hash, code_hint, label, expires_at, trial_days)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6), $7)
       RETURNING expires_at`,
      [id, kind, hashCode(code), codeHint(code), label, days, trial.days],
    )
    return res.status(201).json({ id, code, kind, label, trialDays: trial.days, expiresAt: rows[0].expires_at })
  } catch (error) {
    console.error('registration code create failed:', error)
    return res.status(500).json({ error: 'Could not create a code.' })
  }
})

// GET /api/registration-codes/admin — only codes that can still be used.
// Once a code is used, revoked or past its expiry it has nothing left to do,
// so the admin's list drops it; the row stays in the table as the record of
// what was issued and who redeemed it.
router.get('/admin', limiter, requireDb, requireAuth('admin'), async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, kind, code_hint, label, expires_at, created_at, trial_days
         FROM registration_codes
        WHERE status = 'active' AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 200`,
    )
    return res.json({
      codes: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        hint: r.code_hint,
        label: r.label,
        trialDays: r.trial_days,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
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

// ---------------------------------------------------------------------------
// Club upgrade codes (#892). A free club's adviser types one under "Upgrade to
// a school plan" (POST /api/school/upgrade-code). With trialDays the school
// plan is free until then; without, the code stands for a payment already made.
// ---------------------------------------------------------------------------

router.post('/admin/upgrade', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const label = String(req.body.label || '').trim().slice(0, 120) || null
  const days = req.body.expiresInDays == null ? DEFAULT_CODE_TTL_DAYS : Number(req.body.expiresInDays)
  if (!Number.isInteger(days) || days < 1 || days > MAX_CODE_TTL_DAYS) {
    return res.status(400).json({ error: `Expiry must be between 1 and ${MAX_CODE_TTL_DAYS} days.` })
  }
  const trial = readTrialDays(req.body.trialDays)
  if (trial.error) return res.status(400).json({ error: trial.error })
  try {
    const code = generateUpgradeCode()
    const id = uid('upc')
    const { rows } = await query(
      `INSERT INTO upgrade_codes (id, code_hash, code_hint, label, trial_days, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
       RETURNING expires_at`,
      [id, hashUpgradeCode(code), upgradeCodeHint(code), label, trial.days, days],
    )
    return res.status(201).json({ id, code, label, trialDays: trial.days, expiresAt: rows[0].expires_at })
  } catch (error) {
    console.error('upgrade code create failed:', error)
    return res.status(500).json({ error: 'Could not create a code.' })
  }
})

router.get('/admin/upgrade', limiter, requireDb, requireAuth('admin'), async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, code_hint, label, trial_days, expires_at, created_at FROM upgrade_codes
        WHERE status = 'active' AND expires_at > now() ORDER BY created_at DESC LIMIT 200`,
    )
    return res.json({ codes: rows.map((r) => ({ id: r.id, hint: r.code_hint, label: r.label, trialDays: r.trial_days, expiresAt: r.expires_at, createdAt: r.created_at })) })
  } catch (error) {
    console.error('upgrade code list failed:', error)
    return res.status(500).json({ error: 'Could not load codes.' })
  }
})

router.post('/admin/upgrade/:id/revoke', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rowCount } = await query(`UPDATE upgrade_codes SET status = 'revoked' WHERE id = $1 AND status = 'active'`, [req.params.id])
    if (rowCount === 0) return res.status(409).json({ error: 'Only an unused code can be revoked.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('upgrade code revoke failed:', error)
    return res.status(500).json({ error: 'Could not revoke the code.' })
  }
})

// ---------------------------------------------------------------------------
// Event codes (#907): one per team member for an event, many uses. See
// server/eventCodes.js for what a code can give and where it is accepted.
// ---------------------------------------------------------------------------

router.post('/admin/event', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const teamMember = String(req.body.teamMember || '').trim().slice(0, 80)
  const eventName = String(req.body.eventName || '').trim().slice(0, 120) || null
  const code = validEventCode(req.body.code)
  const audience = String(req.body.audience || 'both')
  const trial = readTrialDays(req.body.trialDays)
  const percentRaw = req.body.percentOff == null || req.body.percentOff === '' ? null : Number(req.body.percentOff)
  const clubUpgrade = req.body.clubUpgrade === true
  const maxUses = req.body.maxUses == null || req.body.maxUses === '' ? null : Number(req.body.maxUses)
  const days = req.body.expiresInDays == null || req.body.expiresInDays === '' ? null : Number(req.body.expiresInDays)

  if (!teamMember) return res.status(400).json({ error: 'Add the team member’s name.' })
  if (!code) return res.status(400).json({ error: 'The code must be 6 to 16 letters and numbers.' })
  if (!EVENT_AUDIENCES.includes(audience)) return res.status(400).json({ error: 'Choose schools, organizations or both.' })
  if (trial.error) return res.status(400).json({ error: trial.error })
  if (percentRaw != null && (!Number.isFinite(percentRaw) || percentRaw <= 0 || percentRaw > 100)) return res.status(400).json({ error: 'A discount must be between 1 and 100%.' })
  if (maxUses != null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10000)) return res.status(400).json({ error: 'Uses must be a whole number from 1 to 10,000.' })
  if (days != null && (!Number.isInteger(days) || days < 1 || days > 365)) return res.status(400).json({ error: 'Expiry must be 1 to 365 days.' })
  if (!trial.days && percentRaw == null && !clubUpgrade) return res.status(400).json({ error: 'Pick at least one thing the code gives: a free trial, a discount or a club upgrade.' })
  if (clubUpgrade && audience === 'organization') return res.status(400).json({ error: 'A club upgrade is for schools, so the code must be for schools or both.' })

  try {
    const id = uid('evc')
    const { rows } = await query(
      `INSERT INTO event_codes (id, code, team_member, event_name, audience, trial_days, percent_off, club_upgrade, max_uses, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $10::int IS NULL THEN NULL ELSE now() + make_interval(days => $10::int) END)
       ON CONFLICT (code) DO NOTHING
       RETURNING id`,
      [id, code, teamMember, eventName, audience, trial.days, percentRaw, clubUpgrade, maxUses, days],
    )
    if (!rows[0]) return res.status(409).json({ error: 'That code is already taken. Pick another.' })
    return res.status(201).json({ id, code })
  } catch (error) {
    console.error('event code create failed:', error)
    return res.status(500).json({ error: 'Could not create the code.' })
  }
})

router.get('/admin/event', limiter, requireDb, requireAuth('admin'), async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT e.*, COALESCE(json_agg(json_build_object(
                'entityType', u.entity_type, 'kind', u.kind, 'usedAt', u.used_at,
                'name', COALESCE(s.name, o.name))
              ORDER BY u.used_at DESC) FILTER (WHERE u.code_id IS NOT NULL), '[]') AS used_by
         FROM event_codes e
         LEFT JOIN event_code_uses u ON u.code_id = e.id
         LEFT JOIN schools s ON u.entity_type = 'school' AND s.id = u.entity_id
         LEFT JOIN organizations o ON u.entity_type = 'organization' AND o.id = u.entity_id
        GROUP BY e.id
        ORDER BY e.created_at DESC
        LIMIT 200`,
    )
    return res.json({
      codes: rows.map((r) => ({
        id: r.id, code: r.code, teamMember: r.team_member, eventName: r.event_name, audience: r.audience,
        trialDays: r.trial_days, percentOff: r.percent_off == null ? null : Number(r.percent_off), clubUpgrade: r.club_upgrade,
        maxUses: r.max_uses, uses: r.uses, expiresAt: r.expires_at, active: r.active, createdAt: r.created_at, usedBy: r.used_by,
      })),
    })
  } catch (error) {
    console.error('event code list failed:', error)
    return res.status(500).json({ error: 'Could not load codes.' })
  }
})

router.post('/admin/event/:id/active', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rowCount } = await query('UPDATE event_codes SET active = $2 WHERE id = $1', [req.params.id, req.body?.active === true])
    if (rowCount === 0) return res.status(404).json({ error: 'Code not found.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('event code toggle failed:', error)
    return res.status(500).json({ error: 'Could not change the code.' })
  }
})

export default router
