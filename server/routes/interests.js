import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { TASK_CATEGORIES } from './school.js'

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
              (SELECT COUNT(*)::int FROM public_task_signups s
                WHERE s.task_id = t.id AND s.status IN ('pending', 'approved')) AS slots_filled
         FROM public_tasks t
        WHERE t.status = 'open'
          AND t.date >= CURRENT_DATE - 1
          AND t.category = ANY($2::text[])
          AND t.created_by <> $1
          AND NOT EXISTS (SELECT 1 FROM users cu WHERE cu.id = t.created_by AND cu.posting_suspended_at IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = $1 AND b.blocked_id = t.created_by)
          AND NOT EXISTS (SELECT 1 FROM public_task_signups s WHERE s.task_id = t.id AND s.user_id = $1)
          AND (SELECT COUNT(*) FROM public_task_signups s
                WHERE s.task_id = t.id AND s.status IN ('pending', 'approved')) < t.slots_total
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

export default router
