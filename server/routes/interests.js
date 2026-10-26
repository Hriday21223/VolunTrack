import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { SPOTS_USED_SQL } from '../spots.js'
import { TASK_CATEGORIES } from './school.js'
import { requireCronKey, cronLimiter } from '../cronAuth.js'
import { hasEmail } from '../email.js'
import { escapeHtml } from '../html.js'
import { runTaskAlerts } from '../taskAlerts.js'

// A student's interests: the causes they care about, picked from the same
// activity categories tasks and logs use. They drive the "For you" row at the
// top of Opportunities (src/components/ForYouTasks.jsx) and nothing else.

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

export const MAX_INTERESTS = 10
const FOR_YOU_LIMIT = 6

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// GET /api/interests — the caller's chosen causes ([] when none yet).
router.get('/', limiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const { rows } = await query('SELECT interests FROM users WHERE id = $1', [req.auth.sub])
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' })
    return res.json({ interests: rows[0].interests || [] })
  } catch (error) {
    console.error('interests read failed:', error)
    return res.status(500).json({ error: 'Could not load your interests.' })
  }
})

// PUT /api/interests { interests: string[] } — replaces the whole list.
router.put('/', limiter, requireDb, requireAuth('student'), async (req, res) => {
  const list = req.body?.interests
  if (!Array.isArray(list) || !list.every((x) => typeof x === 'string')) {
    return res.status(400).json({ error: 'interests must be a list of categories.' })
  }
  const unique = [...new Set(list)]
  if (unique.length > MAX_INTERESTS) {
    return res.status(400).json({ error: `Pick up to ${MAX_INTERESTS} causes.` })
  }
  if (!unique.every((c) => TASK_CATEGORIES.includes(c))) {
    return res.status(400).json({ error: 'Pick causes from the list.' })
  }
  // Stored in the list's own order, so it reads the same everywhere.
  const interests = TASK_CATEGORIES.filter((c) => unique.includes(c))
  try {
    const { rowCount } = await query('UPDATE users SET interests = $1 WHERE id = $2', [interests, req.auth.sub])
    if (rowCount === 0) return res.status(404).json({ error: 'Account not found.' })
    return res.json({ interests })
  } catch (error) {
    console.error('interests save failed:', error)
    return res.status(500).json({ error: 'Could not save your interests.' })
  }
})

// GET /api/interests/for-you — up to six upcoming open tasks in the caller's
// causes. Same exclusions as GET /api/school/public-tasks (cancelled or past,
// suspended or blocked organizers), plus full tasks, the caller's own, and any
// they already signed up for (or are waitlisted on).
router.get('/for-you', limiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const me = await query('SELECT interests FROM users WHERE id = $1', [req.auth.sub])
    const interests = me.rows[0]?.interests || []
    if (interests.length === 0) return res.json({ interests: [], tasks: [] })
    const { rows } = await query(
      `SELECT t.id, t.title, t.description, t.location, to_char(t.date, 'YYYY-MM-DD') AS date, t.time,
              t.category, t.creator_name, t.slots_total,
              ${SPOTS_USED_SQL('t.id')} AS slots_filled
         FROM public_tasks t
        WHERE t.status = 'open'
          AND t.date >= CURRENT_DATE - 1
          AND t.category = ANY($2::text[])
          AND t.created_by <> $1
          AND NOT EXISTS (SELECT 1 FROM users cu WHERE cu.id = t.created_by AND cu.posting_suspended_at IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = $1 AND b.blocked_id = t.created_by)
          AND NOT EXISTS (SELECT 1 FROM public_task_signups s WHERE s.task_id = t.id AND s.user_id = $1)
          AND ${SPOTS_USED_SQL('t.id')} < t.slots_total
        ORDER BY t.date ASC, t.created_at DESC
        LIMIT $3`,
      [req.auth.sub, interests, FOR_YOU_LIMIT],
    )
    return res.json({ interests, tasks: rows })
  } catch (error) {
    console.error('for-you tasks failed:', error)
    return res.status(500).json({ error: 'Could not load tasks for you.' })
  }
})

// --- New opportunity alerts (#543, server/taskAlerts.js) ---------------------

router.get('/alerts', limiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const { rows } = await query('SELECT task_alerts_opt_in FROM users WHERE id = $1', [req.auth.sub])
    if (!rows[0]) return res.status(404).json({ error: 'Account not found.' })
    return res.json({ enabled: rows[0].task_alerts_opt_in })
  } catch (error) {
    console.error('task alerts preference read failed:', error)
    return res.status(500).json({ error: 'Could not read your alert setting.' })
  }
})

router.patch('/alerts', limiter, requireDb, requireAuth('student'), async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false.' })
  try {
    await query('UPDATE users SET task_alerts_opt_in = $1 WHERE id = $2', [req.body.enabled, req.auth.sub])
    return res.json({ enabled: req.body.enabled })
  } catch (error) {
    console.error('task alerts preference update failed:', error)
    return res.status(500).json({ error: 'Could not save your alert setting.' })
  }
})

// POST /api/interests/internal/run-alerts { dryRun?, only? }
router.post('/internal/run-alerts', cronLimiter(), requireCronKey, requireDb, async (req, res) => {
  const dryRun = req.body?.dryRun === true
  let only = null
  if (req.body?.only !== undefined) {
    const ids = req.body.only
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || !ids.every((x) => typeof x === 'string' && x.length <= 100)) {
      return res.status(400).json({ error: 'only must be a list of up to 100 user ids.' })
    }
    only = ids
  }
  try {
    const out = await runTaskAlerts({ dryRun, only })
    return res.json({ ok: true, dryRun, ...out, emailConfigured: hasEmail() })
  } catch (error) {
    console.error('task alerts run failed:', error)
    return res.status(500).json({ error: 'Could not run the opportunity alerts.' })
  }
})

const unsubLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false })
const PAGE_STYLE = 'font-family:system-ui,-apple-system,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5'
const TOKEN_RE = /^[a-f0-9]{64}$/
const page = (message) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>VolunTrack</title><body style="${PAGE_STYLE}"><p>${escapeHtml(message)}</p></body></html>`

// GET only asks (mail scanners open links); POST turns alerts off.
router.get('/alerts/unsubscribe/:token', unsubLimiter, requireDb, async (req, res) => {
  const token = String(req.params.token || '')
  if (!TOKEN_RE.test(token)) return res.status(400).type('html').send(page('This link is not valid.'))
  try {
    const { rows } = await query(`SELECT task_alerts_opt_in FROM users WHERE digest_unsub_token = $1 AND role = 'student'`, [token])
    if (!rows[0]) return res.status(404).type('html').send(page('This unsubscribe link is invalid or expired.'))
    if (!rows[0].task_alerts_opt_in) return res.type('html').send(page("You're already unsubscribed from these emails."))
    return res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>VolunTrack</title><body style="${PAGE_STYLE}"><p>Stop the weekly emails about new volunteer opportunities?</p><form method="post"><button type="submit" style="font-size:1rem;padding:0.5rem 1rem">Stop these emails</button></form></body></html>`)
  } catch (error) {
    console.error('task alerts unsubscribe (GET) failed:', error)
    return res.status(500).type('html').send(page('Something went wrong. Please try again later.'))
  }
})

router.post('/alerts/unsubscribe/:token', unsubLimiter, requireDb, async (req, res) => {
  const token = String(req.params.token || '')
  if (!TOKEN_RE.test(token)) return res.status(400).type('html').send(page('This link is not valid.'))
  try {
    const { rowCount } = await query(`UPDATE users SET task_alerts_opt_in = false WHERE digest_unsub_token = $1 AND role = 'student'`, [token])
    if (!rowCount) return res.status(404).type('html').send(page('This unsubscribe link is invalid or expired.'))
    return res.type('html').send(page("Done — we won't email you about new opportunities any more. You can turn alerts back on in Opportunities."))
  } catch (error) {
    console.error('task alerts unsubscribe (POST) failed:', error)
    return res.status(500).type('html').send(page('Something went wrong. Please try again later.'))
  }
})

export default router
