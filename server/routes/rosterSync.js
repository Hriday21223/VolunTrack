// Roster sync routes (#608), mounted at /api/roster-sync. The work is in
// server/rosterSync.js; inviting is inviteStudentsToSchool() from school.js.
import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { recordAudit, AUDIT } from '../audit.js'
import { requireCronKey, cronLimiter } from '../cronAuth.js'
import { schoolIsActive } from '../plans.js'
import { inviteStudentsToSchool } from './school.js'
import {
  googleConfigured, cleverConfigured, googleAuthUrl, googleCallback, googleCourses, cleverSections, syncSection, RosterError,
} from '../rosterSync.js'

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})
const syncLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many roster syncs. Please try again later.' },
})

const MAX_SECTIONS_PER_SYNC = 10
const PROVIDERS = ['google', 'clever']
const ADVISERS = ['school', 'school_staff']

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

function frontendUrl() {
  const first = (process.env.FRONTEND_URL || '').split(',').map((s) => s.trim()).find(Boolean)
  return (first || 'https://volunteer-track-two.vercel.app').replace(/\/$/, '')
}

// The adviser's school, active (paid, or a free club), or an error response.
async function adviserSchool(req, res) {
  const { rows } = await query(
    'SELECT u.email, u.school_id, s.plan, s.payment_status FROM users u JOIN schools s ON s.id = u.school_id WHERE u.id = $1',
    [req.auth.sub],
  )
  const me = rows[0]
  if (!me) { res.status(400).json({ error: 'No school linked to your account.' }); return null }
  if (!schoolIsActive(me)) { res.status(403).json({ error: 'This school has not completed payment yet. Submissions are paused until payment is verified.' }); return null }
  return me
}

const fail = (res, error, what) => {
  if (error instanceof RosterError) return res.status(error.status).json({ error: error.message })
  console.error(`roster sync ${what} failed:`, error)
  return res.status(500).json({ error: 'Could not reach the roster service. Try again in a minute.' })
}

// GET /status → what can be used, whether Google is connected, and the saved classes.
router.get('/status', limiter, requireDb, requireAuth(...ADVISERS), async (req, res) => {
  try {
    const { rows: conn } = await query("SELECT 1 FROM roster_connections WHERE user_id = $1 AND provider = 'google'", [req.auth.sub])
    const { rows: me } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    const { rows: sections } = me[0]?.school_id ? await query(
      `SELECT provider, section_id AS id, name, student_count, last_synced_at
         FROM roster_sync_sections WHERE school_id = $1 ORDER BY provider, name`,
      [me[0].school_id],
    ) : { rows: [] }
    return res.json({
      google: { available: googleConfigured(), connected: conn.length > 0 },
      clever: { available: cleverConfigured() },
      sections,
    })
  } catch (error) { return fail(res, error, 'status') }
})

// POST /google/start → { url }: the Google consent page for this adviser.
router.post('/google/start', limiter, requireDb, requireAuth(...ADVISERS), async (req, res) => {
  if (!googleConfigured()) return res.status(503).json({ error: 'Google Classroom isn’t set up on this server.' })
  try {
    if (!(await adviserSchool(req, res))) return
    return res.json({ url: await googleAuthUrl(req.auth.sub) })
  } catch (error) { return fail(res, error, 'start') }
})

// GET /google/callback — Google sends the adviser here; we send them back to Students → Add.
router.get('/google/callback', limiter, requireDb, async (req, res) => {
  const back = (q) => res.redirect(`${frontendUrl()}/school/dashboard/students/add?${q}`)
  if (req.query.error) return back('roster=cancelled')
  try {
    const userId = await googleCallback({ code: req.query.code, state: req.query.state })
    recordAudit({ auth: { sub: userId } }, { action: AUDIT.ROSTER_CONNECTED, objectType: 'roster_connection', objectId: 'google' })
    return back('roster=google')
  } catch (error) {
    if (!(error instanceof RosterError)) console.error('roster sync callback failed:', error)
    return back(`roster=error&msg=${encodeURIComponent(error instanceof RosterError ? error.message : 'Could not connect Google Classroom.')}`)
  }
})

// DELETE /google — forget the connection (and its saved token).
router.delete('/google', limiter, requireDb, requireAuth(...ADVISERS), async (req, res) => {
  try {
    await query("DELETE FROM roster_connections WHERE user_id = $1 AND provider = 'google'", [req.auth.sub])
    return res.json({ ok: true })
  } catch (error) { return fail(res, error, 'disconnect') }
})

router.get('/google/courses', limiter, requireDb, requireAuth(...ADVISERS), async (req, res) => {
  if (!googleConfigured()) return res.status(503).json({ error: 'Google Classroom isn’t set up on this server.' })
  try {
    return res.json({ courses: await googleCourses(req.auth.sub) })
  } catch (error) { return fail(res, error, 'courses') }
})

router.get('/clever/sections', limiter, requireDb, requireAuth(...ADVISERS), async (req, res) => {
  if (!cleverConfigured()) return res.status(503).json({ error: 'Clever isn’t set up on this server.' })
  try {
    const me = await adviserSchool(req, res)
    if (!me) return
    return res.json({ sections: await cleverSections(me.email) })
  } catch (error) { return fail(res, error, 'sections') }
})

// POST /sync { provider, sections: [{ id, name }] } — invite each class's students.
router.post('/sync', syncLimiter, requireDb, requireAuth(...ADVISERS), async (req, res) => {
  const provider = req.body?.provider
  const sections = Array.isArray(req.body?.sections) ? req.body.sections : []
  if (!PROVIDERS.includes(provider)) return res.status(400).json({ error: 'Pick Google Classroom or Clever.' })
  if (sections.length === 0) return res.status(400).json({ error: 'Pick at least one class.' })
  if (sections.length > MAX_SECTIONS_PER_SYNC) return res.status(400).json({ error: `Pick up to ${MAX_SECTIONS_PER_SYNC} classes at a time.` })
  if (provider === 'google' && !googleConfigured()) return res.status(503).json({ error: 'Google Classroom isn’t set up on this server.' })
  if (provider === 'clever' && !cleverConfigured()) return res.status(503).json({ error: 'Clever isn’t set up on this server.' })
  try {
    const me = await adviserSchool(req, res)
    if (!me) return
    const results = []
    for (const s of sections) {
      if (!s || typeof s.id !== 'string' || !s.id || s.id.length > 100) continue
      results.push(await syncSection({
        userId: req.auth.sub, schoolId: me.school_id, provider, sectionId: s.id, sectionName: String(s.name || '').slice(0, 200), adviserEmail: me.email, invite: inviteStudentsToSchool,
      }))
    }
    recordAudit(req, {
      action: AUDIT.ROSTER_SYNCED, schoolId: me.school_id, objectType: 'roster_sync', objectId: provider,
      meta: { sections: results.length, found: results.reduce((n, r) => n + r.found, 0) },
    })
    return res.json({ ok: true, results })
  } catch (error) { return fail(res, error, 'sync') }
})

// POST /internal/run { dryRun? } — nightly: re-sync every saved class whose
// adviser is still connected (Google) or still at the school (Clever).
router.post('/internal/run', cronLimiter(), requireCronKey, requireDb, async (req, res) => {
  const dryRun = req.body?.dryRun === true
  try {
    const { rows } = await query(
      `SELECT r.school_id, r.provider, r.section_id, r.name, r.user_id, u.email
         FROM roster_sync_sections r
         JOIN users u ON u.id = r.user_id AND u.school_id = r.school_id AND u.role IN ('school', 'school_staff')
         JOIN schools s ON s.id = r.school_id AND (s.plan = 'club' OR s.payment_status = 'paid')
        WHERE r.last_synced_at < now() - interval '20 hours'
          AND (r.provider = 'clever' OR EXISTS (SELECT 1 FROM roster_connections c WHERE c.user_id = r.user_id AND c.provider = 'google'))
        ORDER BY r.last_synced_at
        LIMIT 200`,
    )
    const runnable = rows.filter((r) => (r.provider === 'google' ? googleConfigured() : cleverConfigured()))
    if (dryRun) return res.json({ ok: true, dryRun, due: runnable.length })
    let synced = 0
    let failed = 0
    for (const r of runnable) {
      try {
        await syncSection({ userId: r.user_id, schoolId: r.school_id, provider: r.provider, sectionId: r.section_id, sectionName: r.name, adviserEmail: r.email, invite: inviteStudentsToSchool })
        synced += 1
      } catch (error) {
        failed += 1
        console.error('nightly roster sync failed:', r.provider, r.section_id, error.message)
      }
    }
    return res.json({ ok: true, due: runnable.length, synced, failed })
  } catch (error) {
    console.error('roster sync run failed:', error)
    return res.status(500).json({ error: 'Roster sync failed.' })
  }
})

export default router
