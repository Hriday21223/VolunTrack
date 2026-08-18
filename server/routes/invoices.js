import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { uid } from '../ids.js'
import { requireAuth } from '../auth.js'
import { sendEmail } from '../email.js'
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
function invoiceNoticeHtml({ entityType, entityName, invoiceNumber, amount, billingPeriod, dueDate, description }) {
  const dashboardLink = `${process.env.FRONTEND_URL || ''}${entityType === 'organization' ? '/organization/dashboard' : '/school/dashboard'}`
  const dueDateStr = dueDate ? new Date(dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : null
  const periodLabel = BILLING_PERIOD_LABELS[billingPeriod] || ''
  return [
    `<p>Hi ${escapeHtml(entityName)},</p>`,
    `<p>You have a new invoice from VolunTrack.</p>`,
    `<table cellpadding="4" cellspacing="0">`,
    `<tr><td><strong>Invoice</strong></td><td>${escapeHtml(invoiceNumber)}</td></tr>`,
    `<tr><td><strong>Amount</strong></td><td>$${Number(amount).toFixed(2)}${periodLabel ? ' ' + escapeHtml(periodLabel) : ''}</td></tr>`,
    dueDateStr ? `<tr><td><strong>Due date</strong></td><td>${dueDateStr}</td></tr>` : '',
    `</table>`,
    description ? `<p>${escapeHtml(description).replace(/\n/g, '<br>')}</p>` : '',
    `<p>View your account and submit payment confirmation from your dashboard: <a href="${dashboardLink}">${dashboardLink}</a></p>`,
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

  const table = ENTITY_TABLES[entityType]
  if (!table) return res.status(400).json({ error: 'entityType must be school or organization.' })
  if (!entityId) return res.status(400).json({ error: 'entityId is required.' })
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'A valid amount is required.' })
  if (billingPeriod && !['monthly', 'yearly', 'one_time'].includes(billingPeriod)) {
    return res.status(400).json({ error: 'Invalid billing period.' })
  }

  try {
    const { rows: entityRows } = await query(`SELECT name, contact_email FROM ${table} WHERE id = $1`, [entityId])
    if (entityRows.length === 0) return res.status(404).json({ error: 'Not found.' })
    const entity = entityRows[0]

    const { rows: seqRows } = await query(`SELECT nextval('invoice_number_seq') AS n`)
    const invoiceNumber = `INV-${String(seqRows[0].n).padStart(6, '0')}`
    const id = uid('invc')

    await query(
      `INSERT INTO invoices (id, invoice_number, entity_type, entity_id, amount, billing_period, description, due_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'sent')`,
      [id, invoiceNumber, entityType, entityId, amount, billingPeriod, description, dueDate || null],
    )
    await query(
      `INSERT INTO payment_events (id, entity_type, entity_id, event_type, amount, invoice_id) VALUES ($1, $2, $3, 'invoice_sent', $4, $5)`,
      [uid('pev'), entityType, entityId, amount, id],
    )

    if (entity.contact_email) {
      await sendEmail({
        to: entity.contact_email,
        subject: `Invoice ${invoiceNumber} from VolunTrack`,
        html: invoiceNoticeHtml({ entityType, entityName: entity.name, invoiceNumber, amount, billingPeriod, dueDate, description }),
        idempotencyKey: `invoice/${id}`,
      })
    }

    return res.status(201).json({
      invoice: { id, invoiceNumber, entityType, entityId, amount, billingPeriod, description, dueDate, status: 'sent' },
    })
  } catch (error) {
    console.error('create invoice failed:', error)
    return res.status(500).json({ error: 'Could not create invoice.' })
  }
})

// Merged invoice + manual-status-change timeline for one school/org (admin only).
router.get('/admin/:entityType/:entityId/history', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const { entityType, entityId } = req.params
  if (!ENTITY_TABLES[entityType]) return res.status(400).json({ error: 'Invalid entity type.' })
  try {
    const { rows } = await query(
      `SELECT e.id, e.event_type, e.amount, e.notes, e.created_at,
              i.id AS invoice_id, i.invoice_number, i.status AS invoice_status, i.due_date, i.description, i.billing_period
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
    if (!entityId) return res.json({ invoices: [], entityName: null })

    const { rows: entityRows } = await query(`SELECT name FROM ${table} WHERE id = $1`, [entityId])
    const { rows } = await query(
      `SELECT id, invoice_number, amount, billing_period, description, due_date, status, created_at, paid_at
       FROM invoices WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC LIMIT 50`,
      [entityType, entityId],
    )
    return res.json({ invoices: rows, entityName: entityRows[0]?.name || null })
  } catch (error) {
    console.error('list own invoices failed:', error)
    return res.status(500).json({ error: 'Could not fetch invoices.' })
  }
})

export default router
