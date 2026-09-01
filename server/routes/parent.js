import express from 'express'
import rateLimit from 'express-rate-limit'
import { timingSafeEqual } from 'crypto'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { generateChildLinkCode } from '../ids.js'
import { hasEmail } from '../email.js'
import { escapeHtml } from '../html.js'
import { runWeeklyDigest, previousWeekWindow, weekWindowFromStart } from '../digest.js'

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // 60 to match status.js — the public unsubscribe GET can see bursts from
  // many parents behind one school NAT, plus mail-client link prefetch.
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// A student views their own link code (or null if never generated).
router.get('/child-link-code', limiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const { rows } = await query('SELECT child_link_code FROM users WHERE id = $1', [req.auth.sub])
    return res.json({ childLinkCode: rows[0]?.child_link_code || null })
  } catch (error) {
    console.error('child-link-code fetch failed:', error)
    return res.status(500).json({ error: 'Could not fetch link code.' })
  }
})

// A student generates or regenerates their link code. Regenerating does not
// unlink parents who already linked with the old code.
router.post('/child-link-code', limiter, requireDb, requireAuth('student'), async (req, res) => {
  for (let i = 0; i < 5; i++) {
    const code = generateChildLinkCode()
    try {
      await query('UPDATE users SET child_link_code = $1 WHERE id = $2', [code, req.auth.sub])
      return res.json({ childLinkCode: code })
    } catch (error) {
      if (error.code !== '23505') {
        console.error('child-link-code generate failed:', error)
        return res.status(500).json({ error: 'Could not generate a code.' })
      }
      // Unique collision — try again with a new code.
    }
  }
  return res.status(500).json({ error: 'Could not generate a code, try again.' })
})

// A parent links to a child using the child's code.
router.post('/link', limiter, requireDb, requireAuth('parent'), async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
    return res.status(400).json({ error: 'Invalid code format.' })
  }
  try {
    const { rows } = await query(
      `SELECT id, name, email, grade FROM users WHERE child_link_code = $1 AND role = 'student'`,
      [code],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'No student found with that code.' })

    await query(
      'INSERT INTO parent_child_links (parent_id, child_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.auth.sub, rows[0].id],
    )
    return res.json({ ok: true, child: { id: rows[0].id, name: rows[0].name, email: rows[0].email, grade: rows[0].grade } })
  } catch (error) {
    console.error('parent link failed:', error)
    return res.status(500).json({ error: 'Could not link to student.' })
  }
})

// A parent's linked children.
router.get('/children', limiter, requireDb, requireAuth('parent'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.name, u.email, u.grade
       FROM parent_child_links pcl
       JOIN users u ON u.id = pcl.child_id
       WHERE pcl.parent_id = $1
       ORDER BY u.name`,
      [req.auth.sub],
    )
    return res.json({ children: rows })
  } catch (error) {
    console.error('parent children fetch failed:', error)
    return res.status(500).json({ error: 'Could not fetch children.' })
  }
})

// A parent unlinks a child.
router.delete('/children/:childId', limiter, requireDb, requireAuth('parent'), async (req, res) => {
  try {
    await query(
      'DELETE FROM parent_child_links WHERE parent_id = $1 AND child_id = $2',
      [req.auth.sub, req.params.childId],
    )
    return res.json({ ok: true })
  } catch (error) {
    console.error('parent unlink failed:', error)
    return res.status(500).json({ error: 'Could not unlink student.' })
  }
})

// --- Weekly progress digest ------------------------------------------------

// Shared-secret auth for the cron entrypoint. The global `authenticate`
// middleware is soft (never rejects), so this route would be public without an
// explicit check — the x-cron-key header is the credential. Returns null on
// success, or { code, error } to send back.
function checkCronKey(req) {
  const secret = process.env.CRON_SECRET
  if (!secret) return { code: 503, error: 'Digest cron is not configured.' }
  const provided = Buffer.from(String(req.get('x-cron-key') || ''))
  const expected = Buffer.from(secret)
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { code: 401, error: 'Not authorized.' }
  }
  return null
}

// Cron entrypoint — hit weekly by .github/workflows/parent-weekly-digest.yml.
// Always the just-finished Mon–Sun week, every opted-in parent.
router.post('/internal/run-weekly-digest', limiter, requireDb, async (req, res) => {
  const denied = checkCronKey(req)
  if (denied) return res.status(denied.code).json({ error: denied.error })

  const dryRun = req.body?.dryRun === true
  if (!hasEmail() && !dryRun) return res.status(503).json({ error: 'Email is not configured.' })

  try {
    const win = previousWeekWindow()
    const out = await runWeeklyDigest({ ...win, dryRun })
    return res.json({ ok: true, weekStart: win.weekStart, ...out })
  } catch (error) {
    console.error('run-weekly-digest failed:', error)
    return res.status(500).json({ error: 'Could not run the weekly digest.' })
  }
})

// Admin manual trigger / testing. { weekStart?, parentId?, force?, dryRun? }.
// `force` overrides the parent_digest_sends idempotency table only — never the
// opt-out filter (applied inside buildParentDigests).
router.post('/admin/send-weekly-digest', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const { weekStart, parentId, force, dryRun } = req.body || {}
  const isDryRun = dryRun === true
  if (!hasEmail() && !isDryRun) return res.status(503).json({ error: 'Email is not configured.' })
  if (weekStart !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(weekStart))) {
    return res.status(400).json({ error: 'weekStart must be in YYYY-MM-DD format.' })
  }

  try {
    const win = weekStart ? weekWindowFromStart(String(weekStart)) : previousWeekWindow()
    const out = await runWeeklyDigest({
      ...win,
      parentId: parentId ? String(parentId) : null,
      force: force === true,
      dryRun: isDryRun,
    })
    return res.json({ ok: true, weekStart: win.weekStart, ...out })
  } catch (error) {
    console.error('send-weekly-digest failed:', error)
    return res.status(500).json({ error: 'Could not send the weekly digest.' })
  }
})

function unsubPage(message) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>VolunTrack</title><body style="font-family:system-ui,-apple-system,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><p>${escapeHtml(message)}</p></body></html>`
}

// Public one-click unsubscribe from the digest email. The 64-hex token is the
// credential (no auth). Renders its own page — there is no frontend route for
// this. Idempotent: a repeat hit still matches the row and returns success.
router.get('/digest/unsubscribe/:token', limiter, requireDb, async (req, res) => {
  const token = String(req.params.token || '')
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).type('html').send(unsubPage('This link is not valid.'))
  }
  try {
    const { rowCount } = await query(
      `UPDATE users SET weekly_digest_opt_out = true WHERE digest_unsub_token = $1 AND role = 'parent'`,
      [token],
    )
    if (rowCount === 0) {
      return res.status(404).type('html').send(unsubPage('This unsubscribe link is invalid or expired.'))
    }
    return res.status(200).type('html').send(unsubPage("You've been unsubscribed from the weekly progress digest emails."))
  } catch (error) {
    console.error('digest unsubscribe failed:', error)
    return res.status(500).type('html').send(unsubPage('Something went wrong. Please try again later.'))
  }
})

export default router
