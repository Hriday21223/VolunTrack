import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { hasEmail } from '../email.js'
import { escapeHtml } from '../html.js'
import { requireCronKey, cronLimiter } from '../cronAuth.js'
import { runComebackNudges } from '../comeback.js'

// "Come back" nudge (server/comeback.js): the weekly cron trigger, the
// student's own on/off switch in Settings, and the public unsubscribe link in
// the email.

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

// Looser bucket for the public unsubscribe pages: many students behind one
// school NAT, plus mail-client link prefetch (same reasoning as the digest's).
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

// POST /api/comeback/internal/run  { dryRun?: boolean, only?: string[] }
// Driven by .github/workflows/comeback-nudges.yml. comeback_nudged_at is the
// idempotency key (claimed per student before sending), so a replayed or
// overlapping run nudges nobody twice. `only` limits a run to those student
// ids (a test send); the schedule never passes it.
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
  try {
    const out = await runComebackNudges({ dryRun, only })
    return res.json({ ok: true, dryRun, ...out, emailConfigured: hasEmail() })
  } catch (error) {
    console.error('comeback nudge run failed:', error)
    return res.status(500).json({ error: 'Could not run the comeback nudges.' })
  }
})

// --- The student's own switch (Settings) ---
router.get('/preference', limiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const { rows } = await query('SELECT comeback_opt_out FROM users WHERE id = $1', [req.auth.sub])
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' })
    return res.json({ enabled: !rows[0].comeback_opt_out })
  } catch (error) {
    console.error('comeback preference read failed:', error)
    return res.status(500).json({ error: 'Could not read your email preference.' })
  }
})

router.patch('/preference', limiter, requireDb, requireAuth('student'), async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be true or false.' })
  }
  try {
    await query('UPDATE users SET comeback_opt_out = $1 WHERE id = $2', [!req.body.enabled, req.auth.sub])
    return res.json({ enabled: req.body.enabled })
  } catch (error) {
    console.error('comeback preference update failed:', error)
    return res.status(500).json({ error: 'Could not save your email preference.' })
  }
})

// --- Public unsubscribe from the email link ---
//
// The token is users.digest_unsub_token: one opaque per-account unsubscribe
// credential, assigned on first send. Which list it leaves is decided by the
// route and the account's role, so a student's token can only stop these
// nudges and a parent's only the weekly digest. Two-step on purpose, like the
// digest: the GET only renders a confirm button, so link scanners and
// prefetch can't opt anyone out; the POST changes state.
const PAGE_STYLE = 'font-family:system-ui,-apple-system,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5'
const TOKEN_RE = /^[a-f0-9]{64}$/

function page(message) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>VolunTrack</title><body style="${PAGE_STYLE}"><p>${escapeHtml(message)}</p></body></html>`
}

function confirmPage(token) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>VolunTrack</title><body style="${PAGE_STYLE}"><p>Stop the VolunTrack emails that suggest volunteer tasks after a month without volunteering?</p><form method="post" action="/api/comeback/unsubscribe/${escapeHtml(token)}"><button type="submit" style="font-size:1rem;padding:0.5rem 1rem">Stop these emails</button></form><p style="font-size:0.875rem;color:#666">You can turn them back on any time in Settings.</p></body></html>`
}

router.get('/unsubscribe/:token', unsubLimiter, requireDb, async (req, res) => {
  const token = String(req.params.token || '')
  if (!TOKEN_RE.test(token)) return res.status(400).type('html').send(page('This link is not valid.'))
  try {
    const { rows } = await query(
      `SELECT comeback_opt_out FROM users WHERE digest_unsub_token = $1 AND role = 'student'`,
      [token],
    )
    if (rows.length === 0) return res.status(404).type('html').send(page('This unsubscribe link is invalid or expired.'))
    if (rows[0].comeback_opt_out) {
      return res.status(200).type('html').send(page("You're already unsubscribed from these emails."))
    }
    return res.status(200).type('html').send(confirmPage(token))
  } catch (error) {
    console.error('comeback unsubscribe (GET) failed:', error)
    return res.status(500).type('html').send(page('Something went wrong. Please try again later.'))
  }
})

router.post('/unsubscribe/:token', unsubLimiter, requireDb, async (req, res) => {
  const token = String(req.params.token || '')
  if (!TOKEN_RE.test(token)) return res.status(400).type('html').send(page('This link is not valid.'))
  try {
    const { rowCount } = await query(
      `UPDATE users SET comeback_opt_out = true WHERE digest_unsub_token = $1 AND role = 'student'`,
      [token],
    )
    if (rowCount === 0) return res.status(404).type('html').send(page('This unsubscribe link is invalid or expired.'))
    return res.status(200).type('html').send(page("Done — we won't send you these emails any more. You can turn them back on in Settings."))
  } catch (error) {
    console.error('comeback unsubscribe (POST) failed:', error)
    return res.status(500).type('html').send(page('Something went wrong. Please try again later.'))
  }
})

export default router
