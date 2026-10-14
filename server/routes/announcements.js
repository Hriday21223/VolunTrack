import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { uid } from '../ids.js'
import { sendEmail, announcementHtml } from '../email.js'

// Admin announcements to schools and/or organizations (#290) — e.g. "we'll
// be offline for maintenance from 8–9 PM". A banner on the school and
// organization dashboards until it expires, plus one email per contact.
// Not shown to students, parents or volunteers.
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

// POST /api/announcements/admin — saves the announcement, then emails every
// contact in the audience, one message each: a shared thread would show
// every customer the others' addresses.
router.post('/admin', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const title = String(req.body.title || '').trim()
  const message = String(req.body.message || '').trim()
  const toSchools = req.body.toSchools === true
  const toOrgs = req.body.toOrgs === true
  const hours = Number(req.body.showForHours)

  if (!title || title.length > 120) return res.status(400).json({ error: 'A title of up to 120 characters is required.' })
  if (!message || message.length > 2000) return res.status(400).json({ error: 'A message of up to 2000 characters is required.' })
  if (!toSchools && !toOrgs) return res.status(400).json({ error: 'Choose schools, organizations, or both.' })
  if (!Number.isFinite(hours) || hours < 1 || hours > MAX_SHOW_HOURS) {
    return res.status(400).json({ error: `Show it for between 1 hour and ${MAX_SHOW_HOURS / 24} days.` })
  }

  try {
    const id = uid('ann')
    const { rows } = await query(
      `INSERT INTO announcements (id, title, message, to_schools, to_orgs, show_until)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6))
       RETURNING show_until`,
      [id, title, message, toSchools, toOrgs, Math.round(hours)],
    )

    const recipients = []
    if (toSchools) {
      const { rows: schools } = await query('SELECT name, contact_email FROM schools WHERE contact_email IS NOT NULL')
      recipients.push(...schools.map((s) => ({ name: s.name, email: s.contact_email, dashboardPath: '/school/dashboard' })))
    }
    if (toOrgs) {
      const { rows: orgs } = await query('SELECT name, contact_email FROM organizations WHERE contact_email IS NOT NULL')
      recipients.push(...orgs.map((o) => ({ name: o.name, email: o.contact_email, dashboardPath: '/organization/dashboard' })))
    }
    const results = await Promise.all(recipients.map((r) => sendEmail({
      to: r.email,
      subject: `VolunTrack: ${title}`,
      html: announcementHtml({ recipientName: r.name, title, message, dashboardPath: r.dashboardPath }),
    }).catch(() => ({ sent: false }))))

    return res.status(201).json({
      id,
      showUntil: rows[0].show_until,
      emailsSent: results.filter((r) => r.sent).length,
      emailsTotal: recipients.length,
    })
  } catch (error) {
    console.error('announcement create failed:', error)
    return res.status(500).json({ error: 'Could not send the announcement.' })
  }
})

// GET /api/announcements/admin — the ones still showing, newest first.
router.get('/admin', limiter, requireDb, requireAuth('admin'), async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, title, message, to_schools, to_orgs, show_until, created_at
         FROM announcements WHERE ${ACTIVE} ORDER BY created_at DESC LIMIT 50`,
    )
    return res.json({
      announcements: rows.map((r) => ({
        id: r.id, title: r.title, message: r.message, toSchools: r.to_schools, toOrgs: r.to_orgs,
        showUntil: r.show_until, createdAt: r.created_at,
      })),
    })
  } catch (error) {
    console.error('announcement list failed:', error)
    return res.status(500).json({ error: 'Could not load announcements.' })
  }
})

// POST /api/announcements/admin/:id/end — takes the banner down now.
router.post('/admin/:id/end', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rowCount } = await query(`UPDATE announcements SET ended_at = now() WHERE id = $1 AND ${ACTIVE}`, [req.params.id])
    if (rowCount === 0) return res.status(404).json({ error: 'That announcement is no longer showing.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('announcement end failed:', error)
    return res.status(500).json({ error: 'Could not end the announcement.' })
  }
})

// GET /api/announcements/mine — what the caller's dashboard should show. The
// audience comes from the token's role, never from the request.
router.get('/mine', limiter, requireDb, requireAuth('school', 'school_staff', 'org'), async (req, res) => {
  const column = req.auth.role === 'org' ? 'to_orgs' : 'to_schools'
  try {
    const { rows } = await query(
      `SELECT id, title, message, show_until FROM announcements
        WHERE ${column} AND ${ACTIVE} ORDER BY created_at DESC LIMIT 5`,
    )
    return res.json({ announcements: rows.map((r) => ({ id: r.id, title: r.title, message: r.message, showUntil: r.show_until })) })
  } catch (error) {
    console.error('announcement mine failed:', error)
    return res.status(500).json({ error: 'Could not load announcements.' })
  }
})

export default router
