import express from 'express'
import rateLimit from 'express-rate-limit'
import { createHmac, timingSafeEqual } from 'crypto'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { uid, generateToken } from '../ids.js'
import { sendEmail, emailFooterHtml, hasEmail, emailHealthSnapshot, refreshEmailHealth } from '../email.js'
import { escapeHtml } from '../html.js'
import { createIncidentIssue, closeIncidentIssue, parseIncidentMarker } from '../github.js'
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

// Auto-logs/resolves an incident for `service` as a side effect of the health
// check itself — this app has no background job runner, so "detect on the
// next request" is the simple, honest option rather than a fake cron.
async function syncAutoIncident(service, serviceOk, detail) {
  try {
    if (!serviceOk) {
      // The SELECT still short-circuits the common "incident already open"
      // case (and is the only guard if the unique index failed to create on
      // an older database), but it is no longer what makes this safe.
      const { rows } = await query(
        `SELECT id FROM incidents
          WHERE service = $1 AND status = 'detected' AND source = 'auto' LIMIT 1`,
        [service],
      )
      if (rows.length > 0) return

      // Let the database arbitrate the rest. /health is public and
      // unauthenticated, so several checks can run concurrently while the
      // database is degraded; a SELECT-then-INSERT would let each of them
      // see "no open incident" and open its own, double-sending the email.
      // idx_incidents_one_open_auto (server/db.js) makes at most one of them
      // insert a row, and only that one notifies.
      const incidentId = uid('inc')
      const { rowCount } = await query(
        `INSERT INTO incidents (id, service, detail, status, source)
         VALUES ($1, $2, $3, 'detected', 'auto')
         ON CONFLICT DO NOTHING`,
        [incidentId, service, detail],
      )
      if (rowCount > 0) {
        await notifyIncident({ service, detail, source: 'auto' })
        // File an issue too, and record the link. The Email incident is raised
        // precisely when email is broken, so the notification above cannot
        // arrive — the issue is the channel that still works. No-ops without
        // GITHUB_ISSUE_TOKEN/REPO, and never throws.
        const issueUrl = await createIncidentIssue({ service, detail, incidentId })
        if (issueUrl) {
          await query('UPDATE incidents SET issue_url = $1 WHERE id = $2', [issueUrl, incidentId])
        }
      }
    } else {
      // Close any issue this service filed before resolving, so a recovered
      // service doesn't leave a stale open issue behind. Read the rows first:
      // the UPDATE below can't return what it resolved and still stay a single
      // statement, and an incident with no issue_url just skips this.
      const { rows: open } = await query(
        `SELECT issue_url FROM incidents
          WHERE service = $1 AND status = 'detected' AND source = 'auto' AND issue_url IS NOT NULL`,
        [service],
      )
      // Resolves every open auto incident for the service, not just the first
      // — any duplicates predating the unique index get cleared out too.
      await query(
        `UPDATE incidents SET status = 'resolved', resolved_at = now()
          WHERE service = $1 AND status = 'detected' AND source = 'auto'`,
        [service],
      )
      for (const row of open) {
        await closeIncidentIssue(row.issue_url, `${service} is healthy again — closing automatically.`)
      }
    }
  } catch (error) {
    console.error(`syncAutoIncident(${service}) failed:`, error)
  }
}

// One failed SMTP handshake is usually a blip, and an incident emails every
// subscriber — so require this many probes in a row (probes are at least
// EMAIL_CHECK_INTERVAL_MS apart) before opening one. The notification itself
// goes out over the same SMTP that just failed, so it may well not arrive;
// the incident still shows on /status and in the Admin Incidents tab.
const EMAIL_FAILURES_BEFORE_INCIDENT = 2

// Not awaited by /health: an SMTP handshake can take seconds, and the probe is
// throttled in server/email.js, so most calls just report the last result.
function checkEmailInBackground() {
  const probe = refreshEmailHealth()
  if (!probe || !hasDatabase()) return
  probe.then((health) => {
    if (health.ok) return syncAutoIncident('Email', true)
    if (health.consecutiveFailures < EMAIL_FAILURES_BEFORE_INCIDENT) return
    const code = health.errorCode ? ` (${health.errorCode})` : ''
    return syncAutoIncident('Email', false, `Email (SMTP) connection check failed${code}.`)
  }).catch((error) => console.error('email health check failed:', error))
}

// Public: /status polls this to render real backend/DB health instead of
// per-browser feature checks.
router.get('/health', limiter, async (_req, res) => {
  const emailConfigured = hasEmail()
  if (emailConfigured) checkEmailInBackground()
  let databaseOk = false

  if (hasDatabase()) {
    try {
      await query('SELECT 1')
      databaseOk = true
    } catch (error) {
      console.error('health check: database query failed:', error)
      databaseOk = false
    }
    await syncAutoIncident('Database', databaseOk, 'Database health check failed.')
  }

  const ok = (!hasDatabase() || databaseOk)
  res.json({
    ok,
    checks: {
      database: { ok: hasDatabase() ? databaseOk : null },
      // ok reflects the last real SMTP probe; until the first one finishes it
      // falls back to "configured", which is all this field used to mean.
      email: { configured: emailConfigured, ok: emailConfigured && emailHealthSnapshot().ok !== false },
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
  ['app', 'POST', '/api/auth/reset-password'],
  ['app', 'POST', '/api/send-reset-email'],
  ['app', 'GET', '/api/dev-recovery-code'],
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

// Admin-only: delete an incident outright. Resolving is not enough to unpublish
// one — GET /incidents serves the 50 most recent rows whatever their status — so
// this exists to purge entries that should never have been public.
router.delete('/incidents/:id', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rowCount } = await query('DELETE FROM incidents WHERE id = $1', [req.params.id])
    if (rowCount === 0) return res.status(404).json({ error: 'Incident not found.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('delete incident failed:', error)
    return res.status(500).json({ error: 'Could not delete incident.' })
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

// POST, not GET: both links below are emailed, and link-prescanning mail
// gateways (Outlook Safe Links and friends) fetch every URL they find. The
// emailed link points at the SPA (/status?confirm=…), which only renders a
// button — the state change lives here, behind a POST the scanner won't make.
// Same two-step shape as the parent digest unsubscribe in parent.js.
router.post('/subscribe/confirm/:token', limiter, requireDb, async (req, res) => {
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

router.post('/subscribe/unsubscribe/:token', limiter, requireDb, async (req, res) => {
  try {
    const { rowCount } = await query('DELETE FROM status_subscribers WHERE token = $1', [req.params.token])
    if (rowCount === 0) return res.status(404).json({ error: 'Invalid or expired unsubscribe link.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('unsubscribe failed:', error)
    return res.status(500).json({ error: 'Could not unsubscribe.' })
  }
})

// Only a labelled issue becomes an incident. Without this gate every issue
// opened in the repo — feature work, design discussion — was published on the
// public /status page as though it were an outage, body text and all.
// `outage` is what keep-warm.yml applies; `incident` is for labelling by hand.
const INCIDENT_LABELS = new Set(['outage', 'incident'])

function hasIncidentLabel(issue) {
  return Array.isArray(issue.labels)
    && issue.labels.some((l) => INCIDENT_LABELS.has(String(l?.name || '').trim().toLowerCase()))
}

// Real sync with GitHub Issues: opening a labelled issue creates an incident,
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
    // `labeled` counts too, so labelling an existing issue opens an incident —
    // otherwise only issues created with the label ever could.
    if (action === 'opened' || action === 'labeled') {
      if (!hasIncidentLabel(issue)) return res.status(200).send('OK')
      // An issue we filed ourselves carries the id of the incident that filed
      // it. Attach the link to that incident instead of recording a second one:
      // this delivery can outrun the issue_url UPDATE in syncAutoIncident, so
      // matching on the URL alone would sometimes see "no such incident" and
      // duplicate the row. Matching the marker makes both orderings equivalent.
      const markedId = parseIncidentMarker(issue.body)
      if (markedId) {
        const { rowCount } = await query(
          'UPDATE incidents SET issue_url = $1 WHERE id = $2',
          [issue.html_url, markedId],
        )
        if (rowCount > 0) return res.status(200).send('OK')
      }
      const { rows } = await query(
        `SELECT id FROM incidents WHERE issue_url = $1 AND status = 'detected' LIMIT 1`,
        [issue.html_url],
      )
      if (rows.length === 0) {
        const service = String(issue.title || 'GitHub issue').slice(0, 200)
        await query(
          `INSERT INTO incidents (id, service, status, source, issue_url) VALUES ($1, $2, 'detected', 'github', $3)`,
          [uid('inc'), service, issue.html_url],
        )
        await notifyIncident({ service, source: 'github' })
      }
    } else if (action === 'closed') {
      const { rowCount } = await query(
        `UPDATE incidents SET status = 'resolved', resolved_at = now() WHERE issue_url = $1 AND status = 'detected'`,
        [issue.html_url],
      )
      // keep-warm.yml opens an `outage` issue exactly when the backend is
      // unreachable — so the `opened` delivery to this endpoint fails, and
      // GitHub doesn't retry it. By the time the workflow closes the issue the
      // backend is answering again, so record the outage as resolved history.
      if (rowCount === 0 && hasIncidentLabel(issue)) {
        const { rows } = await query('SELECT 1 FROM incidents WHERE issue_url = $1 LIMIT 1', [issue.html_url])
        if (rows.length === 0) {
          const validTime = (value) => (value && !Number.isNaN(Date.parse(value)) ? value : null)
          await query(
            `INSERT INTO incidents (id, service, status, source, issue_url, detected_at, resolved_at)
             VALUES ($1, $2, 'resolved', 'github', $3, COALESCE($4::timestamptz, now()), COALESCE($5::timestamptz, now()))`,
            [
              uid('inc'),
              String(issue.title || 'Outage').slice(0, 200),
              issue.html_url,
              validTime(issue.created_at),
              validTime(issue.closed_at),
            ],
          )
        }
      }
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
