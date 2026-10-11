import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { SIGNUP_PLATFORMS } from '../platform.js'

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

// Admin and the @test.com fixture accounts live in the same table as real
// sign-ups; counting them would overstate how many people have joined.
const REAL_USER = `role <> 'admin' AND email NOT ILIKE '%@test.com'`

const SIGNUP_ROLES = ['student', 'volunteer', 'parent', 'school', 'school_staff', 'org']
const WEEKS = 12

// Admin-only: how many people have registered. Counts only — never a name or
// an email — so it reads no student's records and records no audit event.
router.get('/admin/signups', limiter, requireDb, requireAuth('admin'), async (_req, res) => {
  try {
    const [totals, roles, platforms, weekly, active, tenants] = await Promise.all([
      query(
        `SELECT COUNT(*) FILTER (WHERE ${REAL_USER})::int AS total,
                COUNT(*) FILTER (WHERE ${REAL_USER} AND created_at >= now() - interval '7 days')::int AS last7,
                COUNT(*) FILTER (WHERE ${REAL_USER} AND created_at >= now() - interval '30 days')::int AS last30,
                COUNT(*) FILTER (WHERE NOT (${REAL_USER}))::int AS excluded
           FROM users`,
      ),
      query(`SELECT role, COUNT(*)::int AS count FROM users WHERE ${REAL_USER} GROUP BY role`),
      query(`SELECT signup_platform AS platform, COUNT(*)::int AS count FROM users WHERE ${REAL_USER} GROUP BY signup_platform`),
      // generate_series so a week with no sign-ups is a 0, not a missing bar.
      query(
        `SELECT to_char(w.week, 'YYYY-MM-DD') AS week_start, COUNT(u.id)::int AS count
           FROM generate_series(date_trunc('week', now()) - ($1::int - 1) * interval '1 week',
                                date_trunc('week', now()), interval '1 week') AS w(week)
           LEFT JOIN users u
             ON date_trunc('week', u.created_at) = w.week
            AND u.role <> 'admin' AND u.email NOT ILIKE '%@test.com'
          GROUP BY w.week
          ORDER BY w.week`,
        [WEEKS],
      ),
      query(
        `SELECT COUNT(DISTINCT l.user_id)::int AS count
           FROM logs l JOIN users u ON u.id = l.user_id
          WHERE l.created_at >= now() - interval '30 days'
            AND u.role <> 'admin' AND u.email NOT ILIKE '%@test.com'`,
      ),
      query(`SELECT (SELECT COUNT(*) FROM schools)::int AS schools, (SELECT COUNT(*) FROM organizations)::int AS organizations`),
    ])

    const byRole = Object.fromEntries(SIGNUP_ROLES.map((r) => [r, 0]))
    for (const row of roles.rows) if (row.role in byRole) byRole[row.role] = row.count

    // NULL (accounts from before the column existed, students a school added,
    // SSO accounts) and anything unrecognised both land in `unknown`.
    const byPlatform = { ...Object.fromEntries(SIGNUP_PLATFORMS.map((p) => [p, 0])), unknown: 0 }
    for (const row of platforms.rows) {
      byPlatform[SIGNUP_PLATFORMS.includes(row.platform) ? row.platform : 'unknown'] += row.count
    }

    return res.json({
      total: totals.rows[0].total,
      last7Days: totals.rows[0].last7,
      last30Days: totals.rows[0].last30,
      excluded: totals.rows[0].excluded,
      byRole,
      byPlatform,
      weekly: weekly.rows.map((row) => ({ weekStart: row.week_start, count: row.count })),
      activeLast30Days: active.rows[0].count,
      schools: tenants.rows[0].schools,
      organizations: tenants.rows[0].organizations,
    })
  } catch (error) {
    console.error('signup stats failed:', error)
    return res.status(500).json({ error: 'Could not load sign-up stats.' })
  }
})

export default router
