import express from 'express'
import rateLimit from 'express-rate-limit'
import { perPersonKey } from '../rateKey.js'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { generatePortfolioSlug } from '../ids.js'
import { yearShareSummary, firstNameOf } from '../yearShare.js'

// Year in review share links (#1005). The Share button on Year in review
// makes a link (/y/<slug>) instead of sending an image. One link per student
// per year; the slug is the only key to it, so it is random and unguessable,
// and turning it off deletes the row, so the page 404s at once. A link works
// for LINK_DAYS (30) from when it was made; after that the page 404s too, and
// pressing Share again makes a new link with a new address.
//
// The public page shows totals only, worked out from the database
// (server/yearShare.js): hours, sessions, approved hours, top causes, how many
// places, busiest month, month bars, longest weekly streak. Never a place
// name, activity, note, school, or anything about a single entry. The name is
// the first name only, and only if the student ticked "Show my first name".
// Under-13s can't make one (same rule as the portfolio).

const router = express.Router()

const signedInLimiter = rateLimit({
  keyGenerator: perPersonKey,
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

const SLUG_RE = /^[A-Za-z0-9]{12}$/
const UNDER_13_ERROR = 'Share links are for students 13 and older.'
export const LINK_DAYS = 30

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

function readYear(raw) {
  const year = Number(raw)
  const now = new Date().getFullYear()
  return Number.isInteger(year) && year >= 2000 && year <= now + 1 ? year : null
}

async function loadLogs(userId, year) {
  const { rows } = await query(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, hours, category, verification_status,
            COALESCE(NULLIF(org_name, ''), location) AS place
       FROM logs
      WHERE user_id = $1 AND date >= make_date($2, 1, 1) AND date < make_date($2 + 1, 1, 1)`,
    [userId, year],
  )
  return rows
}

// The student's own links, so the page can show "Link is on" for a year.
router.get('/mine', signedInLimiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    // Expired links are gone for good; clear them out here.
    await query('DELETE FROM year_shares WHERE user_id = $1 AND expires_at <= now()', [req.auth.sub])
    const { rows } = await query(
      'SELECT year, slug, show_name, expires_at FROM year_shares WHERE user_id = $1 ORDER BY year DESC',
      [req.auth.sub],
    )
    res.json({ links: rows.map((r) => ({ year: r.year, slug: r.slug, showName: r.show_name, expiresAt: r.expires_at })) })
  } catch (error) {
    console.error('year-share mine failed:', error.message)
    res.status(500).json({ error: 'Could not load your share links.' })
  }
})

// Make (or update) the link for a year. A link still in its 30 days keeps
// its address and end date, so one already sent keeps working; only showName
// changes. An expired one is replaced by a new address and a fresh 30 days.
router.put('/mine/:year', signedInLimiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const year = readYear(req.params.year)
    if (!year) return res.status(400).json({ error: 'Pick a valid year.' })
    const showName = req.body?.showName === true

    const { rows: users } = await query('SELECT under_13 FROM users WHERE id = $1', [req.auth.sub])
    if (!users[0]) return res.status(404).json({ error: 'Account not found.' })
    if (users[0].under_13 === true) return res.status(403).json({ error: UNDER_13_ERROR, code: 'under_13' })

    const summary = yearShareSummary(await loadLogs(req.auth.sub, year), year)
    if (!summary) {
      return res.status(400).json({ error: 'Your hours for this year haven’t reached your account yet. Try again in a minute.', code: 'no_hours' })
    }

    // A clash on a fresh slug is astronomically unlikely; retry a couple of times anyway.
    await query('DELETE FROM year_shares WHERE user_id = $1 AND year = $2 AND expires_at <= now()', [req.auth.sub, year])
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { rows } = await query(
          `INSERT INTO year_shares (user_id, year, slug, show_name, expires_at)
           VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))
           ON CONFLICT (user_id, year) DO UPDATE SET show_name = EXCLUDED.show_name, updated_at = now()
           RETURNING slug, show_name, expires_at`,
          [req.auth.sub, year, generatePortfolioSlug(), showName, LINK_DAYS],
        )
        return res.json({ year, slug: rows[0].slug, showName: rows[0].show_name, expiresAt: rows[0].expires_at })
      } catch (error) {
        if (error.code !== '23505' || attempt === 2) throw error
      }
    }
  } catch (error) {
    console.error('year-share save failed:', error.message)
    res.status(500).json({ error: 'Could not make your share link.' })
  }
})

// Turn the link off: the row goes, so the page stops working at once.
router.delete('/mine/:year', signedInLimiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const year = readYear(req.params.year)
    if (!year) return res.status(400).json({ error: 'Pick a valid year.' })
    await query('DELETE FROM year_shares WHERE user_id = $1 AND year = $2', [req.auth.sub, year])
    res.json({ ok: true })
  } catch (error) {
    console.error('year-share delete failed:', error.message)
    res.status(500).json({ error: 'Could not turn off your share link.' })
  }
})

// The public page's data. No sign-in; the slug is the key.
router.get('/public/:slug', publicLimiter, requireDb, async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.set('X-Robots-Tag', 'noindex, nofollow')
  const notFound = () => res.status(404).json({ error: 'This link isn’t working anymore.' })
  try {
    const slug = String(req.params.slug || '')
    if (!SLUG_RE.test(slug)) return notFound()
    const { rows } = await query(
      `SELECT y.user_id, y.year, y.show_name, u.name
         FROM year_shares y
         JOIN users u ON u.id = y.user_id
        WHERE y.slug = $1 AND y.expires_at > now() AND u.role = 'student'
          AND u.under_13 IS NOT TRUE
          AND u.parental_consent_status IS DISTINCT FROM 'pending'`,
      [slug],
    )
    const share = rows[0]
    if (!share) return notFound()
    const summary = yearShareSummary(await loadLogs(share.user_id, share.year), share.year)
    if (!summary) return notFound()
    res.json({ name: share.show_name ? firstNameOf(share.name) || null : null, ...summary })
  } catch (error) {
    console.error('year-share public failed:', error.message)
    res.status(500).json({ error: 'Could not load this page.' })
  }
})

export default router
