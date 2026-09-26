import express from 'express'
import rateLimit from 'express-rate-limit'
import validator from 'validator'
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

// Public: the landing-page hero renders this, and nothing else does — see
// CLAUDE.md for why the offer is kept off the signup pages and dashboards. Returns `{ offer: null }` when nothing is running — there is
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

// --- Blueprint docs (the admin panel's Blueprint tab) ---

// Links to the living reference pages for how this app is built. They are kept
// out of the repo so they can be refreshed without a deploy, and out of every
// public surface: they spell out each role's powers and every server gate, so
// both reading and editing them is admin-only.
//
// The two shipped links are the defaults, returned when nothing has been saved
// yet. Saving is a full overwrite of the list, so an admin can also drop one.
const DEFAULT_BLUEPRINT_DOCS = [
  {
    title: 'The VolunTrack Field Guide',
    url: 'https://claude.ai/artifact/6kfF7uqPM7rSG9maQWYKyh',
    summary: 'Every role and feature, read from the source: what each of the seven account types can do, billing and pricing, supervisor verification, public tasks, auth, data custody, and the quirks worth knowing.',
  },
  {
    title: 'App Pipeline',
    url: 'https://claude.ai/artifact/Vgp53Gh2VBkYgQf1SMVAEq',
    summary: 'How a click becomes a stored hour: the localStorage lane, the Postgres lane, the direct-to-bucket proof path, the middleware chain, and all 18 mounted routers with their access gates.',
  },
]

const MAX_BLUEPRINT_DOCS = 30

// A link an admin pastes here is rendered as an anchor in their own panel, so
// the scheme matters: only https, never a javascript: or data: URL.
function normalizeBlueprintDocs(input) {
  if (!Array.isArray(input)) return { error: 'Expected a list of blueprints.' }
  if (input.length > MAX_BLUEPRINT_DOCS) return { error: `At most ${MAX_BLUEPRINT_DOCS} blueprints.` }

  const docs = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return { error: 'Each blueprint needs a title and a link.' }
    const title = String(raw.title ?? '').trim()
    const url = String(raw.url ?? '').trim()
    const summary = String(raw.summary ?? '').trim()

    if (!title || title.length > 120) return { error: 'A blueprint needs a title of 1–120 characters.' }
    if (!validator.isURL(url, { protocols: ['https'], require_protocol: true })) {
      return { error: `"${title}" needs an https link.` }
    }
    if (url.length > 500) return { error: `The link for "${title}" is too long.` }
    if (summary.length > 800) return { error: `The summary for "${title}" is too long.` }

    docs.push(summary ? { title, url, summary } : { title, url })
  }
  return { docs }
}

router.get('/blueprint-docs', limiter, requireDb, requireAuth('admin'), async (_req, res) => {
  try {
    const { rows } = await query(`SELECT value FROM site_settings WHERE key = 'blueprint_docs'`)
    if (rows.length === 0) return res.json({ docs: DEFAULT_BLUEPRINT_DOCS })
    const { docs } = normalizeBlueprintDocs(JSON.parse(rows[0].value))
    // A stored value that no longer validates falls back to the defaults rather
    // than emptying the tab.
    return res.json({ docs: docs || DEFAULT_BLUEPRINT_DOCS })
  } catch (error) {
    console.error('get blueprint docs failed:', error)
    return res.status(500).json({ error: 'Could not fetch the blueprints.' })
  }
})

router.put('/blueprint-docs', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const { docs, error } = normalizeBlueprintDocs(req.body.docs)
  if (error) return res.status(400).json({ error })
  try {
    await query(
      `INSERT INTO site_settings (key, value, updated_at) VALUES ('blueprint_docs', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
      [JSON.stringify(docs)],
    )
    return res.json({ docs })
  } catch (err) {
    console.error('update blueprint docs failed:', err)
    return res.status(500).json({ error: 'Could not save the blueprints.' })
  }
})

export default router
