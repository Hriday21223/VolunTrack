import express from 'express'
import rateLimit from 'express-rate-limit'
import { createHash } from 'crypto'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'

// Error logging for the browser and the apps (src/lib/errorReporting.js): a
// crash there used to leave no trace anywhere. Reports are grouped by
// message + first stack line + page, kept without any user identity (no user
// id, no IP, no query string), and shown to the admin in Admin → Incidents.

const router = express.Router()

const reportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many error reports.' },
})
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

const KEEP = 300

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

const text = (v, max) => String(v ?? '').slice(0, max)

// POST /api/client-errors { message, stack?, path?, appVersion? }
router.post('/', reportLimiter, requireDb, async (req, res) => {
  const message = text(req.body?.message, 500).trim()
  if (!message) return res.status(400).json({ error: 'A message is required.' })
  const stack = text(req.body?.stack, 4000)
  // The page only: a query string can hold a token or a code.
  const path = text(req.body?.path, 300).split('?')[0].split('#')[0]
  const appVersion = text(req.body?.appVersion, 40)
  const userAgent = text(req.get('user-agent'), 300)
  const firstFrame = stack.split('\n').find((l) => l.trim().startsWith('at ') || l.includes('@')) || ''
  const fingerprint = createHash('sha256').update(`${message}|${firstFrame.trim()}|${path}`).digest('hex').slice(0, 32)
  try {
    await query(
      `INSERT INTO client_errors (fingerprint, message, stack, path, user_agent, app_version)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (fingerprint) DO UPDATE SET
         count = client_errors.count + 1, last_seen = now(),
         user_agent = EXCLUDED.user_agent, app_version = EXCLUDED.app_version`,
      [fingerprint, message, stack || null, path || null, userAgent || null, appVersion || null],
    )
    // Only the newest groups are kept.
    await query(
      `DELETE FROM client_errors WHERE fingerprint IN (
         SELECT fingerprint FROM client_errors ORDER BY last_seen DESC OFFSET ${KEEP})`,
    )
    return res.status(204).end()
  } catch (error) {
    console.error('client error report failed:', error.message)
    return res.status(500).json({ error: 'Could not record the error.' })
  }
})

router.get('/admin', adminLimiter, requireDb, requireAuth('admin'), async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT fingerprint, message, stack, path, user_agent, app_version, count, first_seen, last_seen
         FROM client_errors ORDER BY last_seen DESC LIMIT 100`,
    )
    return res.json({ errors: rows })
  } catch (error) {
    console.error('client errors fetch failed:', error)
    return res.status(500).json({ error: 'Could not load errors.' })
  }
})

// Clear one group (fixed) or, with no id, all of them.
router.delete('/admin/:fingerprint?', adminLimiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    if (req.params.fingerprint) await query('DELETE FROM client_errors WHERE fingerprint = $1', [req.params.fingerprint])
    else await query('DELETE FROM client_errors')
    return res.json({ ok: true })
  } catch (error) {
    console.error('client errors clear failed:', error)
    return res.status(500).json({ error: 'Could not clear errors.' })
  }
})

export default router
