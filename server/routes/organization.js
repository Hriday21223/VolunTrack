import express from 'express'
import rateLimit from 'express-rate-limit'
import validator from 'validator'
import { query, hasDatabase } from '../db.js'
import { uid, generateToken } from '../ids.js'
import { hashPassword, signToken, requireAuth } from '../auth.js'
import { sendEmail } from '../email.js'

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

const INVITE_TTL_DAYS = 3

// Register an organization (public — either self-service, or completing an
// admin-sent invite via ?inviteToken). Mirrors POST /school/register.
router.post('/register', limiter, requireDb, async (req, res) => {
  const name = String(req.body.name || '').trim()
  const email = String(req.body.email || '').trim().toLowerCase()
  const password = req.body.password
  const inviteToken = req.body.inviteToken ? String(req.body.inviteToken).trim() : null

  if (!name || name.length > 100) return res.status(400).json({ error: 'Organization name is required.' })
  if (!email || !validator.isEmail(email) || email.length > 254) return res.status(400).json({ error: 'Valid email required.' })
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' })

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

    const orgId = uid('org')
    await query(
      'INSERT INTO organizations (id, name, contact_email) VALUES ($1, $2, $3)',
      [orgId, name, email],
    )

    const hash = await hashPassword(password)
    const userId = uid('usr')
    const { rows } = await query(
      `INSERT INTO users (id, role, name, email, password_hash, organization_id)
       VALUES ($1, 'org', $2, $3, $4, $5)
       RETURNING *`,
      [userId, name, email, hash, orgId],
    )

    if (invite) {
      await query(`UPDATE organization_invites SET status = 'completed' WHERE id = $1`, [invite.id])
    }

    const user = { id: rows[0].id, role: rows[0].role, name: rows[0].name, email: rows[0].email, organizationId: rows[0].organization_id }
    return res.status(201).json({ token: signToken(user), user })
  } catch (error) {
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
    await sendEmail({
      to: email,
      subject: 'You’re invited to set up your organization on VolunTrack',
      html: `<p>${name} has been invited to join VolunTrack. Click the link below to finish setting up your organization account — choose your password, then add your schools.</p><p><a href="${link}">${link}</a></p><p>This link expires in ${INVITE_TTL_DAYS} days.</p>`,
      idempotencyKey: `organization-invite/${id}`,
    })

    return res.status(201).json({ ok: true, id })
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
    await sendEmail({
      to: invite.email,
      subject: 'You’re invited to set up your organization on VolunTrack',
      html: `<p>${invite.name} has been invited to join VolunTrack. Click the link below to finish setting up your organization account — choose your password, then add your schools.</p><p><a href="${link}">${link}</a></p><p>This link expires in ${INVITE_TTL_DAYS} days.</p>`,
      idempotencyKey: `organization-invite-resend/${req.params.id}/${Date.now()}`,
    })

    return res.json({ ok: true })
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
    await sendEmail({
      to: email,
      subject: 'You’re invited to set up your school on VolunTrack',
      html: `<p>${name} has been invited to join VolunTrack. Click the link below to finish setting up your school account — choose your password and school code.</p><p><a href="${link}">${link}</a></p><p>This link expires in ${INVITE_TTL_DAYS} days.</p>`,
      idempotencyKey: `org-school-invite/${id}`,
    })

    return res.status(201).json({ ok: true, id })
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

export default router
