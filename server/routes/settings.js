import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { normalizePromo, publicPromo, NO_PROMO } from '../promo.js'

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

const DEFAULT_OFFICE_HOURS = {
  days: 'Monday – Friday',
  hours: '9:00 AM – 5:00 PM (CT)',
  note: 'Replies may take up to 48 hours.',
}

// Public: the Contact page reads this to render the office-hours card.
router.get('/office-hours', limiter, requireDb, async (_req, res) => {
  try {
    const { rows } = await query(`SELECT value FROM site_settings WHERE key = 'office_hours'`)
    if (rows.length === 0) return res.json(DEFAULT_OFFICE_HOURS)
    return res.json({ ...DEFAULT_OFFICE_HOURS, ...JSON.parse(rows[0].value) })
  } catch (error) {
    console.error('get office hours failed:', error)
    return res.status(500).json({ error: 'Could not fetch office hours.' })
  }
})

// Admin-only: edit the office-hours card from the admin panel.
router.patch('/office-hours', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const days = String(req.body.days || '').trim()
  const hours = String(req.body.hours || '').trim()
  const note = String(req.body.note || '').trim()

  if (!days || days.length > 200) return res.status(400).json({ error: 'Invalid days.' })
  if (!hours || hours.length > 200) return res.status(400).json({ error: 'Invalid hours.' })
  if (note.length > 200) return res.status(400).json({ error: 'Invalid note.' })

  try {
    const value = JSON.stringify({ days, hours, note })
    await query(
      `INSERT INTO site_settings (key, value, updated_at) VALUES ('office_hours', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
      [value],
    )
    return res.json({ days, hours, note })
  } catch (error) {
    console.error('update office hours failed:', error)
    return res.status(500).json({ error: 'Could not update office hours.' })
  }
})

// --- Payment instructions ("how to pay us") ---

// Free-form bank details the admin fills in once, rendered wherever a customer
// is asked to pay (dashboards, invoice emails, payment notices) next to their
// account code. Every field is optional — an unset setting renders nothing.
const PAYMENT_INSTRUCTION_FIELDS = ['bankName', 'accountName', 'accountNumber', 'routingNumber', 'swift', 'reference', 'notes']

// Shared with server/routes/invoices.js and the payment-notice emails, which
// need the instructions server-side rather than over HTTP.
export async function getPaymentInstructions() {
  try {
    const { rows } = await query(`SELECT value FROM site_settings WHERE key = 'payment_instructions'`)
    if (rows.length === 0) return null
    const parsed = JSON.parse(rows[0].value)
    return PAYMENT_INSTRUCTION_FIELDS.some((f) => parsed[f]) ? parsed : null
  } catch (error) {
    console.error('get payment instructions failed:', error)
    return null
  }
}

// Bank details, so unlike /office-hours this is NOT public — only the accounts
// that actually receive an invoice (and the admin) can read it.
router.get('/payment-instructions', limiter, requireDb, requireAuth('school', 'school_staff', 'org', 'admin'), async (_req, res) => {
  const instructions = await getPaymentInstructions()
  return res.json(instructions || {})
})

// Admin-only: edit the payment instructions from the admin panel.
router.patch('/payment-instructions', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const value = {}
  for (const field of PAYMENT_INSTRUCTION_FIELDS) {
    const raw = String(req.body[field] ?? '').trim()
    const max = field === 'notes' ? 1000 : 200
    if (raw.length > max) return res.status(400).json({ error: `${field} is too long.` })
    if (raw) value[field] = raw
  }

  try {
    await query(
      `INSERT INTO site_settings (key, value, updated_at) VALUES ('payment_instructions', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
      [JSON.stringify(value)],
    )
    return res.json(value)
  } catch (error) {
    console.error('update payment instructions failed:', error)
    return res.status(500).json({ error: 'Could not update payment instructions.' })
  }
})

// --- Join offer ("10% off your first month") ---

// The single active offer, raw and including `enabled`. Admin-side and
// server-side readers use this; the public one below strips it.
export async function getPromoOffer() {
  try {
    const { rows } = await query(`SELECT value FROM site_settings WHERE key = 'promo_offer'`)
    if (rows.length === 0) return { ...NO_PROMO }
    const { offer } = normalizePromo(JSON.parse(rows[0].value))
    // A stored row that no longer validates (an older shape, a hand-edited
    // value) is treated as "no offer" rather than crashing every reader.
    return offer || { ...NO_PROMO }
  } catch (error) {
    console.error('get promo offer failed:', error)
    return { ...NO_PROMO }
  }
}

/**
 * How many times a code has been claimed. Counted from the invoices themselves
 * rather than a counter column, so voiding an invoice returns its use and there
 * is no separate tally that can drift. An uncoded offer is never capped, so it
 * has nothing to count.
 */
export async function countPromoRedemptions(code) {
  if (!code) return 0
  try {
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM invoices WHERE discount_code = $1 AND status <> 'void'`,
      [code],
    )
    return rows[0]?.n || 0
  } catch (error) {
    console.error('count promo redemptions failed:', error)
    // Fail closed: an unknown count reads as "fully claimed" rather than
    // letting a broken query hand out an unlimited number of discounts.
    return Number.MAX_SAFE_INTEGER
  }
}

// Public: the signup pages, the home page and school/org dashboards all render
// the same banner. Returns `{ offer: null }` when nothing is running — there is
// nothing sensitive here, it is marketing copy the admin chose to publish.
router.get('/promo', limiter, async (_req, res) => {
  if (!hasDatabase()) return res.json({ offer: null })
  const offer = await getPromoOffer()
  return res.json({ offer: publicPromo(offer, await countPromoRedemptions(offer.code)) })
})

// Admin-only: read the offer back for editing, `enabled` and all.
router.get('/promo/admin', limiter, requireDb, requireAuth('admin'), async (_req, res) => {
  const offer = await getPromoOffer()
  return res.json({ offer, redemptionsUsed: await countPromoRedemptions(offer.code) })
})

// Admin-only: replace the offer. There is exactly one, so this is a full
// overwrite rather than a merge — clearing a field in the form clears it here.
router.patch('/promo', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const { offer, error } = normalizePromo(req.body)
  if (error) return res.status(400).json({ error })
  try {
    await query(
      `INSERT INTO site_settings (key, value, updated_at) VALUES ('promo_offer', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
      [JSON.stringify(offer)],
    )
    return res.json({ offer, redemptionsUsed: await countPromoRedemptions(offer.code) })
  } catch (err) {
    console.error('update promo offer failed:', err)
    return res.status(500).json({ error: 'Could not update the offer.' })
  }
})

export default router
