import express from 'express'
import rateLimit from 'express-rate-limit'
import validator from 'validator'
import { query, hasDatabase, nextAccountCode, assignReferralCode, settleSingleOpenInvoice } from '../db.js'
import { uid, generateToken } from '../ids.js'
import { signupPlatform } from '../platform.js'
import { hashPassword, signToken, requireAuth } from '../auth.js'
import { isWeakPassword, WEAK_PASSWORD_MESSAGE, isValidDateString } from '../validate.js'
import { verifyTurnstile } from '../turnstile.js'
import { sendEmail, sendWelcomeEmail, emailFooterHtml, paymentNoticeHtml } from '../email.js'
import { getPaymentInstructions } from './settings.js'
import { escapeHtml } from '../html.js'
import { schoolProgress } from './school.js'
import { claimCode, releaseCode, markCodeUser, CODE_REQUIRED_MESSAGE, CODE_REJECTED_MESSAGE } from '../registrationCodes.js'

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

const INVITE_TTL_DAYS = 3

// Complete an organization signup (public route, but requires a valid
// ?inviteToken or a one-time registration code from us — organization
// accounts are not open self-service, #287). Mirrors POST /school/register.
router.post('/register', limiter, requireDb, verifyTurnstile(), async (req, res) => {
  const name = String(req.body.name || '').trim()
  const email = String(req.body.email || '').trim().toLowerCase()
  const password = req.body.password
  const inviteToken = req.body.inviteToken ? String(req.body.inviteToken).trim() : null
  const registrationCode = !inviteToken && req.body.registrationCode ? String(req.body.registrationCode) : null

  if (!inviteToken && !registrationCode) return res.status(403).json({ error: CODE_REQUIRED_MESSAGE.organization })
  if (!name || name.length > 100) return res.status(400).json({ error: 'Organization name is required.' })
  if (!email || !validator.isEmail(email) || email.length > 254) return res.status(400).json({ error: 'Valid email required.' })
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' })
  if (isWeakPassword(password)) return res.status(400).json({ error: WEAK_PASSWORD_MESSAGE })

  let claimedCodeId = null
  try {
    let invite = null
    if (inviteToken) {
      const { rows: inviteRows } = await query('SELECT * FROM organization_invites WHERE token = $1', [inviteToken])
      invite = inviteRows[0]
      if (!invite || invite.status !== 'pending' || new Date(invite.expires_at) < new Date()) {
        return res.status(410).json({ error: 'This invite link has expired or was already used.' })
      }
    }

    const existingUser = await query('SELECT 1 FROM users WHERE email = $1', [email])
    if (existingUser.rowCount > 0) return res.status(409).json({ error: 'An account with that email already exists.' })

    // Spent last, so a taken email doesn't cost the organization its code.
    if (registrationCode) {
      claimedCodeId = await claimCode('organization', registrationCode)
      if (!claimedCodeId) return res.status(410).json({ error: CODE_REJECTED_MESSAGE })
    }

    const orgId = uid('org')
    await query(
      'INSERT INTO organizations (id, name, contact_email, account_code) VALUES ($1, $2, $3, $4)',
      [orgId, name, email, await nextAccountCode('organizations')],
    )
    await assignReferralCode('organizations', orgId, name).catch((e) => console.error('referral code failed:', e.message))

    const hash = await hashPassword(password)
    const userId = uid('usr')
    const { rows } = await query(
      `INSERT INTO users (id, role, name, email, password_hash, organization_id, signup_platform)
       VALUES ($1, 'org', $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, name, email, hash, orgId, signupPlatform(req)],
    )
    await markCodeUser(claimedCodeId, userId)

    if (invite) {
      await query(`UPDATE organization_invites SET status = 'completed' WHERE id = $1`, [invite.id])
    }

    const user = { id: rows[0].id, role: rows[0].role, name: rows[0].name, email: rows[0].email, organizationId: rows[0].organization_id }
    await sendWelcomeEmail({ to: user.email, name: user.name })
    return res.status(201).json({ token: signToken(user), user })
  } catch (error) {
    await releaseCode(claimedCodeId).catch((e) => console.error('registration code release failed:', e.message))
    console.error('organization register failed:', error)
    return res.status(500).json({ error: 'Could not register organization.' })
  }
})

// Look up a pending organization invite by token (public — the org admin
// clicks the emailed link before they're authenticated). Mirrors
// GET /school/invite/:token.
router.get('/invite/:token', limiter, requireDb, async (req, res) => {
  try {
    const { rows } = await query('SELECT name, email, status, expires_at FROM organization_invites WHERE token = $1', [req.params.token])
    if (rows.length === 0) return res.status(404).json({ error: 'Invite not found.' })
    const invite = rows[0]
    if (invite.status !== 'pending' || new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This invite link has expired or was already used.' })
    }
    return res.json({ name: invite.name, email: invite.email })
  } catch (error) {
    console.error('organization invite lookup failed:', error)
    return res.status(500).json({ error: 'Could not look up invite.' })
  }
})

// --- Admin endpoints ---

// Invite an organization (platform admin only). Sends a signup link
// pre-filled with the given name/email; the org sets their own password via
// /organization/register?token=... within INVITE_TTL_DAYS. Mirrors
// POST /school/admin/invite.
router.post('/admin/invite', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const name = String(req.body.name || '').trim()
  const email = String(req.body.email || '').trim().toLowerCase()

  if (!name || name.length > 100) return res.status(400).json({ error: 'Organization name is required.' })
  if (!email || !validator.isEmail(email) || email.length > 254) return res.status(400).json({ error: 'Valid email required.' })

  try {
    const id = uid('inv')
    const token = generateToken()
    await query(
      `INSERT INTO organization_invites (id, name, email, token, status, expires_at)
       VALUES ($1, $2, $3, $4, 'pending', now() + interval '${INVITE_TTL_DAYS} days')`,
      [id, name, email, token],
    )

    const link = `${process.env.FRONTEND_URL || ''}/organization/register?token=${token}`
    const { sent: emailSent } = await sendEmail({
      to: email,
      subject: 'You’re invited to set up your organization on VolunTrack',
      html: `<p>${escapeHtml(name)} has been invited to join VolunTrack. Click the link below to finish setting up your organization account — choose your password, then add your schools.</p><p><a href="${link}">${link}</a></p><p>This link expires in ${INVITE_TTL_DAYS} days.</p>${emailFooterHtml()}`,
    })

    return res.status(201).json({ ok: true, id, emailSent })
  } catch (error) {
    console.error('organization invite failed:', error)
    return res.status(500).json({ error: 'Could not send invite.' })
  }
})

// List organization invites (admin only). Mirrors GET /school/admin/invites.
router.get('/admin/invites', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, name, email, status, expires_at, created_at,
         CASE WHEN status = 'pending' AND expires_at < now() THEN 'expired' ELSE status END AS effective_status
       FROM organization_invites ORDER BY created_at DESC`,
    )
    return res.json({ invites: rows })
  } catch (error) {
    console.error('list organization invites failed:', error)
    return res.status(500).json({ error: 'Could not fetch invites.' })
  }
})

// Resend an organization invite (admin only). Mirrors
// POST /school/admin/invite/:id/resend.
router.post('/admin/invite/:id/resend', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM organization_invites WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'Invite not found.' })
    const invite = rows[0]
    if (invite.status === 'completed') return res.status(409).json({ error: 'This invite has already been used.' })

    const token = generateToken()
    await query(
      `UPDATE organization_invites SET token = $1, status = 'pending', expires_at = now() + interval '${INVITE_TTL_DAYS} days' WHERE id = $2`,
      [token, req.params.id],
    )

    const link = `${process.env.FRONTEND_URL || ''}/organization/register?token=${token}`
    const { sent: emailSent } = await sendEmail({
      to: invite.email,
      subject: 'You’re invited to set up your organization on VolunTrack',
      html: `<p>${escapeHtml(invite.name)} has been invited to join VolunTrack. Click the link below to finish setting up your organization account — choose your password, then add your schools.</p><p><a href="${link}">${link}</a></p><p>This link expires in ${INVITE_TTL_DAYS} days.</p>${emailFooterHtml()}`,
    })

    return res.json({ ok: true, emailSent })
  } catch (error) {
    console.error('resend organization invite failed:', error)
    return res.status(500).json({ error: 'Could not resend invite.' })
  }
})

// Delete an organization invite (admin only).
router.delete('/admin/invite/:id', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    await query('DELETE FROM organization_invites WHERE id = $1', [req.params.id])
    return res.json({ ok: true })
  } catch (error) {
    console.error('delete organization invite failed:', error)
    return res.status(500).json({ error: 'Could not delete invite.' })
  }
})

// Set an organization's custom price (e.g. amount "$2000" billed "monthly"
// or "yearly"). Mirrors PATCH /school/admin/:id/price.
router.patch('/admin/:id/price', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const amount = String(req.body.amount ?? '').trim().replace(/^\$/, '').replace(/,/g, '')
  // Shown to the customer and used to pre-fill their invoices, so a typo is
  // refused here rather than billed: a plain amount, up to two decimals.
  if (amount && !/^\d{1,7}(\.\d{1,2})?$/.test(amount)) {
    return res.status(400).json({ error: 'Enter the price as an amount, like 499 or 499.00.' })
  }
  const period = req.body.period ? String(req.body.period).trim() : null
  if (period && !['monthly', 'yearly', 'one_time'].includes(period)) {
    return res.status(400).json({ error: 'Invalid billing period.' })
  }
  try {
    await query('UPDATE organizations SET price_amount = $1, price_period = $2 WHERE id = $3', [amount || null, amount ? period : null, req.params.id])
    return res.json({ ok: true })
  } catch (error) {
    console.error('admin organization price update failed:', error)
    return res.status(500).json({ error: 'Could not save price.' })
  }
})

// Set an organization's payment due date. Mirrors PATCH /school/admin/:id/due-date.
router.patch('/admin/:id/due-date', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const dueDate = req.body.dueDate ? String(req.body.dueDate).trim() : null
  if (dueDate && !isValidDateString(dueDate)) return res.status(400).json({ error: 'Enter the due date as YYYY-MM-DD.' })
  try {
    await query('UPDATE organizations SET payment_due_date = $1 WHERE id = $2', [dueDate || null, req.params.id])
    return res.json({ ok: true })
  } catch (error) {
    console.error('admin organization due date update failed:', error)
    return res.status(500).json({ error: 'Could not set due date.' })
  }
})

// Set an internal admin-only note on an organization. Mirrors
// PATCH /school/admin/:id/notes.
router.patch('/admin/:id/notes', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const note = String(req.body.note ?? '').trim()
  try {
    await query('UPDATE organizations SET admin_notes = $1 WHERE id = $2', [note || null, req.params.id])
    return res.json({ ok: true })
  } catch (error) {
    console.error('admin organization note update failed:', error)
    return res.status(500).json({ error: 'Could not save note.' })
  }
})

// Manually mark an organization paid/unpaid (admin's own bookkeeping —
// organizations have no self-service payment-confirmation flow, so unlike
// schools there's no 'pending'/'rejected' status to reject here). Mirrors
// PATCH /school/admin/:id/payment.
router.patch('/admin/:id/payment', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const { status, notes } = req.body
  if (!status || !['paid', 'unpaid'].includes(status)) {
    return res.status(400).json({ error: 'Status must be paid or unpaid.' })
  }
  try {
    await query(
      `UPDATE organizations SET payment_status = $1, payment_notes = $2, paid_at = CASE WHEN $1 = 'paid' THEN now() ELSE NULL END WHERE id = $3`,
      [status, notes || null, req.params.id],
    )
    await query(
      `INSERT INTO payment_events (id, entity_type, entity_id, event_type, notes) VALUES ($1, 'organization', $2, $3, $4)`,
      [uid('pev'), req.params.id, status === 'paid' ? 'status_paid' : 'status_unpaid', notes || null],
    )
    if (status === 'paid') {
      await settleSingleOpenInvoice('organization', req.params.id).catch((e) => console.error('invoice settle failed:', e.message))
    }
    return res.json({ ok: true })
  } catch (error) {
    console.error('update organization payment failed:', error)
    return res.status(500).json({ error: 'Could not update payment.' })
  }
})

// Send a payment/general notice to a specific organization (admin only).
// Mirrors POST /school/admin/notify-school/:schoolId.
router.post('/admin/notify-org/:organizationId', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const { message, amount, billingPeriod } = req.body
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Message is required.' })
  }
  try {
    const id = uid('anot')
    const [, { rows }] = await Promise.all([
      query(
        'INSERT INTO admin_notifications (id, organization_id, message) VALUES ($1, $2, $3)',
        [id, req.params.organizationId, message.trim()],
      ),
      query('SELECT name, account_code, contact_email, payment_due_date, price_amount, price_period FROM organizations WHERE id = $1', [req.params.organizationId]),
    ])
    const hasContactEmail = Boolean(rows[0]?.contact_email)
    let emailSent = false
    if (hasContactEmail) {
      const result = await sendEmail({
        to: rows[0].contact_email,
        subject: 'Payment notice from VolunTrack',
        html: paymentNoticeHtml({
          recipientName: rows[0].name,
          entityLabel: 'organization',
          accountCode: rows[0].account_code,
          paymentInstructions: await getPaymentInstructions(),
          amount: amount || rows[0].price_amount,
          billingPeriod: amount ? billingPeriod : rows[0].price_period,
          dueDate: rows[0].payment_due_date,
          message: message.trim(),
          includeDashboardLink: false,
        }),
      })
      emailSent = result.sent
    }

    return res.status(201).json({ ok: true, id, emailSent, hasContactEmail })
  } catch (error) {
    console.error('notify organization failed:', error)
    return res.status(500).json({ error: 'Could not send notification.' })
  }
})

// Delete an organization (admin only). Schools/users linked via
// organization_id are unlinked automatically (ON DELETE SET NULL) rather
// than deleted — the org is just a grouping, not the schools' owner.
router.delete('/admin/:id', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    // Same as deleting a school: the organization's login goes with it.
    await query(`DELETE FROM users WHERE organization_id = $1 AND role = 'org'`, [req.params.id])
    await query('DELETE FROM organizations WHERE id = $1', [req.params.id])
    return res.json({ ok: true })
  } catch (error) {
    console.error('admin delete organization failed:', error)
    return res.status(500).json({ error: 'Could not delete organization.' })
  }
})

// Invite a school under this organization. Sends a signup link pre-filled
// with the given name/email; the school sets their own password/code via
// /school/register?token=... within INVITE_TTL_DAYS. Identical to
// POST /school/admin/invite except the invite (and the resulting school) is
// scoped to the caller's organization_id.
router.post('/invite-school', limiter, requireDb, requireAuth('org'), async (req, res) => {
  const name = String(req.body.name || '').trim()
  const email = String(req.body.email || '').trim().toLowerCase()

  if (!name || name.length > 100) return res.status(400).json({ error: 'School name is required.' })
  if (!email || !validator.isEmail(email) || email.length > 254) return res.status(400).json({ error: 'Valid email required.' })

  try {
    const { rows: userRows } = await query('SELECT organization_id FROM users WHERE id = $1', [req.auth.sub])
    const organizationId = userRows[0]?.organization_id
    if (!organizationId) return res.status(400).json({ error: 'No organization linked to your account.' })

    const id = uid('inv')
    const token = generateToken()
    await query(
      `INSERT INTO school_invites (id, name, email, token, status, expires_at, organization_id)
       VALUES ($1, $2, $3, $4, 'pending', now() + interval '${INVITE_TTL_DAYS} days', $5)`,
      [id, name, email, token, organizationId],
    )

    const link = `${process.env.FRONTEND_URL || ''}/school/register?token=${token}`
    const { sent: emailSent } = await sendEmail({
      to: email,
      subject: 'You’re invited to set up your school on VolunTrack',
      html: `<p>${escapeHtml(name)} has been invited to join VolunTrack. Click the link below to finish setting up your school account — choose your password and school code.</p><p><a href="${link}">${link}</a></p><p>This link expires in ${INVITE_TTL_DAYS} days.</p>${emailFooterHtml()}`,
    })

    return res.status(201).json({ ok: true, id, emailSent })
  } catch (error) {
    console.error('organization invite-school failed:', error)
    return res.status(500).json({ error: 'Could not send invite.' })
  }
})

// List invites sent by this organization (scoped — not all invites).
router.get('/invites', limiter, requireDb, requireAuth('org'), async (req, res) => {
  try {
    const { rows: userRows } = await query('SELECT organization_id FROM users WHERE id = $1', [req.auth.sub])
    if (!userRows[0]?.organization_id) return res.status(400).json({ error: 'No organization linked to your account.' })

    const { rows } = await query(
      `SELECT id, name, email, status, expires_at, created_at,
         CASE WHEN status = 'pending' AND expires_at < now() THEN 'expired' ELSE status END AS effective_status
       FROM school_invites WHERE organization_id = $1
       ORDER BY created_at DESC`,
      [userRows[0].organization_id],
    )
    return res.json({ invites: rows })
  } catch (error) {
    console.error('organization invites list failed:', error)
    return res.status(500).json({ error: 'Could not fetch invites.' })
  }
})

// List schools created under this organization.
router.get('/schools', limiter, requireDb, requireAuth('org'), async (req, res) => {
  try {
    const { rows: userRows } = await query('SELECT organization_id FROM users WHERE id = $1', [req.auth.sub])
    if (!userRows[0]?.organization_id) return res.status(400).json({ error: 'No organization linked to your account.' })

    const { rows } = await query(
      `SELECT s.id, s.name, s.pin, s.contact_email, s.payment_status, s.created_at,
        (SELECT COUNT(*) FROM users WHERE school_id = s.id AND role = 'student') AS student_count
       FROM schools s WHERE s.organization_id = $1
       ORDER BY s.created_at DESC`,
      [userRows[0].organization_id],
    )
    return res.json({ schools: rows })
  } catch (error) {
    console.error('organization schools list failed:', error)
    return res.status(500).json({ error: 'Could not fetch schools.' })
  }
})

// GET /api/organization/schools/compare (#529): the same few numbers for every
// school the organization owns, side by side — students, how many logged
// anything in the last 30 days, hours this school year (from Aug 1, rejected
// entries left out) and how many have met their hour requirement. Counts only,
// never a student's name.
router.get('/schools/compare', limiter, requireDb, requireAuth('org'), async (req, res) => {
  try {
    const { rows: userRows } = await query('SELECT organization_id FROM users WHERE id = $1', [req.auth.sub])
    const orgId = userRows[0]?.organization_id
    if (!orgId) return res.status(400).json({ error: 'No organization linked to your account.' })
    const now = new Date()
    const yearStart = `${now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1}-08-01`
    const { rows } = await query(
      `SELECT s.id, s.name,
              COUNT(DISTINCT u.id)::int AS students,
              COUNT(DISTINCT u.id) FILTER (WHERE l.created_at >= now() - interval '30 days')::int AS active,
              COALESCE(SUM(l.hours) FILTER (WHERE l.date >= $2), 0)::float AS year_hours
         FROM schools s
         LEFT JOIN users u ON u.school_id = s.id AND u.role = 'student'
         LEFT JOIN logs l ON l.user_id = u.id AND COALESCE(l.verification_status, 'none') <> 'rejected'
        WHERE s.organization_id = $1
        GROUP BY s.id
        ORDER BY s.name`,
      [orgId, yearStart],
    )
    const schools = await Promise.all(rows.map(async (r) => {
      const progress = await schoolProgress(r.id).catch(() => null)
      const withGoal = progress ? progress.students.filter((s) => s.target) : []
      return {
        id: r.id,
        name: r.name,
        students: r.students,
        active: r.active,
        yearHours: Math.round(r.year_hours * 10) / 10,
        withGoal: withGoal.length,
        met: withGoal.filter((s) => s.remaining <= 0).length,
      }
    }))
    return res.json({ yearStart, schools })
  } catch (error) {
    console.error('organization compare failed:', error)
    return res.status(500).json({ error: 'Could not compare schools.' })
  }
})

export default router
