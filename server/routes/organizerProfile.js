import express from 'express'
import rateLimit from 'express-rate-limit'
import validator from 'validator'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { TASK_CATEGORIES } from './school.js'
import { SPOTS_USED_SQL } from '../spots.js'

// Organizer profiles: anyone who posts volunteer tasks can describe
// themselves in Settings (About, an optional https website, causes), and
// signed-in students see it on /organizers/:id with the organizer's upcoming
// tasks, rating and the volunteer hours given at their tasks. Mounted at
// /api/school/organizers, ahead of /api/school.
//
// Same rules as the task list (report and block, #358): nothing for an
// organizer the admin suspended, or when either side blocked the other —
// those answer 404, the same as an id that isn't an organizer at all. No
// email or other private field ever leaves here; hours are a single total.

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

export const MAX_ABOUT = 500
const MAX_WEBSITE = 200
const MAX_TASKS = 20
// Roles that can post volunteer tasks from the app (My Tasks, school dashboard).
const EDITOR_ROLES = ['student', 'volunteer', 'school', 'school_staff', 'org', 'admin']
const NOT_FOUND = { error: 'Organizer not found.' }

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// https only, a real host name, no user:password@ part. Returns the cleaned
// value, null for "no website", or undefined when it isn't acceptable.
export function cleanWebsite(raw) {
  if (raw == null) return null
  if (typeof raw !== 'string') return undefined
  const v = raw.trim()
  if (!v) return null
  if (v.length > MAX_WEBSITE) return undefined
  if (!/^https:\/\//i.test(v)) return undefined
  if (!validator.isURL(v, { protocols: ['https'], require_protocol: true, require_tld: true, disallow_auth: true, allow_underscores: false })) return undefined
  return v
}

const profileOut = (r) => ({
  about: r.organizer_about || '',
  website: r.organizer_website || '',
  causes: r.organizer_causes || [],
})

// GET /api/school/organizers/me — the caller's own profile, for Settings.
router.get('/me', limiter, requireDb, requireAuth(...EDITOR_ROLES), async (req, res) => {
  try {
    const { rows } = await query('SELECT organizer_about, organizer_website, organizer_causes FROM users WHERE id = $1', [req.auth.sub])
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' })
    return res.json({ profile: profileOut(rows[0]) })
  } catch (error) {
    console.error('organizer profile read failed:', error)
    return res.status(500).json({ error: 'Could not load your organizer profile.' })
  }
})

// PUT /api/school/organizers/me { about, website, causes } — replaces all three.
router.put('/me', limiter, requireDb, requireAuth(...EDITOR_ROLES), async (req, res) => {
  const body = req.body || {}
  const aboutRaw = body.about ?? ''
  if (typeof aboutRaw !== 'string') return res.status(400).json({ error: 'About must be text.' })
  const about = aboutRaw.trim()
  if (about.length > MAX_ABOUT) return res.status(400).json({ error: `About must be at most ${MAX_ABOUT} characters.` })
  const website = cleanWebsite(body.website)
  if (website === undefined) return res.status(400).json({ error: 'Website must be a full https:// address, like https://example.org.' })
  const list = body.causes ?? []
  if (!Array.isArray(list) || !list.every((c) => typeof c === 'string' && TASK_CATEGORIES.includes(c))) {
    return res.status(400).json({ error: 'Pick causes from the list.' })
  }
  // Stored in the list's own order, so it reads the same everywhere.
  const causes = TASK_CATEGORIES.filter((c) => list.includes(c))
  try {
    const { rows } = await query(
      `UPDATE users SET organizer_about = $1, organizer_website = $2, organizer_causes = $3 WHERE id = $4
       RETURNING organizer_about, organizer_website, organizer_causes`,
      [about || null, website, causes.length ? causes : null, req.auth.sub],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' })
    return res.json({ profile: profileOut(rows[0]) })
  } catch (error) {
    console.error('organizer profile save failed:', error)
    return res.status(500).json({ error: 'Could not save your organizer profile.' })
  }
})

// GET /api/school/organizers/:id — the public (signed-in) organizer page.
router.get('/:id', limiter, requireDb, requireAuth(), async (req, res) => {
  const id = String(req.params.id || '')
  if (!id || id.length > 100) return res.status(404).json(NOT_FOUND)
  const viewer = req.auth.sub
  try {
    // Someone who has posted at least one task, not suspended, and no block
    // either way between them and the viewer.
    const { rows } = await query(
      `SELECT u.id, u.name, u.organizer_about, u.organizer_website, u.organizer_causes
         FROM users u
        WHERE u.id = $1
          AND u.posting_suspended_at IS NULL
          AND EXISTS (SELECT 1 FROM public_tasks t WHERE t.created_by = u.id)
          AND NOT EXISTS (SELECT 1 FROM user_blocks b
                           WHERE (b.blocker_id = $2 AND b.blocked_id = u.id)
                              OR (b.blocker_id = u.id AND b.blocked_id = $2))`,
      [id, viewer],
    )
    if (rows.length === 0) return res.status(404).json(NOT_FOUND)
    const org = rows[0]

    const [tasks, stats, follow] = await Promise.all([
      // Same exclusions as GET /public-tasks: open, not past (one day of
      // slack for time zones). Suspension and blocks were checked above.
      query(
        `SELECT t.id, t.title, t.location, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.category,
                t.slots_total, t.is_online,
                ${SPOTS_USED_SQL('t.id')} AS slots_filled
           FROM public_tasks t
          WHERE t.created_by = $1 AND t.status = 'open' AND t.date >= CURRENT_DATE - 1
          ORDER BY t.date ASC, t.created_at DESC
          LIMIT $2`,
        [id, MAX_TASKS],
      ),
      // Rating: the same average Opportunities shows, only from 3 ratings.
      // Hours: approved logs linked to any of their tasks, as one total.
      query(
        `SELECT (SELECT COUNT(*)::int FROM task_ratings r JOIN public_tasks rt ON rt.id = r.task_id
                  WHERE rt.created_by = $1) AS rating_count,
                (SELECT ROUND(AVG(r.stars)::numeric, 1)::float8 FROM task_ratings r JOIN public_tasks rt ON rt.id = r.task_id
                  WHERE rt.created_by = $1) AS rating_avg,
                (SELECT COALESCE(SUM(l.hours), 0)::float8 FROM logs l JOIN public_tasks lt ON lt.id = l.task_id
                  WHERE lt.created_by = $1 AND l.verification_status = 'approved') AS hours_given`,
        [id],
      ),
      query('SELECT 1 FROM organizer_follows WHERE user_id = $1 AND organizer_id = $2', [viewer, id]),
    ])
    const s = stats.rows[0]
    const enough = s.rating_count >= 3
    return res.json({
      organizer: {
        id: org.id,
        name: org.name,
        ...profileOut(org),
        rating: enough ? { average: s.rating_avg, count: s.rating_count } : null,
        hoursGiven: Math.round(Number(s.hours_given) * 10) / 10,
        isMe: org.id === viewer,
        iFollow: follow.rows.length > 0,
      },
      tasks: tasks.rows,
    })
  } catch (error) {
    console.error('organizer profile failed:', error)
    return res.status(500).json({ error: 'Could not load this organizer.' })
  }
})

export default router
