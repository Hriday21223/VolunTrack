import express from 'express'
import { hoursBySkill } from '../skills.js'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { generatePortfolioSlug } from '../ids.js'
import { recordAudit, AUDIT } from '../audit.js'
import { portfolioReferences } from './references.js'

// Volunteer portfolio: an opt-in public page (/p/<slug>) a student can put on a
// college application. Off by default. The slug is the only key to it — no
// sign-in — so it is unguessable, "Get a new link" replaces it (the old one
// dies), and turning the page off makes it 404 at once.
//
// What it may show is deliberately narrow: a name (first name + last initial
// unless the student picks their full name), optionally their school, and only
// hours an organizer or supervisor APPROVED — totals, hours by category,
// badges, and activity title + date + hours. Never a location, supervisor,
// note, proof, signature, custom field or organizer contact: the public query
// doesn't even select them.
//
// Students under 13 can't turn it on (users.under_13, the only age data we
// keep — see server/ageRules.js); an account whose age we don't know (NULL,
// e.g. one a school created) may.

const router = express.Router()

const signedInLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

// The public page: a reviewer opens it a few times; this stops anyone
// hammering it or walking slugs.
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

const SLUG_RE = /^[A-Za-z0-9]{12}$/
const MAX_ACTIVITIES = 200
const MAX_PORTFOLIO_SKILLS = 6

export const DEFAULT_OPTIONS = Object.freeze({
  nameDisplay: 'first_initial', // or 'full'
  showSchool: false,
  showCategories: true,
  showBadges: true,
  showActivities: true,
  showSkills: true,
})

const UNDER_13_ERROR = 'Public portfolios are for students 13 and older.'

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// Only known keys with the right type survive; anything missing takes its default.
// `base` is what is saved now, so a request that sends some options keeps the rest.
export function sanitizeOptions(input, base = DEFAULT_OPTIONS) {
  return { ...DEFAULT_OPTIONS, ...pickKnown(base), ...pickKnown(input) }
}

function pickKnown(obj) {
  const out = {}
  if (!obj || typeof obj !== 'object') return out
  if (obj.nameDisplay === 'full' || obj.nameDisplay === 'first_initial') out.nameDisplay = obj.nameDisplay
  for (const key of ['showSchool', 'showCategories', 'showBadges', 'showActivities', 'showSkills']) {
    if (typeof obj[key] === 'boolean') out[key] = obj[key]
  }
  return out
}

// "Maria del Carmen Lopez" → "Maria L."; a one-word name stays as it is.
export function displayName(name, mode) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ')
  if (!clean) return 'A VolunTrack student'
  if (mode === 'full') return clean
  const parts = clean.split(' ')
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

// Badges, worked out here from approved hours only. src/lib/achievements.js
// can't be imported by the server (it pulls in the client's i18n through the
// '@/' alias), so this mirrors its rules by badge id and threshold; the page
// looks the titles up from that file by id. "Community Hero" (reaching your
// goal) is left out: goals are private and aren't part of the portfolio.
export function earnedBadges(logs) {
  const dates = logs.map((l) => l.date).filter(Boolean)
  const totalHours = logs.reduce((s, l) => s + (Number(l.hours) || 0), 0)
  const distinctDays = new Set(dates).size
  const distinctMonths = new Set(dates.map((d) => d.slice(0, 7))).size
  const distinctCategories = new Set(logs.map((l) => l.category).filter(Boolean)).size
  const hasWeekend = dates.some((d) => {
    const [y, m, day] = d.split('-').map(Number)
    const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay()
    return dow === 0 || dow === 6
  })
  const months = new Map()
  for (const l of logs) {
    const key = l.date?.slice(0, 7)
    if (key) months.set(key, (months.get(key) || 0) + (Number(l.hours) || 0))
  }
  const bestMonthHours = months.size ? Math.max(...months.values()) : 0

  const rules = [
    ['first-hour', totalHours >= 1],
    ['streak-3', distinctDays >= 3],
    ['streak-7', distinctDays >= 7],
    ['ten-hours', totalHours >= 10],
    ['fifty-hours', totalHours >= 50],
    ['hundred-hours', totalHours >= 100],
    ['category-explorer', distinctCategories >= 3],
    ['category-master', distinctCategories >= 5],
    ['monthly-five', bestMonthHours >= 5],
    ['weekend-warrior', hasWeekend],
    ['consistent', distinctMonths >= 2],
  ]
  return rules.filter(([, ok]) => ok).map(([id]) => id)
}

function settingsFor(row) {
  if (!row) return { enabled: false, slug: null, path: null, options: { ...DEFAULT_OPTIONS } }
  return {
    enabled: Boolean(row.enabled),
    slug: row.slug,
    path: `/p/${row.slug}`,
    options: sanitizeOptions(row.options),
  }
}

async function loadMe(userId) {
  const { rows } = await query(
    `SELECT u.id, u.role, u.under_13, u.school_id,
            p.slug, p.enabled, p.options
       FROM users u LEFT JOIN portfolios p ON p.user_id = u.id
      WHERE u.id = $1`,
    [userId],
  )
  return rows[0] || null
}

// A slug collision is ~impossible at 71 bits, but the UNIQUE constraint is
// what decides; retry a couple of times rather than 500.
async function withFreshSlug(fn) {
  for (let i = 0; i < 3; i++) {
    try {
      return await fn(generatePortfolioSlug())
    } catch (error) {
      if (error?.code !== '23505' || !String(error.constraint || '').includes('slug')) throw error
    }
  }
  throw new Error('Could not make a unique portfolio link.')
}

function audit(req, me, meta, outcome = 'allowed') {
  recordAudit(req, {
    action: AUDIT.PORTFOLIO_CHANGED,
    outcome,
    subjectUserId: me.id,
    schoolId: me.school_id || null,
    objectType: 'portfolio',
    objectId: me.id,
    meta,
  })
}

router.get('/mine', signedInLimiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const me = await loadMe(req.auth.sub)
    if (!me) return res.status(404).json({ error: 'Account not found.' })
    return res.json({ ...settingsFor(me.slug ? me : null), canEnable: me.under_13 !== true })
  } catch (error) {
    console.error('portfolio settings failed:', error)
    return res.status(500).json({ error: 'Could not load your portfolio settings.' })
  }
})

router.put('/mine', signedInLimiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const me = await loadMe(req.auth.sub)
    if (!me) return res.status(404).json({ error: 'Account not found.' })
    const body = req.body || {}
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be true or false.' })
    }
    const enabled = body.enabled === undefined ? Boolean(me.enabled) : body.enabled
    if (enabled && me.under_13 === true) {
      audit(req, me, { enabled: true, reason: 'under_13' }, 'denied')
      return res.status(403).json({ error: UNDER_13_ERROR, code: 'under_13' })
    }
    const options = sanitizeOptions(body.options, me.slug ? me.options : DEFAULT_OPTIONS)

    let row
    if (me.slug) {
      const { rows } = await query(
        `UPDATE portfolios SET enabled = $2, options = $3::jsonb, updated_at = now()
          WHERE user_id = $1 RETURNING slug, enabled, options`,
        [me.id, enabled, JSON.stringify(options)],
      )
      row = rows[0]
    } else {
      row = await withFreshSlug(async (slug) => {
        const { rows } = await query(
          `INSERT INTO portfolios (user_id, slug, enabled, options)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (user_id) DO UPDATE SET enabled = EXCLUDED.enabled, options = EXCLUDED.options, updated_at = now()
           RETURNING slug, enabled, options`,
          [me.id, slug, enabled, JSON.stringify(options)],
        )
        return rows[0]
      })
    }
    if (Boolean(me.enabled) !== enabled || JSON.stringify(sanitizeOptions(me.options)) !== JSON.stringify(options)) {
      audit(req, me, { enabled, options })
    }
    return res.json({ ...settingsFor(row), canEnable: true })
  } catch (error) {
    console.error('portfolio update failed:', error)
    return res.status(500).json({ error: 'Could not save your portfolio settings.' })
  }
})

router.post('/mine/reset', signedInLimiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const me = await loadMe(req.auth.sub)
    if (!me) return res.status(404).json({ error: 'Account not found.' })
    if (!me.slug) return res.status(404).json({ error: 'Turn on your portfolio first.' })
    const row = await withFreshSlug(async (slug) => {
      const { rows } = await query(
        `UPDATE portfolios SET slug = $2, updated_at = now() WHERE user_id = $1 RETURNING slug, enabled, options`,
        [me.id, slug],
      )
      return rows[0]
    })
    audit(req, me, { reset: true })
    return res.json({ ...settingsFor(row), canEnable: me.under_13 !== true })
  } catch (error) {
    console.error('portfolio reset failed:', error)
    return res.status(500).json({ error: 'Could not make a new link.' })
  }
})

// Public: no sign-in, the slug is the credential. 404 for an unknown slug, a
// portfolio that is off, or one that should never have been on (under 13).
router.get('/:slug', publicLimiter, requireDb, async (req, res) => {
  // Turning the page off must take effect at once, and nobody should index it.
  res.set('Cache-Control', 'no-store')
  res.set('X-Robots-Tag', 'noindex, nofollow')
  const notFound = () => res.status(404).json({ error: 'Portfolio not found.' })
  try {
    const slug = String(req.params.slug || '')
    if (!SLUG_RE.test(slug)) return notFound()
    const { rows } = await query(
      `SELECT u.id, u.name, s.name AS school_name, p.options
         FROM portfolios p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN schools s ON s.id = u.school_id
        WHERE p.slug = $1 AND p.enabled = true AND u.role = 'student'
          AND u.under_13 IS NOT TRUE
          AND u.parental_consent_status IS DISTINCT FROM 'pending'`,
      [slug],
    )
    const owner = rows[0]
    if (!owner) return notFound()
    const options = sanitizeOptions(owner.options)

    // Only these columns of approved entries ever leave this route, and
    // skills only as totals.
    const { rows: logs } = await query(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date, activity, category, hours, skills
         FROM logs
        WHERE user_id = $1 AND verification_status = 'approved'
        ORDER BY date DESC, created_at DESC`,
      [owner.id],
    )

    const totalHours = round2(logs.reduce((s, l) => s + (Number(l.hours) || 0), 0))
    const out = {
      name: displayName(owner.name, options.nameDisplay),
      totalHours,
      entryCount: logs.length,
    }
    if (options.showSchool && owner.school_name) out.school = owner.school_name
    if (options.showCategories) {
      const byCat = new Map()
      for (const l of logs) {
        const key = l.category || 'Other'
        byCat.set(key, (byCat.get(key) || 0) + (Number(l.hours) || 0))
      }
      out.categories = [...byCat.entries()]
        .map(([category, hours]) => ({ category, hours: round2(hours) }))
        .sort((a, b) => b.hours - a.hours || a.category.localeCompare(b.category))
    }
    if (options.showBadges) out.badges = earnedBadges(logs)
    // Top skills by hours (#605), from approved entries only.
    if (options.showSkills) {
      const skills = hoursBySkill(logs).slice(0, MAX_PORTFOLIO_SKILLS).map(({ skill, hours }) => ({ skill, hours }))
      if (skills.length) out.skills = skills
    }
    if (options.showActivities) {
      out.activities = logs.slice(0, MAX_ACTIVITIES).map((l) => ({
        title: String(l.activity || l.category || 'Volunteer activity').slice(0, 140),
        date: l.date,
        hours: round2(l.hours),
      }))
      out.activitiesTruncated = logs.length > MAX_ACTIVITIES
    }
    // References the student chose to show, and whose writers agreed (#593).
    const references = await portfolioReferences(owner.id)
    if (references.length) out.references = references
    return res.json(out)
  } catch (error) {
    console.error('portfolio page failed:', error)
    return res.status(500).json({ error: 'Could not load this portfolio.' })
  }
})

export default router
