import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { uid } from '../ids.js'
import { sendEmail, announcementHtml } from '../email.js'

// Admin announcements (#290) — e.g. "we'll be offline for maintenance from
// 8–9 PM". The admin picks any of five audiences; each sees a banner on its
// dashboard until the announcement expires, and gets one email.
//
// An organization can announce to its own schools too (#557): the same banner
// and email, but only for the admins (and, if it chooses, students) of the
// schools it owns, marked "From <organization>". Those rows carry
// organization_id; the admin's have none.
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

const MAX_SHOW_HOURS = 24 * 30
const ACTIVE = 'ended_at IS NULL AND show_until > now()'
const ACTIVE_A = 'a.ended_at IS NULL AND a.show_until > now()'
const SEND_BATCH = 5

// Request field -> column, and which signed-in roles read each column. The
// role comes from the token, never the request.
const AUDIENCES = [
  { field: 'toSchools', column: 'to_schools', roles: ['school', 'school_staff'] },
  { field: 'toOrgs', column: 'to_orgs', roles: ['org'] },
  { field: 'toStudents', column: 'to_students', roles: ['student'] },
  { field: 'toParents', column: 'to_parents', roles: ['parent'] },
  { field: 'toVolunteers', column: 'to_volunteers', roles: ['volunteer'] },
]
const COLUMN_FOR_ROLE = Object.fromEntries(AUDIENCES.flatMap((a) => a.roles.map((r) => [r, a.column])))
const DASHBOARD_FOR_ROLE = { student: '/', volunteer: '/', parent: '/parent' }

const toJson = (r) => ({
  id: r.id,
  title: r.title,
  message: r.message,
  toSchools: r.to_schools,
  toOrgs: r.to_orgs,
  toStudents: r.to_students,
  toParents: r.to_parents,
  toVolunteers: r.to_volunteers,
  showUntil: r.show_until,
  createdAt: r.created_at,
  emailsSent: r.emails_sent,
  emailsTotal: r.emails_total,
})

// Everyone the announcement should be emailed to, one entry per address — a
// school contact who is also a parent gets one copy, not two.
async function recipientsFor(flags) {
  const byEmail = new Map()
  const add = (email, name, dashboardPath) => {
    const key = String(email || '').trim().toLowerCase()
    if (key && !byEmail.has(key)) byEmail.set(key, { email: key, name: name || 'there', dashboardPath })
  }
  if (flags.to_schools) {
    const { rows } = await query('SELECT name, contact_email FROM schools WHERE contact_email IS NOT NULL')
    rows.forEach((s) => add(s.contact_email, s.name, '/school/dashboard'))
  }
  if (flags.to_orgs) {
    const { rows } = await query('SELECT name, contact_email FROM organizations WHERE contact_email IS NOT NULL')
    rows.forEach((o) => add(o.contact_email, o.name, '/organization/dashboard'))
  }
  const roles = [flags.to_students && 'student', flags.to_parents && 'parent', flags.to_volunteers && 'volunteer'].filter(Boolean)
  if (roles.length) {
    // Skips an under-13 sign-up still waiting on its parent (no consent yet,
    // and it can't sign in) and the @test.com fixtures, as the sign-up counts do.
    const { rows } = await query(
      `SELECT name, email, role FROM users
        WHERE role = ANY($1) AND email IS NOT NULL
          AND (parental_consent_status IS NULL OR parental_consent_status <> 'pending')
          AND email NOT ILIKE '%@test.com'`,
      [roles],
    )
    rows.forEach((u) => add(u.email, u.name, DASHBOARD_FOR_ROLE[u.role]))
  }
  return [...byEmail.values()]
}

// Runs after the response: a few at a time so a large audience neither holds
// the admin's request open nor hits the email provider all at once.
// sendEmail() never throws; a failed address just isn't counted.
async function sendInBackground(id, title, message, recipients, fromName = null) {
  for (let i = 0; i < recipients.length; i += SEND_BATCH) {
    const batch = recipients.slice(i, i + SEND_BATCH)
    const results = await Promise.all(batch.map((r) => sendEmail({
      to: r.email,
      subject: fromName ? `${fromName}: ${title}` : `VolunTrack: ${title}`,
      html: announcementHtml({ recipientName: r.name, title, message, dashboardPath: r.dashboardPath, fromName }),
    }).catch(() => ({ sent: false }))))
    const sent = results.filter((r) => r.sent).length
    if (sent) await query('UPDATE announcements SET emails_sent = emails_sent + $1 WHERE id = $2', [sent, id])
  }
}

// POST /api/announcements/admin
router.post('/admin', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const title = String(req.body.title || '').trim()
  const message = String(req.body.message || '').trim()
  const hours = Number(req.body.showForHours)
  const flags = Object.fromEntries(AUDIENCES.map((a) => [a.column, req.body[a.field] === true]))

  if (!title || title.length > 120) return res.status(400).json({ error: 'A title of up to 120 characters is required.' })
  if (!message || message.length > 2000) return res.status(400).json({ error: 'A message of up to 2000 characters is required.' })
  if (!Object.values(flags).some(Boolean)) return res.status(400).json({ error: 'Choose at least one group to send to.' })
  if (!Number.isFinite(hours) || hours < 1 || hours > MAX_SHOW_HOURS) {
    return res.status(400).json({ error: `Show it for between 1 hour and ${MAX_SHOW_HOURS / 24} days.` })
  }

  try {
    const recipients = await recipientsFor(flags)
    const id = uid('ann')
    const { rows } = await query(
      `INSERT INTO announcements
         (id, title, message, to_schools, to_orgs, to_students, to_parents, to_volunteers, show_until, emails_total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(hours => $9), $10)
       RETURNING show_until`,
      [id, title, message, flags.to_schools, flags.to_orgs, flags.to_students, flags.to_parents, flags.to_volunteers, Math.round(hours), recipients.length],
    )
    res.status(201).json({ id, showUntil: rows[0].show_until, emailsTotal: recipients.length })
    sendInBackground(id, title, message, recipients).catch((e) => console.error('announcement email failed:', e.message))
  } catch (error) {
    console.error('announcement create failed:', error)
    return res.status(500).json({ error: 'Could not send the announcement.' })
  }
})

// GET /api/announcements/admin — the ones still showing, newest first, with
// how far their emails have got.
router.get('/admin', limiter, requireDb, requireAuth('admin'), async (_req, res) => {
  try {
    const { rows } = await query(`SELECT * FROM announcements WHERE organization_id IS NULL AND ${ACTIVE} ORDER BY created_at DESC LIMIT 50`)
    return res.json({ announcements: rows.map(toJson) })
  } catch (error) {
    console.error('announcement list failed:', error)
    return res.status(500).json({ error: 'Could not load announcements.' })
  }
})

// POST /api/announcements/admin/:id/end — takes the banner down now.
router.post('/admin/:id/end', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rowCount } = await query(`UPDATE announcements SET ended_at = now() WHERE id = $1 AND organization_id IS NULL AND ${ACTIVE}`, [req.params.id])
    if (rowCount === 0) return res.status(404).json({ error: 'That announcement is no longer showing.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('announcement end failed:', error)
    return res.status(500).json({ error: 'Could not end the announcement.' })
  }
})

// GET /api/announcements/mine — what the caller's dashboard should show: the
// admin's for this role, plus the caller's own organization's (#557), found
// through their school.
router.get('/mine', limiter, requireDb, requireAuth(...Object.keys(COLUMN_FOR_ROLE)), async (req, res) => {
  const column = COLUMN_FOR_ROLE[req.auth.role]
  try {
    const { rows } = await query(
      `SELECT a.id, a.title, a.message, a.show_until, o.name AS from_name
         FROM announcements a
         LEFT JOIN organizations o ON o.id = a.organization_id
        WHERE a.${column} AND ${ACTIVE_A}
          AND (a.organization_id IS NULL OR a.organization_id = (
                SELECT s.organization_id FROM users u JOIN schools s ON s.id = u.school_id WHERE u.id = $1))
        ORDER BY a.created_at DESC LIMIT 5`,
      [req.auth.sub],
    )
    return res.json({ announcements: rows.map((r) => ({ id: r.id, title: r.title, message: r.message, showUntil: r.show_until, from: r.from_name || null })) })
  } catch (error) {
    console.error('announcement mine failed:', error)
    return res.status(500).json({ error: 'Could not load announcements.' })
  }
})

// ---------------------------------------------------------------------------
// An organization's announcements to its own schools (#557)
// ---------------------------------------------------------------------------

const ORG_PER_DAY = 5

async function callerOrg(req) {
  const { rows } = await query(
    `SELECT o.id, o.name FROM users u JOIN organizations o ON o.id = u.organization_id WHERE u.id = $1`,
    [req.auth.sub],
  )
  return rows[0] || null
}

// The admins and co-admins of the org's schools (their logins and each
// school's contact address), and with toStudents its students too. Same
// skips as the admin's list: pending-consent under-13s and @test.com.
async function orgRecipients(orgId, { toSchools, toStudents }) {
  const byEmail = new Map()
  const add = (email, name, dashboardPath) => {
    const key = String(email || '').trim().toLowerCase()
    if (key && !key.endsWith('@test.com') && !byEmail.has(key)) byEmail.set(key, { email: key, name: name || 'there', dashboardPath })
  }
  if (toSchools) {
    const { rows: schools } = await query('SELECT name, contact_email FROM schools WHERE organization_id = $1 AND contact_email IS NOT NULL', [orgId])
    schools.forEach((s) => add(s.contact_email, s.name, '/school/dashboard'))
    const { rows: staff } = await query(
      `SELECT u.name, u.email FROM users u JOIN schools s ON s.id = u.school_id
        WHERE s.organization_id = $1 AND u.role IN ('school','school_staff')`,
      [orgId],
    )
    staff.forEach((u) => add(u.email, u.name, '/school/dashboard'))
  }
  if (toStudents) {
    const { rows } = await query(
      `SELECT u.name, u.email FROM users u JOIN schools s ON s.id = u.school_id
        WHERE s.organization_id = $1 AND u.role = 'student'
          AND (u.parental_consent_status IS NULL OR u.parental_consent_status <> 'pending')`,
      [orgId],
    )
    rows.forEach((u) => add(u.email, u.name, '/'))
  }
  return [...byEmail.values()]
}

const orgJson = (r) => ({
  id: r.id, title: r.title, message: r.message, toSchools: r.to_schools, toStudents: r.to_students,
  showUntil: r.show_until, createdAt: r.created_at, emailsSent: r.emails_sent, emailsTotal: r.emails_total,
})

// POST /api/announcements/org { title, message, toSchools, toStudents, showForHours }
router.post('/org', limiter, requireDb, requireAuth('org'), async (req, res) => {
  const title = String(req.body.title || '').trim()
  const message = String(req.body.message || '').trim()
  const hours = Number(req.body.showForHours)
  const toSchools = req.body.toSchools === true
  const toStudents = req.body.toStudents === true

  if (!title || title.length > 120) return res.status(400).json({ error: 'A title of up to 120 characters is required.' })
  if (!message || message.length > 2000) return res.status(400).json({ error: 'A message of up to 2000 characters is required.' })
  if (!toSchools && !toStudents) return res.status(400).json({ error: 'Choose school admins, students, or both.' })
  if (!Number.isFinite(hours) || hours < 1 || hours > MAX_SHOW_HOURS) {
    return res.status(400).json({ error: `Show it for between 1 hour and ${MAX_SHOW_HOURS / 24} days.` })
  }

  try {
    const org = await callerOrg(req)
    if (!org) return res.status(404).json({ error: 'Organization not found.' })
    const { rows: recent } = await query(
      `SELECT COUNT(*)::int AS n FROM announcements WHERE organization_id = $1 AND created_at > now() - interval '1 day'`,
      [org.id],
    )
    if (recent[0].n >= ORG_PER_DAY) return res.status(429).json({ error: `You can send up to ${ORG_PER_DAY} announcements a day.` })

    const recipients = await orgRecipients(org.id, { toSchools, toStudents })
    const id = uid('ann')
    const { rows } = await query(
      `INSERT INTO announcements (id, title, message, to_schools, to_students, organization_id, show_until, emails_total)
       VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(hours => $7), $8)
       RETURNING *`,
      [id, title, message, toSchools, toStudents, org.id, Math.round(hours), recipients.length],
    )
    res.status(201).json({ announcement: orgJson(rows[0]) })
    sendInBackground(id, title, message, recipients, org.name).catch((e) => console.error('org announcement email failed:', e.message))
  } catch (error) {
    console.error('org announcement create failed:', error)
    return res.status(500).json({ error: 'Could not send the announcement.' })
  }
})

// GET /api/announcements/org — this org's announcements still showing.
router.get('/org', limiter, requireDb, requireAuth('org'), async (req, res) => {
  try {
    const org = await callerOrg(req)
    if (!org) return res.status(404).json({ error: 'Organization not found.' })
    const { rows } = await query(
      `SELECT * FROM announcements WHERE organization_id = $1 AND ${ACTIVE} ORDER BY created_at DESC LIMIT 20`,
      [org.id],
    )
    return res.json({ announcements: rows.map(orgJson) })
  } catch (error) {
    console.error('org announcement list failed:', error)
    return res.status(500).json({ error: 'Could not load announcements.' })
  }
})

// POST /api/announcements/org/:id/end — takes this org's banner down now.
router.post('/org/:id/end', limiter, requireDb, requireAuth('org'), async (req, res) => {
  try {
    const org = await callerOrg(req)
    if (!org) return res.status(404).json({ error: 'Organization not found.' })
    const { rowCount } = await query(
      `UPDATE announcements SET ended_at = now() WHERE id = $1 AND organization_id = $2 AND ${ACTIVE}`,
      [req.params.id, org.id],
    )
    if (rowCount === 0) return res.status(404).json({ error: 'That announcement is no longer showing.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('org announcement end failed:', error)
    return res.status(500).json({ error: 'Could not end the announcement.' })
  }
})

export default router
