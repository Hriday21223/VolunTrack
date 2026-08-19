import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { uid, generateToken } from '../ids.js'
import { sendEmail, emailFooterHtml } from '../email.js'
import { escapeHtml } from '../html.js'

function frontendUrl() {
  return process.env.FRONTEND_URL || 'http://localhost:5173'
}

// Notified when a real incident is detected/logged — falls back to
// EMAIL_USER (the sending mailbox) if ADMIN_EMAIL isn't set, so this never
// silently no-ops when SMTP is otherwise configured.
function notifyRecipient() {
  return process.env.ADMIN_EMAIL || process.env.EMAIL_USER || null
}

// Fires once per incident (on creation only, not on every health poll) —
// unlike the old system, which emailed on every visitor's browser quirk.
// Notifies both the admin and every visitor who opted in on /status.
async function notifyIncident({ service, detail, source }) {
  const when = new Date().toLocaleString()
  const safeService = escapeHtml(service)
  const bodyHtml = `<p><strong>${safeService}</strong> was flagged ${source === 'admin' ? 'by an admin' : 'automatically'} at ${when}.</p>`
    + (detail ? `<p>${escapeHtml(detail)}</p>` : '')

  const admin = notifyRecipient()
  if (admin) {
    sendEmail({ to: admin, subject: `VolunTrack incident: ${service}`, html: bodyHtml }).catch(() => {})
  }

  if (!hasDatabase()) return
  try {
    const { rows } = await query('SELECT email, token FROM status_subscribers WHERE confirmed = true')
    rows.forEach((sub) => {
      const unsubscribeUrl = `${frontendUrl()}/status?unsubscribe=${sub.token}`
      sendEmail({
        to: sub.email,
        subject: `VolunTrack incident: ${service}`,
        html: `${bodyHtml}<p style="margin-top:16px;font-size:12px;color:#888"><a href="${unsubscribeUrl}">Unsubscribe from status updates</a></p>${emailFooterHtml()}`,
      }).catch(() => {})
    })
  } catch (error) {
    console.error('notify subscribers failed:', error)
  }
}

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

// Auto-logs/resolves a 'Database' incident as a side effect of the health
// check itself — this app has no background job runner, so "detect on the
// next request" is the simple, honest option rather than a fake cron.
async function syncDatabaseIncident(databaseOk) {
  try {
    const { rows } = await query(
      `SELECT id FROM incidents WHERE service = 'Database' AND status = 'detected' LIMIT 1`,
    )
    if (!databaseOk && rows.length === 0) {
      const detail = 'Database health check failed.'
      await query(
        `INSERT INTO incidents (id, service, detail, status, source) VALUES ($1, 'Database', $2, 'detected', 'auto')`,
        [uid('inc'), detail],
      )
      await notifyIncident({ service: 'Database', detail, source: 'auto' })
    } else if (databaseOk && rows.length > 0) {
      await query(
        `UPDATE incidents SET status = 'resolved', resolved_at = now() WHERE id = $1`,
        [rows[0].id],
      )
    }
  } catch (error) {
    console.error('syncDatabaseIncident failed:', error)
  }
}

// Public: /status polls this to render real backend/DB health instead of
// per-browser feature checks.
router.get('/health', limiter, async (_req, res) => {
  const emailOk = Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASSWORD)
  let databaseOk = false

  if (hasDatabase()) {
    try {
      await query('SELECT 1')
      databaseOk = true
    } catch (error) {
      console.error('health check: database query failed:', error)
      databaseOk = false
    }
    await syncDatabaseIncident(databaseOk)
  }

  const ok = (!hasDatabase() || databaseOk)
  res.json({
    ok,
    checks: {
      database: { ok: hasDatabase() ? databaseOk : null },
      email: { ok: emailOk },
    },
    timestamp: new Date().toISOString(),
  })
})

// Public: real, shared incident history (not per-browser localStorage).
router.get('/incidents', limiter, requireDb, async (_req, res) => {
  try {
    const { rows } = await query('SELECT * FROM incidents ORDER BY detected_at DESC LIMIT 50')
    return res.json(rows.map((r) => ({
      id: r.id,
      service: r.service,
      detail: r.detail,
      status: r.status,
      source: r.source,
      detectedAt: r.detected_at,
      resolvedAt: r.resolved_at,
    })))
  } catch (error) {
    console.error('list incidents failed:', error)
    return res.status(500).json({ error: 'Could not fetch incidents.' })
  }
})

// Admin-only: manually log a real incident (e.g. planned maintenance,
// a third-party outage) that isn't caught by the automated DB check.
router.post('/incidents', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const service = String(req.body.service || '').trim()
  const detail = String(req.body.detail || '').trim()

  if (!service || service.length > 200) return res.status(400).json({ error: 'Invalid service.' })
  if (detail.length > 1000) return res.status(400).json({ error: 'Invalid detail.' })

  try {
    const id = uid('inc')
    await query(
      `INSERT INTO incidents (id, service, detail, status, source) VALUES ($1, $2, $3, 'detected', 'admin')`,
      [id, service, detail || null],
    )
    await notifyIncident({ service, detail, source: 'admin' })
    return res.status(201).json({ id })
  } catch (error) {
    console.error('create incident failed:', error)
    return res.status(500).json({ error: 'Could not create incident.' })
  }
})

// Admin-only: resolve or reopen an incident.
router.patch('/incidents/:id', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const { id } = req.params
  const status = String(req.body.status || '')
  if (status !== 'resolved' && status !== 'detected') {
    return res.status(400).json({ error: 'Invalid status.' })
  }

  try {
    const { rowCount } = status === 'resolved'
      ? await query(`UPDATE incidents SET status = $1, resolved_at = now() WHERE id = $2`, [status, id])
      : await query(`UPDATE incidents SET status = $1, resolved_at = NULL WHERE id = $2`, [status, id])
    if (rowCount === 0) return res.status(404).json({ error: 'Incident not found.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('update incident failed:', error)
    return res.status(500).json({ error: 'Could not update incident.' })
  }
})

// Public: opt in to incident emails. Double opt-in — the row starts
// unconfirmed and a confirmation link is emailed, so this endpoint can't be
// used to spam-subscribe someone else's address.
router.post('/subscribe', limiter, requireDb, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase()
  if (!email || !email.includes('@') || email.length > 254) {
    return res.status(400).json({ error: 'Invalid email.' })
  }

  try {
    const { rows } = await query('SELECT id, token, confirmed FROM status_subscribers WHERE email = $1', [email])
    let token = rows[0]?.token

    if (rows.length === 0) {
      token = generateToken()
      await query(
        'INSERT INTO status_subscribers (id, email, token, confirmed) VALUES ($1, $2, $3, false)',
        [uid('sub'), email, token],
      )
    } else if (rows[0].confirmed) {
      // Already subscribed — no-op, and don't re-send an email.
      return res.json({ ok: true, alreadySubscribed: true })
    }

    const confirmUrl = `${frontendUrl()}/status?confirm=${token}`
    await sendEmail({
      to: email,
      subject: 'Confirm your VolunTrack status subscription',
      html: `<p>Click below to confirm you want email updates when VolunTrack has an incident.</p>`
        + `<p><a href="${confirmUrl}">Confirm subscription</a></p>`
        + `<p style="font-size:12px;color:#888">If you didn't request this, you can ignore this email.</p>`
        + emailFooterHtml(),
    })
    return res.json({ ok: true })
  } catch (error) {
    console.error('subscribe failed:', error)
    return res.status(500).json({ error: 'Could not subscribe.' })
  }
})

router.get('/subscribe/confirm/:token', limiter, requireDb, async (req, res) => {
  try {
    const { rowCount } = await query(
      'UPDATE status_subscribers SET confirmed = true WHERE token = $1',
      [req.params.token],
    )
    if (rowCount === 0) return res.status(404).json({ error: 'Invalid or expired confirmation link.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('confirm subscription failed:', error)
    return res.status(500).json({ error: 'Could not confirm subscription.' })
  }
})

router.get('/subscribe/unsubscribe/:token', limiter, requireDb, async (req, res) => {
  try {
    const { rowCount } = await query('DELETE FROM status_subscribers WHERE token = $1', [req.params.token])
    if (rowCount === 0) return res.status(404).json({ error: 'Invalid or expired unsubscribe link.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('unsubscribe failed:', error)
    return res.status(500).json({ error: 'Could not unsubscribe.' })
  }
})

export default router
