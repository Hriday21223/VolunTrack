import express from 'express'
import rateLimit from 'express-rate-limit'
import { createHmac, timingSafeEqual } from 'crypto'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { uid, generateToken } from '../ids.js'
import { sendEmail, emailFooterHtml } from '../email.js'
import { escapeHtml } from '../html.js'
import authRouter from './auth.js'
import schoolRouter from './school.js'
import organizationRouter from './organization.js'
import logsRouter from './logs.js'
import parentRouter from './parent.js'
import contactRouter from './contact.js'
import reviewsRouter from './reviews.js'
import invoicesRouter from './invoices.js'
import settingsRouter from './settings.js'

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

// Every router mounted under /api/* in server.js, paired with its mount
// prefix — kept in sync with server.js by hand since Express doesn't expose
// a mount's literal prefix string at runtime, only a compiled regexp.
const MOUNTED_ROUTERS = [
  ['auth', '/api/auth', authRouter],
  ['school', '/api/school', schoolRouter],
  ['organization', '/api/organization', organizationRouter],
  ['logs', '/api/logs', logsRouter],
  ['parent', '/api/parent', parentRouter],
  ['contact', '/api/contact', contactRouter],
  ['reviews', '/api/reviews', reviewsRouter],
  ['invoices', '/api/invoices', invoicesRouter],
  ['settings', '/api/settings', settingsRouter],
  ['status', '/api/status', router],
]

// A handful of routes are registered directly on `app` in server.js rather
// than through a sub-router (webhooks needing a raw body ahead of
// express.json, and a few legacy endpoints) — listed by hand since they
// aren't reachable from a router's own .stack.
const APP_LEVEL_ROUTES = [
  ['app', 'POST', '/api/contact/inbound'],
  ['app', 'GET', '/api/recovery-status'],
  ['app', 'POST', '/api/auth/request-password-reset'],
  ['app', 'POST', '/api/auth/reset-password'],
  ['app', 'POST', '/api/send-reset-email'],
  ['app', 'POST', '/api/send-report'],
  ['app', 'POST', '/api/notify-supervisor'],
  ['app', 'GET', '/api/verify-hours/:token'],
  ['app', 'POST', '/api/verify-hours/:token/:action'],
  ['app', 'POST', '/api/status/github-webhook'],
]

// Admin-only: every backend route, read live off the actual mounted
// Express routers rather than a hand-copied list, so it can't silently
// drift out of date as routes are added or removed.
router.get('/routes', limiter, requireDb, requireAuth('admin'), (_req, res) => {
  const routes = []

  for (const [group, prefix, mountedRouter] of MOUNTED_ROUTERS) {
    for (const layer of mountedRouter.stack) {
      if (!layer.route) continue
      const methods = Object.keys(layer.route.methods)
        .filter((m) => layer.route.methods[m])
        .map((m) => m.toUpperCase())
      const path = prefix + (layer.route.path === '/' ? '' : layer.route.path)
      for (const method of methods) routes.push({ group, method, path })
    }
  }

  for (const [group, method, path] of APP_LEVEL_ROUTES) {
    routes.push({ group, method, path })
  }

  routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
  res.json({ count: routes.length, routes })
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
      issueUrl: r.issue_url,
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
  const issueUrl = String(req.body.issueUrl || '').trim()

  if (!service || service.length > 200) return res.status(400).json({ error: 'Invalid service.' })
  if (detail.length > 1000) return res.status(400).json({ error: 'Invalid detail.' })
  if (issueUrl && (issueUrl.length > 500 || !/^https:\/\/github\.com\//.test(issueUrl))) {
    return res.status(400).json({ error: 'Issue link must be an https://github.com/... URL.' })
  }

  try {
    const id = uid('inc')
    await query(
      `INSERT INTO incidents (id, service, detail, status, source, issue_url) VALUES ($1, $2, $3, 'detected', 'admin', $4)`,
      [id, service, detail || null, issueUrl || null],
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

// Real sync with GitHub Issues: opening an issue creates an incident,
// closing it resolves that incident, reopening it reopens that incident.
// Disabled until GITHUB_WEBHOOK_SECRET is set (the webhook is registered
// on the repo separately, pointed at this endpoint).
//
// NOT mounted on this router: it needs the raw request body for HMAC
// signature verification, so it's registered directly on the app in
// server.js, ahead of the global express.json() parser — same pattern as
// the Resend inbound webhook in server/routes/contact.js.
export async function handleGithubWebhook(req, res) {
  if (!hasDatabase()) return res.status(200).send('OK')

  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.log('[dev] GitHub webhook hit but GITHUB_WEBHOOK_SECRET not set — ignoring.')
    return res.status(200).send('OK')
  }

  const signature = req.headers['x-hub-signature-256']
  if (typeof signature !== 'string' || !signature.startsWith('sha256=')) {
    return res.status(401).send('Missing signature')
  }
  const expected = `sha256=${createHmac('sha256', webhookSecret).update(req.body).digest('hex')}`
  const sigBuf = Buffer.from(signature)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return res.status(401).send('Invalid signature')
  }

  if (req.headers['x-github-event'] !== 'issues') return res.status(200).send('OK')

  let payload
  try {
    payload = JSON.parse(req.body.toString())
  } catch {
    return res.status(400).send('Bad payload')
  }

  const { action, issue } = payload || {}
  if (!issue?.html_url) return res.status(200).send('OK')

  try {
    if (action === 'opened') {
      const { rows } = await query(
        `SELECT id FROM incidents WHERE issue_url = $1 AND status = 'detected' LIMIT 1`,
        [issue.html_url],
      )
      if (rows.length === 0) {
        const service = String(issue.title || 'GitHub issue').slice(0, 200)
        const detail = String(issue.body || '').slice(0, 1000)
        await query(
          `INSERT INTO incidents (id, service, detail, status, source, issue_url) VALUES ($1, $2, $3, 'detected', 'github', $4)`,
          [uid('inc'), service, detail || null, issue.html_url],
        )
        await notifyIncident({ service, detail, source: 'github' })
      }
    } else if (action === 'closed') {
      await query(
        `UPDATE incidents SET status = 'resolved', resolved_at = now() WHERE issue_url = $1 AND status = 'detected'`,
        [issue.html_url],
      )
    } else if (action === 'reopened') {
      await query(
        `UPDATE incidents SET status = 'detected', resolved_at = NULL WHERE issue_url = $1 AND status = 'resolved'`,
        [issue.html_url],
      )
    }
    return res.status(200).send('OK')
  } catch (error) {
    console.error('github webhook failed:', error)
    return res.status(500).send('Error')
  }
}

export default router
