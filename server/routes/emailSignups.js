import express from 'express'
import rateLimit from 'express-rate-limit'
import crypto from 'crypto'
import { query, hasDatabase, getPool } from '../db.js'
import { uid, generateToken } from '../ids.js'
import { verifyTurnstile } from '../turnstile.js'
import { sendEmailSignupConfirm, hasEmail } from '../email.js'
import { requestLang, emailDate } from '../emailStrings.js'
import { spotsUsed } from '../spots.js'
import { newBadgeCode } from '../badge.js'
import { promoteFromWaitlist } from './school.js'

// Signing up for an opportunity without an account (the owner's request,
// Nov 27), from the public /volunteer-opportunities page:
//  - POST /api/email-signups/:taskId { name, email, over13: true } (Turnstile)
//    emails a one-time link. Nothing is held yet, and the answer is the same
//    whether or not the address already signed up, so it can't be used to
//    check who's coming.
//  - The link opens /signup/<token> on the website: GET /t/:token shows the
//    event, POST /t/:token/confirm holds the spot (under the task's row lock,
//    like every sign-up) and makes the volunteer badge (QR → /badge/<code>).
//    A mail scanner opening the link changes nothing.
//  - POST /t/:token/cancel gives the spot back (and moves the waitlist up).
// 13 and older only (a younger child makes an account so a parent approves).
// Only on tasks without shifts, a waiver, an age limit over 13 or a parent
// requirement; those still need an account. Confirmed ones count as spots
// (SPOTS_USED_SQL in server/spots.js) and show on the organizer's My Tasks.
// Rows are deleted 30 days after the event, on the next sign-up.

const router = express.Router()
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex')
const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/
const KEEP_DAYS = 30

const requireDb = (_req, res, next) => (hasDatabase() ? next() : res.status(503).json({ error: 'Sign-ups are unavailable right now.' }))
// Public and unauthenticated: keyed on the address on purpose.
const submitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false })
const linkLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false })

function siteUrl() {
  return (process.env.FRONTEND_URL || 'https://volunteer-track-two.vercel.app').split(',')[0].trim().replace(/\/$/, '')
}

const TASK_COLS = `t.id, t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location, t.is_online, t.creator_name,
  t.status, t.slots_total, t.min_age, t.young_need_parent, t.waiver_text, t.date < CURRENT_DATE - 1 AS past,
  EXISTS (SELECT 1 FROM public_task_shifts sh WHERE sh.task_id = t.id) AS has_shifts,
  (SELECT posting_suspended_at IS NOT NULL FROM users WHERE id = t.created_by) AS host_suspended`

/** Why a task can't take a sign-up without an account, or null. */
export function emailSignupProblem(t) {
  if (!t) return 'This opportunity isn’t available.'
  if (t.status === 'cancelled') return 'This event was cancelled.'
  if (t.status !== 'open' || t.past || t.host_suspended) return 'This opportunity isn’t available.'
  if (t.has_shifts || t.waiver_text || (t.min_age != null && Number(t.min_age) > 13) || t.young_need_parent) {
    return 'This opportunity needs a free account to sign up.'
  }
  return null
}

router.post('/:taskId', submitLimiter, requireDb, verifyTurnstile(), async (req, res) => {
  const name = String(req.body?.name || '').replace(/\s+/g, ' ').trim()
  const email = String(req.body?.email || '').trim().toLowerCase()
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Enter your name.' })
  if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' })
  if (req.body?.over13 !== true) return res.status(400).json({ error: 'Under 13? Ask a parent to help you make a free account instead.', needsAccount: true })
  if (!hasEmail() && process.env.NODE_ENV === 'production') return res.status(503).json({ error: 'Sign-ups are unavailable right now.' })
  try {
    // Personal data kept only as long as it's useful.
    query(`DELETE FROM public_task_email_signups es USING public_tasks t
            WHERE t.id = es.task_id AND t.date < CURRENT_DATE - ${KEEP_DAYS}`).catch(() => {})

    const { rows } = await query(`SELECT ${TASK_COLS} FROM public_tasks t WHERE t.id = $1`, [String(req.params.taskId)])
    const task = rows[0]
    const problem = emailSignupProblem(task)
    if (problem) return res.status(400).json({ error: problem, needsAccount: problem.includes('account') })
    if (task.slots_total && (await spotsUsed({ query }, task.id)) >= Number(task.slots_total)) {
      return res.status(409).json({ error: 'This opportunity is full.' })
    }

    const token = generateToken()
    // One row per address per task. A new request sends a new link (at most
    // once a minute); an address already confirmed just gets its link again.
    const { rows: saved } = await query(
      `INSERT INTO public_task_email_signups (id, task_id, name, email, language, token_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (task_id, email) DO UPDATE
         SET token_hash = EXCLUDED.token_hash, sent_at = now(), language = EXCLUDED.language,
             name = CASE WHEN public_task_email_signups.confirmed_at IS NULL THEN EXCLUDED.name ELSE public_task_email_signups.name END,
             cancelled_at = NULL, confirmed_at = CASE WHEN public_task_email_signups.cancelled_at IS NOT NULL THEN NULL ELSE public_task_email_signups.confirmed_at END
         WHERE public_task_email_signups.sent_at < now() - interval '60 seconds'
       RETURNING id`,
      [uid('esu'), task.id, name, email, requestLang(req), hashToken(token)],
    )
    // Same answer either way, so this can't reveal who signed up.
    if (!saved[0]) return res.json({ ok: true })
    const link = `${siteUrl()}/signup/${token}`
    const lang = requestLang(req)
    if (!hasEmail()) {
      console.log(`[dev] Sign-up link for ${email.replace(/(.).*@/, '$1***@')}: ${link}`)
      return res.json({ ok: true })
    }
    if (email.endsWith('@test.com')) return res.json({ ok: true })
    const sent = await sendEmailSignupConfirm({
      to: email, language: lang, title: task.title,
      date: emailDate(lang, new Date(`${task.date}T00:00:00Z`), true), link,
    })
    if (!sent?.sent) {
      // Let them try again straight away rather than wait out the minute.
      await query("UPDATE public_task_email_signups SET sent_at = now() - interval '2 minutes' WHERE id = $1", [saved[0].id])
      return res.status(502).json({ error: 'We could not send the email. Try again in a moment.' })
    }
    return res.json({ ok: true })
  } catch (error) {
    console.error('email sign-up failed:', error)
    return res.status(500).json({ error: 'Could not sign you up. Try again.' })
  }
})

async function byToken(token) {
  if (!TOKEN_RE.test(token)) return null
  const { rows } = await query(
    `SELECT es.id AS signup_id, es.task_id, es.name, es.confirmed_at, es.cancelled_at, es.badge_code, ${TASK_COLS}
       FROM public_task_email_signups es JOIN public_tasks t ON t.id = es.task_id
      WHERE es.token_hash = $1`,
    [hashToken(token)],
  )
  return rows[0] || null
}

function shape(r) {
  const held = Boolean(r.confirmed_at && !r.cancelled_at)
  return {
    name: r.name,
    confirmed: held,
    cancelled: Boolean(r.cancelled_at),
    event: {
      title: r.title, date: r.date, time: r.time, organizer: r.creator_name,
      location: r.is_online ? null : r.location, online: Boolean(r.is_online),
      cancelled: r.status === 'cancelled', over: Boolean(r.past),
    },
    badge: held && r.status !== 'cancelled' && !r.past && r.badge_code
      ? { code: r.badge_code, url: `${siteUrl()}/badge/${r.badge_code}` }
      : null,
  }
}

router.get('/t/:token', linkLimiter, requireDb, async (req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    const r = await byToken(String(req.params.token))
    if (!r) return res.status(404).json({ error: 'This link doesn’t work. Sign up again from the opportunities page.' })
    return res.json(shape(r))
  } catch (error) {
    console.error('email sign-up read failed:', error)
    return res.status(500).json({ error: 'Could not load your sign-up.' })
  }
})

router.post('/t/:token/confirm', linkLimiter, requireDb, async (req, res) => {
  const token = String(req.params.token)
  if (!TOKEN_RE.test(token)) return res.status(404).json({ error: 'This link doesn’t work.' })
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT es.id, es.task_id, es.confirmed_at, es.cancelled_at FROM public_task_email_signups es WHERE es.token_hash = $1`,
      [hashToken(token)],
    )
    const es = rows[0]
    if (!es) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'This link doesn’t work.' }) }
    // The same row lock as every sign-up, so two can't take the last spot.
    const { rows: tasks } = await client.query(`SELECT ${TASK_COLS} FROM public_tasks t WHERE t.id = $1 FOR UPDATE OF t`, [es.task_id])
    const problem = emailSignupProblem(tasks[0])
    if (problem) { await client.query('ROLLBACK'); return res.status(400).json({ error: problem }) }
    if (!(es.confirmed_at && !es.cancelled_at)) {
      const used = await spotsUsed(client, es.task_id)
      if (tasks[0].slots_total && used >= Number(tasks[0].slots_total)) {
        await client.query('ROLLBACK')
        return res.status(409).json({ error: 'Sorry, this opportunity filled up.' })
      }
      await client.query(
        `UPDATE public_task_email_signups SET confirmed_at = now(), cancelled_at = NULL,
                badge_code = COALESCE(badge_code, $2) WHERE id = $1`,
        [es.id, newBadgeCode()],
      )
    }
    await client.query('COMMIT')
    return res.json(shape(await byToken(token)))
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('email sign-up confirm failed:', error)
    return res.status(500).json({ error: 'Could not confirm your spot.' })
  } finally {
    client.release()
  }
})

router.post('/t/:token/cancel', linkLimiter, requireDb, async (req, res) => {
  try {
    const r = await byToken(String(req.params.token))
    if (!r) return res.status(404).json({ error: 'This link doesn’t work.' })
    const { rowCount } = await query(
      'UPDATE public_task_email_signups SET cancelled_at = now() WHERE id = $1 AND cancelled_at IS NULL AND confirmed_at IS NOT NULL',
      [r.signup_id],
    )
    // A spot came free: the earliest on the waitlist moves up.
    if (rowCount) promoteFromWaitlist(r.task_id).catch((e) => console.error('waitlist after cancel failed:', e.message))
    return res.json(shape(await byToken(String(req.params.token))))
  } catch (error) {
    console.error('email sign-up cancel failed:', error)
    return res.status(500).json({ error: 'Could not cancel your spot.' })
  }
})

export default router
