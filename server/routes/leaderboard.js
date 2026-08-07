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
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// "Jane Doe" -> "Jane D." — never expose a student's full name or email
// outside their own school.
function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/)
  if (parts.length < 2) return parts[0] || 'Volunteer'
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
}

// Ranks students within the caller's own school by approved hours. Scoped
// to school on purpose — no cross-school student-level visibility.
router.get('/students', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows: me } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    const schoolId = me[0]?.school_id
    if (!schoolId) return res.json({ students: [], schoolId: null })

    const { rows } = await query(
      `SELECT u.id, u.name, COALESCE(SUM(l.hours), 0) AS total_hours
       FROM users u
       LEFT JOIN logs l ON l.user_id = u.id AND l.verification_status = 'approved'
       WHERE u.school_id = $1 AND u.role IN ('student', 'volunteer')
       GROUP BY u.id, u.name
       ORDER BY total_hours DESC
       LIMIT 25`,
      [schoolId],
    )
    const students = rows.map((r) => ({
      id: r.id,
      name: shortName(r.name),
      hours: Number(r.total_hours),
      you: r.id === req.auth.sub,
    }))
    return res.json({ students, schoolId })
  } catch (error) {
    console.error('student leaderboard failed:', error)
    return res.status(500).json({ error: 'Could not load leaderboard.' })
  }
})

// Ranks schools by aggregate approved hours. Public — only aggregate
// numbers and school names, no individual student data.
router.get('/schools', limiter, requireDb, async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.name, COALESCE(SUM(l.hours), 0) AS total_hours, COUNT(DISTINCT u.id) AS student_count
       FROM schools s
       JOIN users u ON u.school_id = s.id AND u.role IN ('student', 'volunteer')
       LEFT JOIN logs l ON l.user_id = u.id AND l.verification_status = 'approved'
       GROUP BY s.id, s.name
       ORDER BY total_hours DESC
       LIMIT 25`,
    )
    const schools = rows.map((r) => ({
      id: r.id,
      name: r.name,
      hours: Number(r.total_hours),
      studentCount: Number(r.student_count),
    }))
    return res.json({ schools })
  } catch (error) {
    console.error('school leaderboard failed:', error)
    return res.status(500).json({ error: 'Could not load leaderboard.' })
  }
})

export default router
