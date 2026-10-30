import express from 'express'
import rateLimit from 'express-rate-limit'
import validator from 'validator'
import { createHash } from 'crypto'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { uid, generateToken } from '../ids.js'
import { sendEmail, emailFooterHtml } from '../email.js'
import { escapeHtml } from '../html.js'
import { notify } from '../notifications.js'

// References (#593): a student asks someone who saw them volunteer — a
// supervisor, an organizer — for a short written reference. The writer gets a
// one-time email link (/reference/<token>), needs no account, sees the
// student's name, their note and the hours they logged at that place, and
// writes the reference or declines. The student is told, can read it, and can
// show it on their public portfolio only if the writer agreed to that.
//
// Only a hash of the link's token is stored, like certificate_sign_requests.
// Requests are rate-limited per student so this can't be used to email
// strangers in bulk, and the writer's address is never shown to anyone else.

const router = express.Router()

const PENDING_MAX = 5
const PER_DAY_MAX = 10
const KEEP_OPEN_DAYS = 30
const TEXT_MIN = 40
const TEXT_MAX = 3000
const SHORT_MAX = 120
const MESSAGE_MAX = 600

const studentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})
const writerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// Two spellings of one place match when case, punctuation and a leading "The"
// are ignored (the same rule as approved places, #591).
const placeKey = (name) => String(name ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '')

const hashToken = (t) => createHash('sha256').update(String(t)).digest('hex')
const site = () => String(process.env.FRONTEND_URL || 'https://volunteer-track-two.vercel.app').split(',')[0].trim().replace(/\/$/, '')
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max)
const oneLine = (v, max) => clean(v, max).replace(/\s+/g, ' ')

function referenceJson(r) {
  return {
    id: r.id,
    writerName: r.referee_name,
    writerEmail: r.referee_email,
    organization: r.organization,
    status: r.status,
    askedAt: r.created_at,
    expired: r.status === 'pending' && new Date(r.expires_at) < new Date(),
    ...(r.status === 'written'
      ? { text: r.text, writerTitle: r.referee_title, relationship: r.relationship, writtenAt: r.written_at, shareable: r.public_ok, onPortfolio: r.on_portfolio }
      : {}),
  }
}

// --- The student's side ------------------------------------------------------

router.get('/mine', studentLimiter, requireDb, requireAuth('student', 'volunteer'), async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM reference_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.auth.sub],
    )
    return res.json({ references: rows.map(referenceJson) })
  } catch (error) {
    console.error('references list failed:', error)
    return res.status(500).json({ error: 'Could not load your references.' })
  }
})

router.post('/', studentLimiter, requireDb, requireAuth('student', 'volunteer'), async (req, res) => {
  const name = oneLine(req.body?.name, SHORT_MAX)
  const email = String(req.body?.email || '').trim().toLowerCase()
  const organization = oneLine(req.body?.organization, SHORT_MAX)
  const message = clean(req.body?.message, MESSAGE_MAX)
  if (!name) return res.status(400).json({ error: "Add the name of the person you're asking." })
  if (!email || email.length > 254 || !validator.isEmail(email)) return res.status(400).json({ error: 'Add a valid email address for them.' })
  try {
    const { rows: me } = await query('SELECT name, email, parental_consent_status FROM users WHERE id = $1', [req.auth.sub])
    const student = me[0]
    if (!student) return res.status(404).json({ error: 'Account not found.' })
    if (student.parental_consent_status === 'pending') return res.status(403).json({ error: 'A parent needs to approve your account first.' })
    if (String(student.email || '').toLowerCase() === email) return res.status(400).json({ error: 'Ask someone else: a reference has to come from another person.' })
    const { rows: counts } = await query(
      `SELECT COUNT(*) FILTER (WHERE status = 'pending' AND expires_at > now())::int AS pending,
              COUNT(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS today,
              COUNT(*) FILTER (WHERE status = 'pending' AND expires_at > now() AND referee_email = $2)::int AS same
         FROM reference_requests WHERE user_id = $1`,
      [req.auth.sub, email],
    )
    if (counts[0].same) return res.status(409).json({ error: "You've already asked them. Give them some time to answer." })
    if (counts[0].pending >= PENDING_MAX) return res.status(429).json({ error: `You have ${PENDING_MAX} requests waiting. Wait for answers, or cancel one first.` })
    if (counts[0].today >= PER_DAY_MAX) return res.status(429).json({ error: 'That is enough requests for today. Try again tomorrow.' })

    const token = generateToken()
    const id = uid('ref')
    await query(
      `INSERT INTO reference_requests (id, user_id, token_hash, referee_name, referee_email, organization, message, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '${KEEP_OPEN_DAYS} days')`,
      [id, req.auth.sub, hashToken(token), name, email, organization || null, message || null],
    )
    const link = `${site()}/reference/${token}`
    if (!/@test\.com$/i.test(email)) {
      const studentName = student.name || 'A student'
      sendEmail({
        to: email,
        subject: `${studentName} asked you for a volunteer reference`,
        html: `
          <p>Hi ${escapeHtml(name)},</p>
          <p>${escapeHtml(studentName)} volunteered${organization ? ` with ${escapeHtml(organization)}` : ''} and logs their hours on VolunTrack. They asked if you would write a short reference about their volunteering, for things like college and scholarship applications.</p>
          ${message ? `<blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid #2e7d32;color:#444">${escapeHtml(message).replace(/\n/g, '<br>')}</blockquote>` : ''}
          <p><a href="${link}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#2e7d32;color:#ffffff;text-decoration:none;font-weight:600">Write the reference</a></p>
          <p>It takes a few minutes and you don't need an account. You can also decline from the same page. The link works for ${KEEP_OPEN_DAYS} days.</p>
          <p style="font-size:12px;color:#888">If you don't know ${escapeHtml(studentName)}, you can ignore this email.</p>
          ${emailFooterHtml()}
        `,
      }).catch((e) => console.error('reference request email failed:', e.message))
    }
    return res.status(201).json({ ok: true, id })
  } catch (error) {
    console.error('reference request failed:', error)
    return res.status(500).json({ error: 'Could not send the request.' })
  }
})

// Cancel a request, or remove a reference from the account.
router.delete('/:id', studentLimiter, requireDb, requireAuth('student', 'volunteer'), async (req, res) => {
  try {
    const { rowCount } = await query('DELETE FROM reference_requests WHERE id = $1 AND user_id = $2', [req.params.id, req.auth.sub])
    if (!rowCount) return res.status(404).json({ error: 'Not found.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('reference delete failed:', error)
    return res.status(500).json({ error: 'Could not remove it.' })
  }
})

// Show or hide a reference on the public portfolio — only if its writer agreed.
router.patch('/:id', studentLimiter, requireDb, requireAuth('student', 'volunteer'), async (req, res) => {
  if (typeof req.body?.onPortfolio !== 'boolean') return res.status(400).json({ error: 'onPortfolio must be true or false.' })
  try {
    const { rows } = await query(
      `UPDATE reference_requests SET on_portfolio = $3
        WHERE id = $1 AND user_id = $2 AND status = 'written' AND ($3 = false OR public_ok)
        RETURNING *`,
      [req.params.id, req.auth.sub, req.body.onPortfolio],
    )
    if (!rows[0]) return res.status(400).json({ error: "The writer didn't agree to share this one publicly." })
    return res.json({ reference: referenceJson(rows[0]) })
  } catch (error) {
    console.error('reference update failed:', error)
    return res.status(500).json({ error: 'Could not save that.' })
  }
})

// --- The writer's side (no sign-in; the link is the key) -------------------

async function openRequest(token) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(String(token || ''))) return null
  const { rows } = await query(
    `SELECT r.*, u.name AS student_name FROM reference_requests r JOIN users u ON u.id = r.user_id WHERE r.token_hash = $1`,
    [hashToken(token)],
  )
  return rows[0] || null
}

router.get('/write/:token', writerLimiter, requireDb, async (req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    const r = await openRequest(req.params.token)
    if (!r) return res.status(404).json({ error: 'This link is not valid.' })
    const base = { studentName: r.student_name, writerName: r.referee_name, organization: r.organization, message: r.message }
    if (r.status !== 'pending') return res.json({ ...base, closed: r.status })
    if (new Date(r.expires_at) < new Date()) return res.json({ ...base, closed: 'expired' })
    // What the student logged at that place, so the writer has the facts in
    // front of them. Counted entries only (not ones sent back).
    let hours = null
    if (r.organization) {
      const { rows: logs } = await query(
        `SELECT org_name, hours::float8 AS hours, to_char(date, 'YYYY-MM-DD') AS date FROM logs
          WHERE user_id = $1 AND verification_status IS DISTINCT FROM 'rejected' AND org_name IS NOT NULL`,
        [r.user_id],
      )
      const key = placeKey(r.organization)
      const here = logs.filter((l) => placeKey(l.org_name) === key)
      if (here.length) {
        const dates = here.map((l) => l.date).sort()
        hours = {
          total: Math.round(here.reduce((s, l) => s + (Number(l.hours) || 0), 0) * 100) / 100,
          entries: here.length,
          from: dates[0],
          to: dates[dates.length - 1],
        }
      }
    }
    return res.json({ ...base, hours })
  } catch (error) {
    console.error('reference page failed:', error)
    return res.status(500).json({ error: 'Could not load this request.' })
  }
})

router.post('/write/:token', writerLimiter, requireDb, async (req, res) => {
  const decline = req.body?.decline === true
  const text = clean(req.body?.text, TEXT_MAX + 1)
  const writerName = oneLine(req.body?.writerName, SHORT_MAX)
  const writerTitle = oneLine(req.body?.writerTitle, SHORT_MAX)
  const relationship = oneLine(req.body?.relationship, SHORT_MAX)
  if (!decline) {
    if (text.length < TEXT_MIN) return res.status(400).json({ error: `Write at least ${TEXT_MIN} characters.` })
    if (text.length > TEXT_MAX) return res.status(400).json({ error: `Keep it to ${TEXT_MAX} characters.` })
    if (!writerName) return res.status(400).json({ error: 'Add your name, as it should appear on the reference.' })
    if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirm that you saw this student volunteer.' })
  }
  try {
    const r = await openRequest(req.params.token)
    if (!r) return res.status(404).json({ error: 'This link is not valid.' })
    // One answer per link: the WHERE makes a second submit (or a race) a no-op.
    const { rows } = await query(
      decline
        ? `UPDATE reference_requests SET status = 'declined', written_at = now()
            WHERE id = $1 AND status = 'pending' AND expires_at > now() RETURNING id`
        : `UPDATE reference_requests SET status = 'written', written_at = now(), text = $2, referee_name = $3,
                  referee_title = $4, relationship = $5, public_ok = $6
            WHERE id = $1 AND status = 'pending' AND expires_at > now() RETURNING id`,
      decline ? [r.id] : [r.id, text, writerName, writerTitle || null, relationship || null, req.body?.shareable === true],
    )
    if (!rows[0]) return res.status(409).json({ error: 'This link was already used, or it has expired.' })
    notify(r.user_id, decline
      ? { kind: 'reference_declined', title: `${r.referee_name} can't write a reference right now`, body: 'You can ask someone else from Reports.', link: '/reports' }
      : { kind: 'reference_received', title: `${writerName} wrote you a reference`, body: 'Read it on Reports.', link: '/reports' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('reference write failed:', error)
    return res.status(500).json({ error: 'Could not save that.' })
  }
})

/** The references a student chose to show on their portfolio (writer agreed). */
export async function portfolioReferences(userId) {
  const { rows } = await query(
    `SELECT text, referee_name, referee_title, relationship, organization, to_char(written_at, 'YYYY-MM-DD') AS date
       FROM reference_requests
      WHERE user_id = $1 AND status = 'written' AND public_ok AND on_portfolio
      ORDER BY written_at DESC LIMIT 5`,
    [userId],
  )
  return rows.map((r) => ({ text: r.text, writerName: r.referee_name, writerTitle: r.referee_title, relationship: r.relationship, organization: r.organization, date: r.date }))
}

export default router
