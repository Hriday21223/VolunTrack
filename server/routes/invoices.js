import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { uid } from '../ids.js'
import { requireAuth } from '../auth.js'
import { sendEmail, emailFooterHtml, paymentInstructionsHtml } from '../email.js'
import { getPaymentInstructions, getPromoOffer, countPromoRedemptions } from './settings.js'
import { promoAppliesTo, applyPromoAmount, promoLabel, promoRemaining } from '../promo.js'
import { markReferralEarned, earnedCredits } from './referral.js'
import { escapeHtml } from '../html.js'

const router = express.Router()

// Shared across every route in this file, including reads — see the same
// note in school.js's `limiter`.
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

const ENTITY_TABLES = { school: 'schools', organization: 'organizations' }
const BILLING_PERIOD_LABELS = { monthly: '/ month', yearly: '/ year', one_time: 'one-time' }

// Mirrors paymentNoticeHtml in server/routes/school.js, but for a single
// numbered invoice rather than a free-text payment notice.
function invoiceNoticeHtml({ entityType, entityName, accountCode, invoiceNumber, amount, subtotal, discountLabel, billingPeriod, dueDate, description, paymentInstructions }) {
  const dashboardLink = `${process.env.FRONTEND_URL || ''}${entityType === 'organization' ? '/organization/dashboard' : '/school/dashboard'}`
  const dueDateStr = dueDate ? new Date(dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : null
  const periodLabel = BILLING_PERIOD_LABELS[billingPeriod] || ''
  return [
    `<p>Hi ${escapeHtml(entityName)},</p>`,
    `<p>You have a new invoice from VolunTrack.</p>`,
    `<table cellpadding="4" cellspacing="0">`,
    `<tr><td><strong>Invoice</strong></td><td>${escapeHtml(invoiceNumber)}</td></tr>`,
    accountCode ? `<tr><td><strong>Account ID</strong></td><td>${escapeHtml(accountCode)}</td></tr>` : '',
    discountLabel ? `<tr><td><strong>Subtotal</strong></td><td>$${Number(subtotal).toFixed(2)}</td></tr>` : '',
    discountLabel ? `<tr><td><strong>Discount</strong></td><td>−$${(Number(subtotal) - Number(amount)).toFixed(2)} (${escapeHtml(discountLabel)})</td></tr>` : '',
    `<tr><td><strong>${discountLabel ? 'Total due' : 'Amount'}</strong></td><td>$${Number(amount).toFixed(2)}${periodLabel ? ' ' + escapeHtml(periodLabel) : ''}</td></tr>`,
    dueDateStr ? `<tr><td><strong>Due date</strong></td><td>${dueDateStr}</td></tr>` : '',
    `</table>`,
    description ? `<p>${escapeHtml(description).replace(/\n/g, '<br>')}</p>` : '',
    paymentInstructionsHtml(paymentInstructions, accountCode),
    `<p>View your account and submit payment confirmation from your dashboard: <a href="${dashboardLink}">${dashboardLink}</a></p>`,
    emailFooterHtml(),
  ].join('')
}

// Create and send an invoice to a school or organization (admin only).
router.post('/admin', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const entityType = String(req.body.entityType || '')
  const entityId = String(req.body.entityId || '')
  const amount = Number(req.body.amount)
  const description = req.body.description ? String(req.body.description).trim() : null
  const dueDate = req.body.dueDate ? String(req.body.dueDate).trim() : null
  const billingPeriod = req.body.billingPeriod ? String(req.body.billingPeriod).trim() : null
  const wantsPromo = req.body.applyPromo === true
  // The referral credit this invoice spends, if any. Mutually exclusive with
  // the join offer: an invoice carries one discount, never two compounded.
  const referralCreditId = req.body.referralCreditId ? String(req.body.referralCreditId) : null

  const table = ENTITY_TABLES[entityType]
  if (!table) return res.status(400).json({ error: 'entityType must be school or organization.' })
  if (!entityId) return res.status(400).json({ error: 'entityId is required.' })
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'A valid amount is required.' })
  if (!description) return res.status(400).json({ error: 'A description is required.' })
  if (billingPeriod && !['monthly', 'yearly', 'one_time'].includes(billingPeriod)) {
    return res.status(400).json({ error: 'Invalid billing period.' })
  }
  if (wantsPromo && referralCreditId) {
    return res.status(400).json({ error: 'Apply the join offer or a referral credit, not both.' })
  }

  try {
    const { rows: entityRows } = await query(`SELECT name, contact_email, account_code FROM ${table} WHERE id = $1`, [entityId])
    if (entityRows.length === 0) return res.status(404).json({ error: 'Not found.' })
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
      if (!credit) return res.status(409).json({ error: 'That referral credit is no longer available.' })
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
      if (!check.eligible) return res.status(409).json({ error: check.reason })
      const applied = applyPromoAmount(amount, offer.percentOff)
      subtotal = applied.subtotal
      total = applied.total
      discountPercent = offer.percentOff
      discountCode = offer.code || null
      discountLabel = offer.headline ? `${offer.headline} — ${promoLabel(offer)}` : promoLabel(offer)
    }

    const { rows: seqRows } = await query(`SELECT nextval('invoice_number_seq') AS n`)
    const invoiceNumber = `INV-${String(seqRows[0].n).padStart(6, '0')}`
    const id = uid('invc')

    await query(
      `INSERT INTO invoices (id, invoice_number, entity_type, entity_id, amount, subtotal, discount_percent, discount_label, discount_code, referral_id, billing_period, description, due_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'sent')`,
      [id, invoiceNumber, entityType, entityId, total, subtotal, discountPercent, discountLabel, discountCode, referralId, billingPeriod, description, dueDate || null],
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
    // Being invoiced is what turns whoever referred this customer from a signup
    // into a real reward — until now their credit was only pending.
    await markReferralEarned(entityType, entityId)

    const hasContactEmail = Boolean(entity.contact_email)
    let emailSent = false
    if (hasContactEmail) {
      const result = await sendEmail({
        to: entity.contact_email,
        subject: `Invoice ${invoiceNumber} from VolunTrack`,
        html: invoiceNoticeHtml({
          entityType,
          entityName: entity.name,
          accountCode: entity.account_code,
          invoiceNumber,
          amount: total,
          subtotal,
          discountLabel,
          billingPeriod,
          dueDate,
          description,
          paymentInstructions: await getPaymentInstructions(),
        }),
      })
      emailSent = result.sent
    }

    return res.status(201).json({
      invoice: { id, invoiceNumber, entityType, entityId, amount: total, subtotal, discountPercent, discountLabel, discountCode, referralId, billingPeriod, description, dueDate, status: 'sent', emailSent, hasContactEmail },
    })
  } catch (error) {
    console.error('create invoice failed:', error)
    return res.status(500).json({ error: 'Could not create invoice.' })
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
              i.subtotal, i.discount_percent, i.discount_label, i.discount_code, i.referral_id
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

// Mark an invoice paid or void (admin only). Marking a school's invoice paid
// also unlocks the school the same way PATCH /school/admin/:id/payment does,
// since that's what actually gates school submissions.
router.patch('/admin/:id', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const status = String(req.body.status || '')
  if (!['paid', 'void'].includes(status)) return res.status(400).json({ error: 'Status must be paid or void.' })

  try {
    const { rows } = await query('SELECT * FROM invoices WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'Invoice not found.' })
    const invoice = rows[0]
    if (invoice.status !== 'sent') return res.status(409).json({ error: 'This invoice has already been resolved.' })

    if (status === 'paid') {
      await query(`UPDATE invoices SET status = 'paid', paid_at = now() WHERE id = $1`, [invoice.id])
      await query(
        `INSERT INTO payment_events (id, entity_type, entity_id, event_type, amount, invoice_id) VALUES ($1, $2, $3, 'invoice_paid', $4, $5)`,
        [uid('pev'), invoice.entity_type, invoice.entity_id, invoice.amount, invoice.id],
      )
      if (invoice.entity_type === 'school') {
        await query(`UPDATE schools SET payment_status = 'paid', paid_at = now() WHERE id = $1`, [invoice.entity_id])
      }
    } else {
      await query(`UPDATE invoices SET status = 'void' WHERE id = $1`, [invoice.id])
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

    const { rows: entityRows } = await query(`SELECT name, account_code FROM ${table} WHERE id = $1`, [entityId])
    const { rows } = await query(
      `SELECT id, invoice_number, amount, subtotal, discount_percent, discount_label, discount_code, referral_id, billing_period, description, due_date, status, created_at, paid_at
       FROM invoices WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC LIMIT 50`,
      [entityType, entityId],
    )
    return res.json({
      invoices: rows,
      entityName: entityRows[0]?.name || null,
      accountCode: entityRows[0]?.account_code || null,
    })
  } catch (error) {
    console.error('list own invoices failed:', error)
    return res.status(500).json({ error: 'Could not fetch invoices.' })
  }
})

export default router
