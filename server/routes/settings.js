import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'

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

const DEFAULT_OFFICE_HOURS = {
  days: 'Monday – Friday',
  hours: '9:00 AM – 5:00 PM (CT)',
  note: 'Replies may take up to 48 hours.',
}

// Public: the Contact page reads this to render the office-hours card.
router.get('/office-hours', limiter, requireDb, async (_req, res) => {
  try {
    const { rows } = await query(`SELECT value FROM site_settings WHERE key = 'office_hours'`)
    if (rows.length === 0) return res.json(DEFAULT_OFFICE_HOURS)
    return res.json({ ...DEFAULT_OFFICE_HOURS, ...JSON.parse(rows[0].value) })
  } catch (error) {
    console.error('get office hours failed:', error)
    return res.status(500).json({ error: 'Could not fetch office hours.' })
  }
})

// Admin-only: edit the office-hours card from the admin panel.
router.patch('/office-hours', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const days = String(req.body.days || '').trim()
  const hours = String(req.body.hours || '').trim()
  const note = String(req.body.note || '').trim()

  if (!days || days.length > 200) return res.status(400).json({ error: 'Invalid days.' })
  if (!hours || hours.length > 200) return res.status(400).json({ error: 'Invalid hours.' })
  if (note.length > 200) return res.status(400).json({ error: 'Invalid note.' })

  try {
    const value = JSON.stringify({ days, hours, note })
    await query(
      `INSERT INTO site_settings (key, value, updated_at) VALUES ('office_hours', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
      [value],
    )
    return res.json({ days, hours, note })
  } catch (error) {
    console.error('update office hours failed:', error)
    return res.status(500).json({ error: 'Could not update office hours.' })
  }
})

export default router
