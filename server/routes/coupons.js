import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase, getPool } from '../db.js'
import { requireAuth } from '../auth.js'
import { uid, generateUpgradeCode } from '../ids.js'
import { perPersonKey } from '../rateKey.js'
import { readCouponRequest, hashCoupon, couponHint, couponLabel } from '../coupons.js'

// Coupons for one named school or organization (#966); see server/coupons.js.
const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: perPersonKey,
  message: { error: 'Too many requests. Please try again later.' },
})
// Typing codes is slow on purpose: 10 tries an hour per account.
const redeemLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: perPersonKey,
  message: { error: 'Too many coupon tries. Please wait an hour and try again.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

const TABLES = { school: 'schools', organization: 'organizations' }
const PUBLIC_COLS = `id, code_hint, entity_type, entity_id, kind, percent_off, free_months, note, expires_at,
  status, redeemed_at, applied_invoice_id, created_at`

const shape = (c) => ({ ...c, percent_off: c.percent_off == null ? null : Number(c.percent_off), label: couponLabel(c) })

// The caller's own school (main admin) or organization.
async function callerEntity(req) {
  const { rows } = await query('SELECT school_id, organization_id FROM users WHERE id = $1', [req.auth.sub])
  if (req.auth.role === 'org') return rows[0]?.organization_id ? { type: 'organization', id: rows[0].organization_id } : null
  return rows[0]?.school_id ? { type: 'school', id: rows[0].school_id } : null
}

// POST /api/coupons/admin — make a coupon for one account. The response is the
// only time the full code is shown.
router.post('/admin', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const entityType = String(req.body.entityType || '')
  const entityId = String(req.body.entityId || '')
  if (!TABLES[entityType] || !entityId) return res.status(400).json({ error: 'Pick a school or organization.' })
  const r = readCouponRequest(req.body)
  if (r.error) return res.status(400).json({ error: r.error })
  try {
    const { rows: ent } = await query(`SELECT id FROM ${TABLES[entityType]} WHERE id = $1`, [entityId])
    if (!ent.length) return res.status(404).json({ error: 'Not found.' })
    const code = generateUpgradeCode()
    const { rows } = await query(
      `INSERT INTO customer_coupons (id, code_hash, code_hint, entity_type, entity_id, kind, percent_off, free_months, note, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${PUBLIC_COLS}`,
      [uid('cpn'), hashCoupon(code), couponHint(code), entityType, entityId, r.kind, r.percentOff, r.freeMonths, r.note, r.expiresAt, req.auth.sub],
    )
    return res.status(201).json({ coupon: shape(rows[0]), code })
  } catch (error) {
    console.error('coupon create failed:', error)
    return res.status(500).json({ error: 'Could not make the coupon.' })
  }
})

// GET /api/coupons/admin/:entityType/:entityId — this account's coupons.
router.get('/admin/:entityType/:entityId', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  if (!TABLES[req.params.entityType]) return res.status(400).json({ error: 'Invalid account type.' })
  try {
    const { rows } = await query(
      `SELECT ${PUBLIC_COLS} FROM customer_coupons WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC LIMIT 50`,
      [req.params.entityType, req.params.entityId],
    )
    return res.json({ coupons: rows.map(shape) })
  } catch (error) {
    console.error('coupon list failed:', error)
    return res.status(500).json({ error: 'Could not load coupons.' })
  }
})

// POST /api/coupons/admin/:id/void — only one nobody has used yet.
router.post('/admin/:id/void', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rowCount } = await query(`UPDATE customer_coupons SET status = 'void' WHERE id = $1 AND status = 'active'`, [req.params.id])
    if (!rowCount) return res.status(409).json({ error: 'Only an unused coupon can be cancelled.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('coupon void failed:', error)
    return res.status(500).json({ error: 'Could not cancel the coupon.' })
  }
})

// GET /api/coupons/mine — the caller's used coupons, for the billing card.
router.get('/mine', limiter, requireDb, requireAuth('school', 'org'), async (req, res) => {
  try {
    const me = await callerEntity(req)
    if (!me) return res.json({ coupons: [] })
    const { rows } = await query(
      `SELECT kind, percent_off, free_months, redeemed_at, applied_invoice_id FROM customer_coupons
        WHERE entity_type = $1 AND entity_id = $2 AND status = 'redeemed' ORDER BY redeemed_at DESC LIMIT 10`,
      [me.type, me.id],
    )
    return res.json({
      coupons: rows.map((c) => ({
        label: couponLabel(c),
        kind: c.kind,
        percentOff: c.percent_off == null ? null : Number(c.percent_off),
        freeMonths: c.free_months,
        redeemedAt: c.redeemed_at,
        // A percent coupon waits for the next invoice until one uses it.
        waiting: c.kind === 'percent' && !c.applied_invoice_id,
      })),
    })
  } catch (error) {
    console.error('my coupons failed:', error)
    return res.status(500).json({ error: 'Could not load coupons.' })
  }
})

// Free months (#966). An account already paid with no end date has its
// payment due date moved back; otherwise it's paid until N months from now
// (or from the end of a trial it's already on), using the trial end the hourly
// trial job watches, so it turns unpaid again when the months are up.
async function applyFreeMonths(client, type, id, months) {
  const table = TABLES[type]
  const { rows } = await client.query(`SELECT payment_status, trial_ends_at, payment_due_date FROM ${table} WHERE id = $1 FOR UPDATE`, [id])
  const row = rows[0]
  if (row.payment_status === 'paid' && !row.trial_ends_at) {
    const { rows: out } = await client.query(
      `UPDATE ${table} SET payment_due_date = (GREATEST(COALESCE(payment_due_date, CURRENT_DATE), CURRENT_DATE) + make_interval(months => $2))::date
        WHERE id = $1 RETURNING to_char(payment_due_date, 'YYYY-MM-DD') AS due`,
      [id, months],
    )
    return { dueDate: out[0].due }
  }
  const { rows: out } = await client.query(
    `UPDATE ${table} SET payment_status = 'paid',
            trial_ends_at = GREATEST(COALESCE(trial_ends_at, now()), now()) + make_interval(months => $2),
            trial_reminder_days = NULL
      WHERE id = $1 RETURNING trial_ends_at`,
    [id, months],
  )
  return { paidUntil: out[0].trial_ends_at }
}

// POST /api/coupons/redeem { code } — a school's main admin or an organization
// uses a coupon made for it. A code made for another account reads as invalid.
router.post('/redeem', redeemLimiter, requireDb, requireAuth('school', 'org'), async (req, res) => {
  const code = String(req.body.code || '')
  if (!code.trim()) return res.status(400).json({ error: 'Enter your coupon code.' })
  const client = await getPool().connect()
  try {
    const me = await callerEntity(req)
    if (!me) return res.status(400).json({ error: 'No school or organization is linked to your account.' })
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT id, kind, percent_off, free_months, expires_at, status FROM customer_coupons
        WHERE code_hash = $1 AND entity_type = $2 AND entity_id = $3 FOR UPDATE`,
      [hashCoupon(code), me.type, me.id],
    )
    const c = rows[0]
    if (!c) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'That coupon code isn’t valid for your account.' }) }
    if (c.status === 'redeemed') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'That coupon has already been used.' }) }
    if (c.status !== 'active') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'That coupon was cancelled.' }) }
    if (c.expires_at && new Date(c.expires_at) < new Date()) {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'That coupon has expired.', expiredAt: c.expires_at })
    }
    await client.query(`UPDATE customer_coupons SET status = 'redeemed', redeemed_at = now(), redeemed_by = $2 WHERE id = $1`, [c.id, req.auth.sub])
    const applied = c.kind === 'months' ? await applyFreeMonths(client, me.type, me.id, c.free_months) : {}
    await client.query('COMMIT')
    return res.json({ ok: true, kind: c.kind, label: couponLabel(c), percentOff: c.percent_off == null ? null : Number(c.percent_off), freeMonths: c.free_months, ...applied })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('coupon redeem failed:', error)
    return res.status(500).json({ error: 'Could not use the coupon.' })
  } finally {
    client.release()
  }
})

export default router
