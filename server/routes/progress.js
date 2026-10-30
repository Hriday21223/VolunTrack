// Monthly progress email (#483): the cron trigger, the student's switch in
// Settings, and the email's public two-step unsubscribe. Same shape as
// server/routes/comeback.js — the unsubscribe reuses users.digest_unsub_token,
// and the route decides which list it leaves.
import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { hasEmail } from '../email.js'
import { escapeHtml } from '../html.js'
import { requireCronKey, cronLimiter } from '../cronAuth.js'
import { runMonthlyProgress } from '../monthlyProgress.js'
import { runDeadlineReminders } from '../deadlineReminders.js'
import { runSupervisorReminders } from '../supervisorReminders.js'
import { runImpactEmails } from '../impactEmail.js'
import { recordRequirementMet } from '../goalReached.js'

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

const unsubLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// POST /api/progress/internal/run { dryRun?, only?, month? }
router.post('/internal/run', cronLimiter(), requireCronKey, requireDb, async (req, res) => {
  const dryRun = req.body?.dryRun === true
  let only = null
  if (req.body?.only !== undefined) {
    const ids = req.body.only
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || !ids.every((x) => typeof x === 'string' && x.length <= 100)) {
      return res.status(400).json({ error: 'only must be a list of up to 100 student ids.' })
    }
    only = ids
  }
  let month
  if (req.body?.month !== undefined) {
    if (typeof req.body.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(req.body.month)) {
      return res.status(400).json({ error: 'month must look like 2026-10.' })
    }
    month = req.body.month
  }
  try {
    const out = await runMonthlyProgress({ dryRun, only, ...(month ? { month } : {}) })
    return res.json({ ok: true, dryRun, ...out, emailConfigured: hasEmail() })
  } catch (error) {
    console.error('monthly progress run failed:', error)
    return res.status(500).json({ error: 'Could not run the monthly progress emails.' })
  }
})

// POST /api/progress/internal/run-deadline { dryRun? } — deadline reminders (#533).
router.post('/internal/run-deadline', cronLimiter(), requireCronKey, requireDb, async (req, res) => {
  const dryRun = req.body?.dryRun === true
  try {
    const out = await runDeadlineReminders({ dryRun })
    return res.json({ ok: true, dryRun, ...out, emailConfigured: hasEmail() })
  } catch (error) {
    console.error('deadline reminder run failed:', error)
    return res.status(500).json({ error: 'Could not run the deadline reminders.' })
  }
})

// POST /api/progress/internal/run-supervisor-reminders { dryRun? } (#555).
// Answers counts and request ids only: the body lands in an Actions log.
router.post('/internal/run-supervisor-reminders', cronLimiter(), requireCronKey, requireDb, async (req, res) => {
  const dryRun = req.body?.dryRun === true
  try {
    const out = await runSupervisorReminders({ dryRun })
    return res.json({ ok: true, dryRun, ...out, emailConfigured: hasEmail() })
  } catch (error) {
    console.error('supervisor reminder run failed:', error)
    return res.status(500).json({ error: 'Could not run the supervisor reminders.' })
  }
})

// POST /api/progress/internal/run-impact-emails { dryRun?, month? } (#573).
router.post('/internal/run-impact-emails', cronLimiter(), requireCronKey, requireDb, async (req, res) => {
  const dryRun = req.body?.dryRun === true
  const month = /^\d{4}-\d{2}$/.test(String(req.body?.month || '')) ? req.body.month : null
  try {
    const out = await runImpactEmails({ dryRun, month })
    return res.json({ ok: true, dryRun, ...out, emailConfigured: hasEmail() })
  } catch (error) {
    console.error('impact email run failed:', error)
    return res.status(500).json({ error: 'Could not run the impact emails.' })
  }
})

// POST /api/progress/requirement-met (#607): the Dashboard asks when it sees
// the school requirement met. The server re-checks the hours itself; the
// first time, it records it and tells the student's parents. `first` lets the
// app skip the celebration on a second device.
router.post('/requirement-met', limiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const out = await recordRequirementMet(req.auth.sub)
    return res.json(out)
  } catch (error) {
    console.error('requirement met failed:', error)
    return res.status(500).json({ error: 'Could not check your requirement.' })
  }
})

router.get('/preference', limiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const { rows } = await query('SELECT monthly_progress_opt_out FROM users WHERE id = $1', [req.auth.sub])
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' })
    return res.json({ enabled: !rows[0].monthly_progress_opt_out })
  } catch (error) {
    console.error('monthly progress preference read failed:', error)
    return res.status(500).json({ error: 'Could not read your email preference.' })
  }
})

router.patch('/preference', limiter, requireDb, requireAuth('student'), async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false.' })
  try {
    await query('UPDATE users SET monthly_progress_opt_out = $1 WHERE id = $2', [!req.body.enabled, req.auth.sub])
    return res.json({ enabled: req.body.enabled })
  } catch (error) {
    console.error('monthly progress preference update failed:', error)
    return res.status(500).json({ error: 'Could not save your email preference.' })
  }
})

const PAGE_STYLE = 'font-family:system-ui,-apple-system,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5'
const TOKEN_RE = /^[a-f0-9]{64}$/

function page(message) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>VolunTrack</title><body style="${PAGE_STYLE}"><p>${escapeHtml(message)}</p></body></html>`
}

// The form posts back to this same URL (no action), so it works whether the
// page was reached on the backend or through the website's /api pass-through.
function confirmPage() {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>VolunTrack</title><body style="${PAGE_STYLE}"><p>Stop the monthly VolunTrack emails about the hours you logged?</p><form method="post"><button type="submit" style="font-size:1rem;padding:0.5rem 1rem">Stop these emails</button></form><p style="font-size:0.875rem;color:#666">You can turn them back on any time in Settings.</p></body></html>`
}

// GET only asks (mail scanners open links); POST unsubscribes, which is also
// what Gmail's one-click "Unsubscribe" sends (RFC 8058).
router.get('/unsubscribe/:token', unsubLimiter, requireDb, async (req, res) => {
  const token = String(req.params.token || '')
  if (!TOKEN_RE.test(token)) return res.status(400).type('html').send(page('This link is not valid.'))
  try {
    const { rows } = await query(
      `SELECT monthly_progress_opt_out FROM users WHERE digest_unsub_token = $1 AND role = 'student'`,
      [token],
    )
    if (rows.length === 0) return res.status(404).type('html').send(page('This unsubscribe link is invalid or expired.'))
    if (rows[0].monthly_progress_opt_out) return res.type('html').send(page("You're already unsubscribed from these emails."))
    return res.type('html').send(confirmPage())
  } catch (error) {
    console.error('monthly progress unsubscribe (GET) failed:', error)
    return res.status(500).type('html').send(page('Something went wrong. Please try again later.'))
  }
})

router.post('/unsubscribe/:token', unsubLimiter, requireDb, async (req, res) => {
  const token = String(req.params.token || '')
  if (!TOKEN_RE.test(token)) return res.status(400).type('html').send(page('This link is not valid.'))
  try {
    const { rowCount } = await query(
      `UPDATE users SET monthly_progress_opt_out = true WHERE digest_unsub_token = $1 AND role = 'student'`,
      [token],
    )
    if (rowCount === 0) return res.status(404).type('html').send(page('This unsubscribe link is invalid or expired.'))
    return res.type('html').send(page("Done — we won't send you these monthly emails any more. You can turn them back on in Settings."))
  } catch (error) {
    console.error('monthly progress unsubscribe (POST) failed:', error)
    return res.status(500).type('html').send(page('Something went wrong. Please try again later.'))
  }
})

// The monthly impact email's own unsubscribe (#573): removes just that address
// from that school's or organization's list. GET asks, POST does it (RFC 8058).
router.get('/impact-unsubscribe/:token', unsubLimiter, requireDb, async (req, res) => {
  const token = String(req.params.token || '')
  if (!TOKEN_RE.test(token)) return res.status(400).type('html').send(page('This link is not valid.'))
  try {
    const { rows } = await query('SELECT 1 FROM impact_report_recipients WHERE token = $1', [token])
    if (rows.length === 0) return res.type('html').send(page("You're not on this list any more."))
    return res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>VolunTrack</title><body style="${PAGE_STYLE}"><p>Stop the monthly volunteer impact emails?</p><form method="post"><button type="submit" style="font-size:1rem;padding:0.5rem 1rem">Stop these emails</button></form></body></html>`)
  } catch (error) {
    console.error('impact unsubscribe (GET) failed:', error)
    return res.status(500).type('html').send(page('Something went wrong. Please try again later.'))
  }
})

router.post('/impact-unsubscribe/:token', unsubLimiter, requireDb, async (req, res) => {
  const token = String(req.params.token || '')
  if (!TOKEN_RE.test(token)) return res.status(400).type('html').send(page('This link is not valid.'))
  try {
    await query('DELETE FROM impact_report_recipients WHERE token = $1', [token])
    return res.type('html').send(page("Done — you won't get these monthly emails any more."))
  } catch (error) {
    console.error('impact unsubscribe (POST) failed:', error)
    return res.status(500).type('html').send(page('Something went wrong. Please try again later.'))
  }
})

export default router
