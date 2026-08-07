import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

// Server-computed alerts for the signed-in user: progress on each of their
// deadline goals, and how long it's been since they last logged hours.
// Read-only and cheap to poll — this is what covers goal-deadline and
// "log your hours" reminders in-app, independent of (and faster than) the
// once-a-day email digest in server.js, which can miss a cold Render
// instance.
router.get('/me', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows: goalRows } = await query(
      `SELECT g.id, g.label, g.target, g.deadline,
              COALESCE((SELECT SUM(l.hours) FROM logs l WHERE l.user_id = g.user_id), 0) AS logged_hours
       FROM goals g
       WHERE g.user_id = $1 AND g.deadline IS NOT NULL
       ORDER BY g.deadline ASC`,
      [req.auth.sub],
    )
    const today = new Date()
    const goalAlerts = goalRows.map((g) => {
      const deadline = new Date(g.deadline)
      const daysUntil = Math.ceil((deadline - today) / MS_PER_DAY)
      const hoursRemaining = Math.max(0, Number(g.target) - Number(g.logged_hours))
      return {
        id: g.id,
        label: g.label,
        target: Number(g.target),
        loggedHours: Number(g.logged_hours),
        hoursRemaining,
        deadline: g.deadline,
        daysUntil,
        urgent: hoursRemaining > 0 && daysUntil <= 7,
      }
    })

    const { rows: lastLog } = await query(
      'SELECT MAX(date) AS last_date FROM logs WHERE user_id = $1',
      [req.auth.sub],
    )
    const lastDate = lastLog[0]?.last_date
    const inactivityDays = lastDate ? Math.floor((today - new Date(lastDate)) / MS_PER_DAY) : null

    return res.json({ goalAlerts, inactivityDays })
  } catch (error) {
    console.error('reminders fetch failed:', error)
    return res.status(500).json({ error: 'Could not load reminders.' })
  }
})

export default router
