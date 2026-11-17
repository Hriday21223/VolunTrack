import express from 'express'
import rateLimit from 'express-rate-limit'
import validator from 'validator'
import { createHash } from 'crypto'
import { query, hasDatabase } from '../db.js'
import { uid, generateToken } from '../ids.js'
import { requireAuth, hashPassword, endSessions } from '../auth.js'
import { isWeakPassword } from '../validate.js'
import { recordAudit, AUDIT } from '../audit.js'
import { sendEmail } from '../email.js'
import { escapeHtml } from '../html.js'
import { activityLabel } from '../adminActivity.js'

// Admin team (#909). The main admin is the account at ADMIN_EMAIL (seeded on
// boot). Only it can invite more admins, remove them and read the activity
// log. An invited admin sets their own password from a one-time link
// (hashed, 7 days) and must turn on two-step sign-in at their first sign-in
// (mfa_required_at = now). Removing one makes the account a plain Task Maker
// and signs it out everywhere; what it did stays in the log.
const router = express.Router()

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please try again later.' } })
const inviteLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many tries. Please try again later.' } })

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

const mainEmail = () => String(process.env.ADMIN_EMAIL || '').trim().toLowerCase()
const hashToken = (t) => createHash('sha256').update(`voluntrack-admin-invite:${t}`).digest('hex')
const INVITE_DAYS = 7
const MAX_ADMINS = 10

// The caller must be the main admin. Checked against the database email, not
// the token's, so an old token can't outlive an email change.
async function requireMainAdmin(req, res, next) {
  try {
    const { rows } = await query('SELECT email FROM users WHERE id = $1 AND role = $2', [req.auth.sub, 'admin'])
    const email = String(rows[0]?.email || '').toLowerCase()
    if (!email || !mainEmail() || email !== mainEmail()) return res.status(403).json({ error: 'Only the main admin can do this.' })
    next()
  } catch (error) {
    console.error('main admin check failed:', error)
    return res.status(500).json({ error: 'Could not check your account.' })
  }
}

function siteUrl() {
  return (process.env.FRONTEND_URL || 'https://volunteer-track-two.vercel.app').split(',')[0].trim().replace(/\/$/, '')
}

// GET /api/admin/team — the admins, pending invites, and whether the caller is
// the main admin (the card shows only then).
router.get('/', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rows: me } = await query('SELECT email FROM users WHERE id = $1', [req.auth.sub])
    const isMain = String(me[0]?.email || '').toLowerCase() === mainEmail() && Boolean(mainEmail())
    if (!isMain) return res.json({ isMain: false })
    const { rows: admins } = await query(
      `SELECT id, name, email, totp_enabled, created_at FROM users WHERE role = 'admin' ORDER BY created_at`,
    )
    const { rows: invites } = await query(
      `SELECT id, name, email, expires_at, created_at FROM admin_invites
        WHERE accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC`,
    )
    return res.json({
      isMain: true,
      admins: admins.map((a) => ({ id: a.id, name: a.name, email: a.email, twoStep: a.totp_enabled, main: String(a.email).toLowerCase() === mainEmail(), since: a.created_at })),
      invites: invites.map((i) => ({ id: i.id, name: i.name, email: i.email, expiresAt: i.expires_at })),
    })
  } catch (error) {
    console.error('admin team list failed:', error)
    return res.status(500).json({ error: 'Could not load the admin team.' })
  }
})

// POST /api/admin/team/invite { name, email }
router.post('/invite', limiter, requireDb, requireAuth('admin'), requireMainAdmin, async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 100)
  const email = String(req.body?.email || '').trim().toLowerCase()
  if (!name) return res.status(400).json({ error: 'Add their name.' })
  if (!validator.isEmail(email) || email.length > 254) return res.status(400).json({ error: 'Add a valid email.' })
  try {
    const { rows: taken } = await query('SELECT 1 FROM users WHERE LOWER(email) = $1', [email])
    if (taken.length) return res.status(409).json({ error: 'That email already has a VolunTrack account. Use a different email for their admin account.' })
    const { rows: count } = await query(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'`)
    if (count[0].n >= MAX_ADMINS) return res.status(409).json({ error: `At most ${MAX_ADMINS} admins.` })
    // One open invite per email: a new one replaces the old.
    await query('DELETE FROM admin_invites WHERE LOWER(email) = $1 AND accepted_at IS NULL', [email])
    const token = generateToken()
    const id = uid('ainv')
    await query(
      `INSERT INTO admin_invites (id, email, name, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))`,
      [id, email, name, hashToken(token), req.auth.sub, INVITE_DAYS],
    )
    const link = `${siteUrl()}/admin-invite?token=${token}`
    let emailSent = false
    if (!email.endsWith('@test.com')) {
      const r = await sendEmail({
        to: email,
        priority: 'high',
        subject: 'You’ve been added to the VolunTrack admin team',
        html: `<p>Hi ${escapeHtml(name.split(' ')[0])},</p>
<p>You’ve been invited to help run VolunTrack as an admin. Open this link to choose your password. It works once and expires in ${INVITE_DAYS} days.</p>
<p><a href="${link}">Set up my admin account</a></p>
<p>The first time you sign in, you’ll set up two-step sign-in with an authenticator app. Admins can see every school’s account, so please keep your login to yourself.</p>`,
      }).catch(() => ({ sent: false }))
      emailSent = Boolean(r?.sent)
    }
    recordAudit(req, { action: AUDIT.ADMIN_INVITED, objectType: 'admin_invite', objectId: id })
    // The link is returned too, so the main admin can pass it on if email fails.
    return res.status(201).json({ id, emailSent, link })
  } catch (error) {
    console.error('admin invite failed:', error)
    return res.status(500).json({ error: 'Could not send the invite.' })
  }
})

router.delete('/invite/:id', limiter, requireDb, requireAuth('admin'), requireMainAdmin, async (req, res) => {
  try {
    await query('DELETE FROM admin_invites WHERE id = $1 AND accepted_at IS NULL', [req.params.id])
    return res.json({ ok: true })
  } catch (error) {
    console.error('admin invite cancel failed:', error)
    return res.status(500).json({ error: 'Could not cancel the invite.' })
  }
})

// DELETE /api/admin/team/:userId — remove an admin (never the main one).
router.delete('/:userId', limiter, requireDb, requireAuth('admin'), requireMainAdmin, async (req, res) => {
  try {
    const { rows } = await query(`SELECT id, email FROM users WHERE id = $1 AND role = 'admin'`, [req.params.userId])
    const target = rows[0]
    if (!target) return res.status(404).json({ error: 'That admin was not found.' })
    if (String(target.email).toLowerCase() === mainEmail()) return res.status(400).json({ error: 'The main admin can’t be removed here.' })
    await query(`UPDATE users SET role = 'volunteer', test_login_pin_hash = NULL WHERE id = $1`, [target.id])
    await endSessions(target.id)
    recordAudit(req, { action: AUDIT.ADMIN_REMOVED, subjectUserId: target.id })
    return res.json({ ok: true })
  } catch (error) {
    console.error('admin remove failed:', error)
    return res.status(500).json({ error: 'Could not remove the admin.' })
  }
})

// GET /api/admin/team/activity?adminId=&limit= — what admins did, newest first.
router.get('/activity', limiter, requireDb, requireAuth('admin'), requireMainAdmin, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500)
  const adminId = req.query.adminId ? String(req.query.adminId) : null
  try {
    const { rows } = await query(
      `SELECT a.id, a.method, a.path, a.status, a.created_at, u.name, u.email
         FROM admin_activity a LEFT JOIN users u ON u.id = a.admin_id
        WHERE ($1::text IS NULL OR a.admin_id = $1)
        ORDER BY a.created_at DESC LIMIT $2`,
      [adminId, limit],
    )
    return res.json({
      activity: rows.map((r) => ({
        id: r.id, at: r.created_at, who: r.name || r.email || 'Removed account', email: r.email,
        label: activityLabel(r.method, r.path) || `${r.method} ${r.path}`, method: r.method, path: r.path,
        ok: r.status < 400, status: r.status,
      })),
    })
  } catch (error) {
    console.error('admin activity read failed:', error)
    return res.status(500).json({ error: 'Could not load the activity.' })
  }
})

// POST /api/admin/team/seen/:tab — the admin opened a tab. Does nothing but
// answer; the activity logger records the path, which names the tab.
const ADMIN_TAB_IDS = new Set(['inbox', 'reviews', 'schools', 'invites', 'organizations', 'incidents', 'reports', 'settings', 'users', 'api', 'blueprint'])
router.post('/seen/:tab', limiter, requireAuth('admin'), (req, res) => {
  if (!ADMIN_TAB_IDS.has(req.params.tab)) return res.status(400).json({ error: 'Unknown tab.' })
  return res.status(204).end()
})

// Public: the invited person's side. GET shows who invited them; POST sets
// the password and makes the admin account.
router.get('/invite/:token', inviteLimiter, requireDb, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT name, email FROM admin_invites WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()`,
      [hashToken(String(req.params.token))],
    )
    if (!rows[0]) return res.status(410).json({ error: 'This invite has expired or was already used. Ask for a new one.' })
    return res.json({ name: rows[0].name, email: rows[0].email })
  } catch (error) {
    console.error('admin invite open failed:', error)
    return res.status(500).json({ error: 'Could not open the invite.' })
  }
})

router.post('/invite/:token', inviteLimiter, requireDb, async (req, res) => {
  const password = String(req.body?.password || '')
  if (password.length < 12 || password.length > 128 || isWeakPassword(password) || /password|voluntrack|admin/i.test(password)) {
    return res.status(400).json({ error: 'Pick a password of at least 12 characters that isn’t a common one.' })
  }
  try {
    // Claimed in one UPDATE, so the link works once.
    const { rows } = await query(
      `UPDATE admin_invites SET accepted_at = now()
        WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()
        RETURNING id, name, email`,
      [hashToken(String(req.params.token))],
    )
    const invite = rows[0]
    if (!invite) return res.status(410).json({ error: 'This invite has expired or was already used. Ask for a new one.' })
    const { rows: taken } = await query('SELECT 1 FROM users WHERE LOWER(email) = $1', [invite.email])
    if (taken.length) return res.status(409).json({ error: 'That email already has a VolunTrack account.' })
    const id = uid('usr')
    // mfa_required_at = now(): the first sign-in goes straight to two-step setup.
    await query(
      `INSERT INTO users (id, role, name, email, password_hash, mfa_required_at)
       VALUES ($1, 'admin', $2, $3, $4, now())`,
      [id, invite.name, invite.email, await hashPassword(password)],
    )
    recordAudit({ auth: { sub: id, role: 'admin' }, headers: req.headers, ip: req.ip }, { action: AUDIT.ADMIN_ADDED, subjectUserId: id })
    return res.json({ ok: true, email: invite.email })
  } catch (error) {
    console.error('admin invite accept failed:', error)
    return res.status(500).json({ error: 'Could not set up your account.' })
  }
})

export default router
