import express from 'express'
import rateLimit from 'express-rate-limit'
import { perPersonKey } from '../rateKey.js'
import { query, hasDatabase } from '../db.js'
import { uid } from '../ids.js'
import { requireAuth } from '../auth.js'
import { sendEmail, emailFooterHtml, paymentInstructionsHtml } from '../email.js'
import { getPaymentInstructions, getPromoOffer, countPromoRedemptions } from './settings.js'
import { promoAppliesTo, applyPromoAmount, promoLabel, promoRemaining, readCharges, invoiceCharges } from '../promo.js'
import { markReferralEarned, earnedCredits } from './referral.js'
import { escapeHtml } from '../html.js'
import { stripeEnabled, checkoutParams, createCheckoutSession, verifyStripeSignature, paidCheckout, toCents } from '../stripe.js'
import { emailMainAdmin } from '../adminPermissions.js'

const router = express.Router()

// Shared across every route in this file, including reads — see the same
// note in school.js's `limiter`.
const limiter = rateLimit({
  keyGenerator: perPersonKey,
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

const ENTITY_TABLES = { school: 'schools', organization: 'organizations' }
const BILLING_PERIOD_LABELS = { monthly: '/ month', yearly: '/ year', one_time: 'one-time' }

// Mirrors paymentNoticeHtml in server/routes/school.js, but for a single
// numbered invoice rather than a free-text payment notice.
function invoiceNoticeHtml({ entityType, entityName, accountCode, invoiceNumber, poNumber, amount, subtotal, discountLabel, billingPeriod, dueDate, description, paymentInstructions, charges }) {
  const dashboardLink = `${process.env.FRONTEND_URL || ''}${entityType === 'organization' ? '/organization/dashboard' : '/school/dashboard/setup/billing'}`
  const dueDateStr = dueDate ? new Date(dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : null
  const periodLabel = BILLING_PERIOD_LABELS[billingPeriod] || ''
  return [
    `<p>Hi ${escapeHtml(entityName)},</p>`,
    `<p>You have a new invoice from VolunTrack.</p>`,
    `<table cellpadding="4" cellspacing="0">`,
    `<tr><td><strong>Invoice</strong></td><td>${escapeHtml(invoiceNumber)}</td></tr>`,
    accountCode ? `<tr><td><strong>Account ID</strong></td><td>${escapeHtml(accountCode)}</td></tr>` : '',
    poNumber ? `<tr><td><strong>Purchase order</strong></td><td>${escapeHtml(poNumber)}</td></tr>` : '',
    discountLabel ? `<tr><td><strong>Subtotal</strong></td><td>$${Number(subtotal).toFixed(2)}</td></tr>` : '',
    discountLabel ? `<tr><td><strong>Discount</strong></td><td>−$${(Number(subtotal) - Number(charges?.priceTotal ?? amount)).toFixed(2)} (${escapeHtml(discountLabel)})</td></tr>` : '',
    // Fee lines and tax (#968).
    charges && !discountLabel ? `<tr><td><strong>Price</strong></td><td>$${Number(charges.priceTotal).toFixed(2)}</td></tr>` : '',
    ...(charges?.fees || []).map((f) => `<tr><td><strong>${escapeHtml(f.label)}</strong></td><td>$${Number(f.amount).toFixed(2)}</td></tr>`),
    charges?.taxPercent ? `<tr><td><strong>Tax (${Number(charges.taxPercent)}%)</strong></td><td>$${Number(charges.taxAmount).toFixed(2)}</td></tr>` : '',
    `<tr><td><strong>${discountLabel || charges ? 'Total due' : 'Amount'}</strong></td><td>$${Number(amount).toFixed(2)}${periodLabel ? ' ' + escapeHtml(periodLabel) : ''}</td></tr>`,
    dueDateStr ? `<tr><td><strong>Due date</strong></td><td>${dueDateStr}</td></tr>` : '',
    `</table>`,
    description ? `<p>${escapeHtml(description).replace(/\n/g, '<br>')}</p>` : '',
    paymentInstructionsHtml(paymentInstructions, accountCode),
    `<p>View your account and submit payment confirmation from your dashboard: <a href="${dashboardLink}">${dashboardLink}</a></p>`,
    emailFooterHtml(),
  ].join('')
}

// Create and send an invoice to a school or organization (admin only).
// The event-code discount (#907) an account can still use: its code has a
// percent off and this would be its first (non-void) invoice. → null or
// { code, percentOff, teamMember, eventName }.
async function eventOfferFor(entityType, entityId) {
  const table = ENTITY_TABLES[entityType]
  if (!table) return null
  const { rows } = await query(
    `SELECT e.code, e.percent_off, e.team_member, e.event_name FROM ${table} t JOIN event_codes e ON e.id = t.event_code_id
      WHERE t.id = $1 AND e.percent_off IS NOT NULL`,
    [entityId],
  )
  if (!rows[0]) return null
  const { rows: prior } = await query(
    `SELECT 1 FROM invoices WHERE entity_type = $1 AND entity_id = $2 AND status <> 'void' LIMIT 1`,
    [entityType, entityId],
  )
  if (prior.length) return null
  return { code: rows[0].code, percentOff: Number(rows[0].percent_off), teamMember: rows[0].team_member, eventName: rows[0].event_name }
}

// A request the admin can correct; the message is shown to them.
class InvoiceProblem extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// Checks an invoice request and works out what it would charge, without
// writing anything. Sending and previewing (#942) both go through here, so a
// preview shows exactly what Send would bill.
async function priceInvoice(body) {
  const entityType = String(body.entityType || '')
  const entityId = String(body.entityId || '')
  const amount = Number(body.amount)
  const description = body.description ? String(body.description).trim() : null
  const dueDate = body.dueDate ? String(body.dueDate).trim() : null
  const billingPeriod = body.billingPeriod ? String(body.billingPeriod).trim() : null
  const poNumber = body.poNumber ? String(body.poNumber).trim() : null
  const wantsPromo = body.applyPromo === true
  // The discount of the event code this account signed up or upgraded with (#907).
  const wantsEvent = body.applyEventCode === true
  // The referral credit this invoice spends, if any. Mutually exclusive with
  // the join offer: an invoice carries one discount, never two compounded.
  const referralCreditId = body.referralCreditId ? String(body.referralCreditId) : null
  // A percent coupon this account redeemed and hasn't spent yet (#966).
  const wantsCoupon = body.applyCoupon === true

  const table = ENTITY_TABLES[entityType]
  if (!table) throw new InvoiceProblem(400, 'entityType must be school or organization.')
  if (!entityId) throw new InvoiceProblem(400, 'entityId is required.')
  if (!Number.isFinite(amount) || amount <= 0) throw new InvoiceProblem(400, 'A valid amount is required.')
  if (!description) throw new InvoiceProblem(400, 'A description is required.')
  if (billingPeriod && !['monthly', 'yearly', 'one_time'].includes(billingPeriod)) {
    throw new InvoiceProblem(400, 'Invalid billing period.')
  }
  if (poNumber && poNumber.length > 64) throw new InvoiceProblem(400, 'Purchase order number is too long.')
  if ([wantsPromo, Boolean(referralCreditId), wantsEvent, wantsCoupon].filter(Boolean).length > 1) {
    throw new InvoiceProblem(400, 'An invoice carries one discount: the join offer, a referral credit, the event code or a coupon.')
  }

  const { rows: entityRows } = await query(`SELECT name, contact_email, account_code FROM ${table} WHERE id = $1`, [entityId])
  if (entityRows.length === 0) throw new InvoiceProblem(404, 'Not found.')
  const entity = entityRows[0]

  // The discount is decided here, never taken from the request: the client
  // sends "apply the offer", not "charge this much off". A stale admin tab
  // whose offer has since been edited or ended bills the current terms.
  let total = amount
  let subtotal = null
  let discountPercent = null
  let discountLabel = null
  let discountCode = null
  let referralId = null
  if (referralCreditId) {
    // Re-resolved from the referrer's own earned credits rather than trusted
    // from the request, so a stale tab can't spend a credit that belongs to
    // somebody else or has already been redeemed.
    const credits = await earnedCredits(entityType, entityId)
    const credit = credits.find((c) => c.id === referralCreditId)
    if (!credit) throw new InvoiceProblem(409, 'That referral credit is no longer available.')
    // NUMERIC comes back from pg as a string, so "10.00% off" without this.
    const percent = Number(credit.percent_off)
    const applied = applyPromoAmount(amount, percent)
    subtotal = applied.subtotal
    total = applied.total
    discountPercent = percent
    referralId = credit.id
    discountLabel = `Referral credit — ${percent}% off for referring ${credit.referred_name || 'a new customer'}`
  }
  if (wantsPromo) {
    const offer = await getPromoOffer()
    const { rows: priorRows } = await query(
      `SELECT 1 FROM invoices WHERE entity_type = $1 AND entity_id = $2 AND status <> 'void' LIMIT 1`,
      [entityType, entityId],
    )
    const check = promoAppliesTo(offer, {
      entityType,
      billingPeriod,
      isFirstInvoice: priorRows.length === 0,
      redemptionsUsed: await countPromoRedemptions(offer.code),
    })
    if (!check.eligible) throw new InvoiceProblem(409, check.reason)
    const applied = applyPromoAmount(amount, offer.percentOff)
    subtotal = applied.subtotal
    total = applied.total
    discountPercent = offer.percentOff
    discountCode = offer.code || null
    discountLabel = offer.headline ? `${offer.headline} — ${promoLabel(offer)}` : promoLabel(offer)
  }

  if (wantsEvent) {
    const ev = await eventOfferFor(entityType, entityId)
    if (!ev) throw new InvoiceProblem(409, 'This account has no event-code discount, or it already had its first invoice.')
    const applied = applyPromoAmount(amount, ev.percentOff)
    subtotal = applied.subtotal
    total = applied.total
    discountPercent = ev.percentOff
    discountCode = ev.code
    discountLabel = `${ev.eventName || 'Event'} offer — ${ev.percentOff}% off (code ${ev.code})`
  }

  let couponId = null
  if (wantsCoupon) {
    // Re-resolved here, never taken from the request (#966).
    const coupon = await waitingCoupon(entityType, entityId)
    if (!coupon) throw new InvoiceProblem(409, 'This account has no coupon waiting for an invoice.')
    const percent = Number(coupon.percent_off)
    const applied = applyPromoAmount(amount, percent)
    subtotal = applied.subtotal
    total = applied.total
    discountPercent = percent
    discountLabel = `Coupon — ${percent >= 100 ? 'free' : `${percent}% off`}${coupon.note ? ` (${coupon.note})` : ''}`
    couponId = coupon.id
  }

  // Fee lines and tax (#968), after the discount: tax is on the discounted
  // price plus the fees.
  const asked = readCharges(body.fees, body.taxPercent)
  if (asked.error) throw new InvoiceProblem(400, asked.error)
  let charges = null
  if (asked.fees.length || asked.taxPercent) {
    const c = invoiceCharges(total, asked.fees, asked.taxPercent)
    charges = { priceTotal: c.priceTotal, fees: c.fees, taxPercent: c.taxPercent, taxAmount: c.taxAmount }
    total = c.total
  }

  return {
    entityType, entityId, entity, amount, description, dueDate, billingPeriod, poNumber,
    total, subtotal, discountPercent, discountLabel, discountCode, referralId, couponId, charges,
  }
}

// The oldest percent coupon this account redeemed that no invoice has used (#966).
async function waitingCoupon(entityType, entityId) {
  const { rows } = await query(
    `SELECT id, percent_off, note, code_hint FROM customer_coupons
      WHERE entity_type = $1 AND entity_id = $2 AND kind = 'percent' AND status = 'redeemed' AND applied_invoice_id IS NULL
      ORDER BY redeemed_at LIMIT 1`,
    [entityType, entityId],
  )
  return rows[0] ? { ...rows[0], percent_off: Number(rows[0].percent_off) } : null
}

function invoiceFailed(res, error, what) {
  if (error instanceof InvoiceProblem) return res.status(error.status).json({ error: error.message })
  console.error(`${what} failed:`, error)
  return res.status(500).json({ error: `Could not ${what}.` })
}

// The email for a priced invoice: sent as is, and shown in the preview.
function invoiceEmail(p, invoiceNumber, paymentInstructions) {
  return {
    subject: `Invoice ${invoiceNumber} from VolunTrack`,
    html: invoiceNoticeHtml({
      entityType: p.entityType,
      entityName: p.entity.name,
      accountCode: p.entity.account_code,
      invoiceNumber,
      poNumber: p.poNumber,
      amount: p.total,
      subtotal: p.subtotal,
      discountLabel: p.discountLabel,
      billingPeriod: p.billingPeriod,
      dueDate: p.dueDate,
      description: p.description,
      paymentInstructions,
      charges: p.charges,
    }),
  }
}

// What an invoice would look like (#942). Nothing is created, numbered, spent
// or emailed; the admin panel draws the PDF from this.
router.post('/admin/preview', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const p = await priceInvoice(req.body)
    return res.json({
      preview: {
        entityName: p.entity.name,
        accountCode: p.entity.account_code,
        contactEmail: p.entity.contact_email || null,
        amount: p.total,
        subtotal: p.subtotal,
        discountLabel: p.discountLabel,
        billingPeriod: p.billingPeriod,
        description: p.description,
        dueDate: p.dueDate,
        poNumber: p.poNumber,
        charges: p.charges,
      },
      email: {
        to: p.entity.contact_email || 'No contact email on file, so nothing would be emailed',
        note: 'The real email has the invoice number here instead of PREVIEW.',
        ...invoiceEmail(p, 'PREVIEW', await getPaymentInstructions()),
      },
    })
  } catch (error) {
    return invoiceFailed(res, error, 'preview the invoice')
  }
})

router.post('/admin', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const priced = await priceInvoice(req.body)
    const {
      entityType, entityId, entity, description, dueDate, billingPeriod, poNumber,
      total, subtotal, discountPercent, discountLabel, discountCode, referralId, couponId, charges,
    } = priced

    const { rows: seqRows } = await query(`SELECT nextval('invoice_number_seq') AS n`)
    const invoiceNumber = `INV-${String(seqRows[0].n).padStart(6, '0')}`
    const id = uid('invc')

    await query(
      `INSERT INTO invoices (id, invoice_number, entity_type, entity_id, amount, subtotal, discount_percent, discount_label, discount_code, referral_id, billing_period, description, due_date, po_number, status, charges)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'sent', $15)`,
      [id, invoiceNumber, entityType, entityId, total, subtotal, discountPercent, discountLabel, discountCode, referralId, billingPeriod, description, dueDate || null, poNumber, charges ? JSON.stringify(charges) : null],
    )
    await query(
      `INSERT INTO payment_events (id, entity_type, entity_id, event_type, amount, invoice_id) VALUES ($1, $2, $3, 'invoice_sent', $4, $5)`,
      [uid('pev'), entityType, entityId, total, id],
    )

    if (referralId) {
      // Guarded on status so a double-submit can't spend the same credit twice.
      await query(
        `UPDATE referrals SET status = 'redeemed', redeemed_invoice_id = $1 WHERE id = $2 AND status = 'earned'`,
        [id, referralId],
      )
    }
    if (couponId) {
      // Guarded so a double-submit can't spend the same coupon on two invoices.
      await query(`UPDATE customer_coupons SET applied_invoice_id = $1 WHERE id = $2 AND applied_invoice_id IS NULL`, [id, couponId])
    }
    // Being invoiced is what turns whoever referred this customer from a signup
    // into a real reward — until now their credit was only pending.
    await markReferralEarned(entityType, entityId)

    const hasContactEmail = Boolean(entity.contact_email)
    let emailSent = false
    if (hasContactEmail) {
      const result = await sendEmail({
        to: entity.contact_email,
        ...invoiceEmail(priced, invoiceNumber, await getPaymentInstructions()),
      })
      emailSent = result.sent
    }

    return res.status(201).json({
      invoice: { id, invoiceNumber, entityType, entityId, amount: total, subtotal, discountPercent, discountLabel, discountCode, referralId, billingPeriod, description, dueDate, poNumber, charges, status: 'sent', emailSent, hasContactEmail },
    })
  } catch (error) {
    return invoiceFailed(res, error, 'create invoice')
  }
})

// Whether the running offer can be put on this entity's next invoice, so the
// admin panel can show the checkbox with the real reason it is unavailable
// rather than guessing. Advisory only — POST /admin re-checks before charging.
router.get('/admin/:entityType/:entityId/promo', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const { entityType, entityId } = req.params
  if (!ENTITY_TABLES[entityType]) return res.status(400).json({ error: 'Invalid entity type.' })
  try {
    const offer = await getPromoOffer()
    const { rows } = await query(
      `SELECT 1 FROM invoices WHERE entity_type = $1 AND entity_id = $2 AND status <> 'void' LIMIT 1`,
      [entityType, entityId],
    )
    const isFirstInvoice = rows.length === 0
    const redemptionsUsed = await countPromoRedemptions(offer.code)
    // Billing period is left out: the admin can still change it in the form,
    // so the client re-runs promoAppliesTo() against the period it has.
    const { eligible, reason } = promoAppliesTo(offer, { entityType, isFirstInvoice, redemptionsUsed })
    return res.json({
      offer: offer.enabled ? offer : null,
      isFirstInvoice,
      redemptionsUsed,
      remaining: promoRemaining(offer, redemptionsUsed),
      eligible,
      reason,
      // Referral credits this customer has earned by sending someone else our
      // way, spendable on this invoice instead of the join offer.
      credits: await earnedCredits(entityType, entityId),
      eventOffer: await eventOfferFor(entityType, entityId),
      // A percent coupon the account redeemed, waiting for this invoice (#966).
      coupon: await waitingCoupon(entityType, entityId),
    })
  } catch (error) {
    console.error('promo eligibility failed:', error)
    return res.status(500).json({ error: 'Could not check the offer.' })
  }
})

// Merged invoice + manual-status-change timeline for one school/org (admin only).
router.get('/admin/:entityType/:entityId/history', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const { entityType, entityId } = req.params
  if (!ENTITY_TABLES[entityType]) return res.status(400).json({ error: 'Invalid entity type.' })
  try {
    const { rows } = await query(
      `SELECT e.id, e.event_type, e.amount, e.notes, e.created_at,
              i.id AS invoice_id, i.invoice_number, i.status AS invoice_status, i.due_date, i.description, i.billing_period,
              i.subtotal, i.discount_percent, i.discount_label, i.discount_code, i.referral_id, i.po_number, i.charges, i.paid_at
       FROM payment_events e
       LEFT JOIN invoices i ON i.id = e.invoice_id
       WHERE e.entity_type = $1 AND e.entity_id = $2
       ORDER BY e.created_at DESC
       LIMIT 100`,
      [entityType, entityId],
    )
    return res.json({ events: rows })
  } catch (error) {
    console.error('invoice history failed:', error)
    return res.status(500).json({ error: 'Could not fetch payment history.' })
  }
})

/**
 * Marks a still-open invoice paid and unlocks the account it bills, the way
 * marking the school or organization paid by hand does (ending any trial).
 * The UPDATE is conditional, so the admin's button and a card payment's
 * webhook arriving together can't both record it. Resolves to the updated
 * invoice, or null when it was no longer open.
 */
export async function markInvoicePaid(invoiceId, { via = 'manual', cardSessionId = null } = {}) {
  const { rows } = await query(
    `UPDATE invoices SET status = 'paid', paid_at = now(), paid_via = $2, card_session_id = $3
     WHERE id = $1 AND status = 'sent' RETURNING *`,
    [invoiceId, via, cardSessionId],
  )
  const invoice = rows[0]
  if (!invoice) return null
  await query(
    `INSERT INTO payment_events (id, entity_type, entity_id, event_type, amount, invoice_id, notes) VALUES ($1, $2, $3, 'invoice_paid', $4, $5, $6)`,
    [uid('pev'), invoice.entity_type, invoice.entity_id, invoice.amount, invoice.id, via === 'card' ? `Paid by card (Stripe ${cardSessionId || ''})`.trim() : null],
  )
  if (invoice.entity_type === 'school') {
    await query(
      `UPDATE schools SET payment_status = 'paid', paid_at = now(), trial_ends_at = NULL, trial_from_club = false, trial_reminder_days = NULL WHERE id = $1`,
      [invoice.entity_id],
    )
  } else if (invoice.entity_type === 'organization') {
    // An organization's schools unlock with it (#962).
    await query(`UPDATE organizations SET payment_status = 'paid', paid_at = now(), trial_ends_at = NULL WHERE id = $1`, [invoice.entity_id])
  }
  return invoice
}

// Mark an invoice paid or void (admin only). Marking an invoice paid also
// unlocks the school or organization it bills (markInvoicePaid), since that's
// what actually gates them.
router.patch('/admin/:id', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const status = String(req.body.status || '')
  if (!['paid', 'void'].includes(status)) return res.status(400).json({ error: 'Status must be paid or void.' })

  try {
    const { rows } = await query('SELECT * FROM invoices WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'Invoice not found.' })
    const invoice = rows[0]
    if (invoice.status !== 'sent') return res.status(409).json({ error: 'This invoice has already been resolved.' })

    if (status === 'paid') {
      const paid = await markInvoicePaid(invoice.id)
      if (!paid) return res.status(409).json({ error: 'This invoice has already been resolved.' })
    } else {
      await query(`UPDATE invoices SET status = 'void' WHERE id = $1`, [invoice.id])
      // A coupon spent on a voided invoice goes back to waiting (#966).
      await query(`UPDATE customer_coupons SET applied_invoice_id = NULL WHERE applied_invoice_id = $1`, [invoice.id])
      await query(
        `INSERT INTO payment_events (id, entity_type, entity_id, event_type, invoice_id) VALUES ($1, $2, $3, 'invoice_void', $4)`,
        [uid('pev'), invoice.entity_type, invoice.entity_id, invoice.id],
      )
    }

    return res.json({ ok: true })
  } catch (error) {
    console.error('update invoice failed:', error)
    return res.status(500).json({ error: 'Could not update invoice.' })
  }
})

// A school or organization's own invoice list (self-view).
router.get('/mine', limiter, requireDb, requireAuth('school', 'school_staff', 'org'), async (req, res) => {
  try {
    const entityType = req.auth.role === 'org' ? 'organization' : 'school'
    const table = ENTITY_TABLES[entityType]
    const column = entityType === 'organization' ? 'organization_id' : 'school_id'
    const { rows: userRows } = await query(`SELECT ${column} FROM users WHERE id = $1`, [req.auth.sub])
    const entityId = userRows[0]?.[column]
    if (!entityId) return res.json({ invoices: [], entityName: null, accountCode: null })

    const { rows: entityRows } = await query(`SELECT name, account_code, payment_status FROM ${table} WHERE id = $1`, [entityId])
    const { rows } = await query(
      `SELECT id, invoice_number, amount, subtotal, discount_percent, discount_label, discount_code, referral_id, billing_period, description, due_date, po_number, status, created_at, paid_at, charges, paid_via
       FROM invoices WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC LIMIT 50`,
      [entityType, entityId],
    )
    return res.json({
      invoices: rows,
      entityName: entityRows[0]?.name || null,
      accountCode: entityRows[0]?.account_code || null,
      // An organization's schools are locked until it has paid (#962).
      paymentStatus: entityRows[0]?.payment_status || null,
    })
  } catch (error) {
    console.error('list own invoices failed:', error)
    return res.status(500).json({ error: 'Could not fetch invoices.' })
  }
})

// ---------------------------------------------------------------------------
// Card payments (#899, server/stripe.js). Off until STRIPE_SECRET_KEY and
// STRIPE_WEBHOOK_SECRET are set on the backend.

// Whether to show *Pay by card* at all.
router.get('/card-payments', limiter, requireAuth(), (_req, res) => {
  res.json({ enabled: stripeEnabled() })
})

// The account's main admin (a school's `school` login, or the organization)
// opens Stripe's hosted checkout for one of its own open invoices. Only the
// invoice's id comes from the request; the amount is read from the row.
router.post('/:id/checkout', limiter, requireDb, requireAuth('school', 'org'), async (req, res) => {
  if (!stripeEnabled()) return res.status(503).json({ error: 'Card payments are not set up yet.' })
  try {
    const entityType = req.auth.role === 'org' ? 'organization' : 'school'
    const column = entityType === 'organization' ? 'organization_id' : 'school_id'
    const { rows: userRows } = await query(`SELECT email, ${column} AS entity_id FROM users WHERE id = $1`, [req.auth.sub])
    const me = userRows[0]
    if (!me?.entity_id) return res.status(404).json({ error: 'Invoice not found.' })
    const { rows } = await query(
      'SELECT * FROM invoices WHERE id = $1 AND entity_type = $2 AND entity_id = $3',
      [req.params.id, entityType, me.entity_id],
    )
    const invoice = rows[0]
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' })
    if (invoice.status !== 'sent') return res.status(409).json({ error: 'This invoice is already paid or void.' })
    if (!toCents(invoice.amount)) return res.status(409).json({ error: 'This invoice has nothing to pay.' })
    const { rows: entityRows } = await query(`SELECT name FROM ${ENTITY_TABLES[entityType]} WHERE id = $1`, [me.entity_id])

    const site = process.env.FRONTEND_URL || ''
    const back = entityType === 'organization' ? '/organization/dashboard' : '/school/dashboard/setup/billing'
    const session = await createCheckoutSession(checkoutParams({
      invoice,
      entityName: entityRows[0]?.name || '',
      email: me.email && !me.email.endsWith('@test.com') ? me.email : '',
      successUrl: `${site}${back}?card=paid`,
      cancelUrl: `${site}${back}?card=cancelled`,
    }))
    return res.json({ url: session.url })
  } catch (error) {
    console.error('card checkout failed:', error.message)
    return res.status(502).json({ error: 'Could not start the card payment. Please try again.' })
  }
})

const usd = (cents) => `$${(cents / 100).toFixed(2)}`

// Stripe's webhook, mounted in server.js with express.raw() ahead of
// express.json(), since the signature covers the exact bytes. Answers 200 to
// anything verified (Stripe retries non-2xx for days), 400 to anything not.
export async function handleStripeWebhook(req, res) {
  if (!stripeEnabled() || !hasDatabase()) return res.status(503).json({ error: 'Card payments are not set up.' })
  if (!verifyStripeSignature(req.body, req.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET)) {
    return res.status(400).json({ error: 'Bad signature.' })
  }
  let event
  try { event = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body)) } catch { return res.status(400).json({ error: 'Bad JSON.' }) }
  const paid = paidCheckout(event)
  if (!paid) return res.json({ received: true })

  try {
    const { rows } = await query('SELECT * FROM invoices WHERE id = $1', [paid.invoiceId])
    const invoice = rows[0]
    const table = invoice ? ENTITY_TABLES[invoice.entity_type] : null
    const name = table ? (await query(`SELECT name FROM ${table} WHERE id = $1`, [invoice.entity_id])).rows[0]?.name || '' : ''
    const label = invoice ? `${escapeHtml(name)} (invoice ${escapeHtml(invoice.invoice_number)})` : `invoice id ${escapeHtml(paid.invoiceId)}`

    // Paid for, but not something we can simply mark paid: tell the admin,
    // who may need to refund it in Stripe.
    const problem = !invoice ? 'the invoice no longer exists'
      : invoice.status === 'void' ? 'the invoice was voided'
      : invoice.status === 'paid' && invoice.card_session_id !== paid.sessionId ? 'the invoice was already paid another way'
      : paid.currency !== 'usd' || paid.amountCents !== toCents(invoice.amount) ? `Stripe charged ${usd(paid.amountCents)} ${paid.currency.toUpperCase()} but the invoice is for $${Number(invoice.amount).toFixed(2)}`
      : null
    if (problem) {
      // JSON.stringify keeps a line break in the webhook's values from forging a log line.
      console.error('card payment needs attention:', JSON.stringify({ invoiceId: paid.invoiceId, problem }))
      emailMainAdmin('A card payment needs a look', `<p>A card payment came in for ${label}, but ${problem}. Check it in the Stripe dashboard (checkout ${escapeHtml(paid.sessionId)}) and refund it if needed.</p>`)
      return res.json({ received: true })
    }
    if (invoice.status === 'paid') return res.json({ received: true }) // a repeat of this same payment

    const done = await markInvoicePaid(invoice.id, { via: 'card', cardSessionId: paid.sessionId })
    if (done) {
      emailMainAdmin(`${name || 'A customer'} paid invoice ${invoice.invoice_number} by card`, `<p>${label} paid ${usd(paid.amountCents)} by card. The invoice is marked paid and the account is unlocked.</p>`)
    }
    return res.json({ received: true })
  } catch (error) {
    // A database hiccup: answer 500 so Stripe tries again later.
    console.error('stripe webhook failed:', error)
    return res.status(500).json({ error: 'Could not record the payment.' })
  }
}

export default router
