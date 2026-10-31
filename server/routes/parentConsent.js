import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { escapeHtml } from '../html.js'
import { sendWelcomeEmail } from '../email.js'

// Parental approval for an under-13 sign-up. POST /api/auth/register creates
// the account locked and emails the parent a link here; the 64-hex token in
// that link is the credential (the parent has no account). Two-step on
// purpose, like the digest unsubscribe in parent.js: the GET only renders the
// choice, so an email-security scanner or link prefetch can never approve a
// child's account — the POST does the state change. Renders its own pages;
// there is no frontend route for this.

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
})

const STYLE = 'font-family:system-ui,-apple-system,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem;line-height:1.5'
const BUTTON = 'font-size:1rem;padding:0.6rem 1.1rem;margin:0 0.5rem 0.5rem 0;cursor:pointer'

function page(bodyHtml) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>VolunTrack</title><body style="${STYLE}">${bodyHtml}</body></html>`
}

function message(text) {
  return page(`<p>${escapeHtml(text)}</p>`)
}

function validToken(token) {
  return /^[a-f0-9]{64}$/.test(token)
}

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).type('html').send(message('This service is temporarily unavailable.'))
  return next()
}

router.get('/:token', limiter, requireDb, async (req, res) => {
  const token = String(req.params.token || '')
  if (!validToken(token)) return res.status(400).type('html').send(message('This link is not valid.'))
  try {
    const { rows } = await query(
      'SELECT name, email, parental_consent_status FROM users WHERE parent_consent_token = $1',
      [token],
    )
    const child = rows[0]
    if (!child) {
      return res.status(404).type('html').send(message('This link is invalid or has expired. If the request was declined or left unanswered for 14 days, the account was deleted.'))
    }
    if (child.parental_consent_status === 'approved') {
      return res.status(200).type('html').send(message(`You have already approved ${child.name}'s VolunTrack account.`))
    }
    const action = `/api/auth/parent-consent/${escapeHtml(token)}`
    return res.status(200).type('html').send(page(
      `<h1 style="font-size:1.3rem">Approve a VolunTrack account?</h1>
<p><strong>${escapeHtml(child.name)}</strong> (${escapeHtml(child.email)}) signed up for VolunTrack and told us they are under 13. They named you as their parent or guardian.</p>
<p>If you approve, your child can sign in and log volunteer hours. VolunTrack stores the name, email, grade and hours they enter, and shares those hours with their school if they link one. No ads, and nothing is sold.</p>
<p>If you decline, the account and everything in it is deleted now.</p>
<form method="post" action="${action}/approve" style="display:inline"><button type="submit" style="${BUTTON}">Approve</button></form>
<form method="post" action="${action}/decline" style="display:inline"><button type="submit" style="${BUTTON}">Decline and delete</button></form>`,
    ))
  } catch (error) {
    console.error('parent consent (GET) failed:', error)
    return res.status(500).type('html').send(message('Something went wrong. Please try again later.'))
  }
})

// Idempotent: a second click on Approve still matches the row.
router.post('/:token/approve', limiter, requireDb, async (req, res) => {
  const token = String(req.params.token || '')
  if (!validToken(token)) return res.status(400).type('html').send(message('This link is not valid.'))
  try {
    const { rows } = await query(
      `WITH prev AS (
         SELECT id, parental_consent_status AS was FROM users WHERE parent_consent_token = $1 FOR UPDATE
       )
       UPDATE users u
          SET parental_consent_status = 'approved', parental_consent_at = COALESCE(u.parental_consent_at, now())
         FROM prev
        WHERE u.id = prev.id
        RETURNING u.name, u.email, u.language, prev.was`,
      [token],
    )
    const child = rows[0]
    if (!child) return res.status(404).type('html').send(message('This link is invalid or has expired.'))
    // The welcome email was held back at sign-up; it goes out once, on the
    // approval that actually unlocked the account.
    if (child.was === 'pending') {
      sendWelcomeEmail({ to: child.email, name: child.name, role: 'student', language: child.language }).catch((e) => console.error('welcome email failed:', e.message))
    }
    return res.status(200).type('html').send(message(`Thank you. ${child.name} can now sign in to VolunTrack.`))
  } catch (error) {
    console.error('parent consent (approve) failed:', error)
    return res.status(500).type('html').send(message('Something went wrong. Please try again later.'))
  }
})

// Declining deletes the account outright — only one still waiting, so a link
// kept from an old email can never delete an account a parent later approved.
router.post('/:token/decline', limiter, requireDb, async (req, res) => {
  const token = String(req.params.token || '')
  if (!validToken(token)) return res.status(400).type('html').send(message('This link is not valid.'))
  try {
    const { rowCount } = await query(
      `DELETE FROM users WHERE parent_consent_token = $1 AND parental_consent_status = 'pending'`,
      [token],
    )
    if (rowCount === 0) {
      return res.status(404).type('html').send(message('This link is invalid, has expired, or the account was already approved. To remove an approved account, contact us.'))
    }
    return res.status(200).type('html').send(message('The request was declined and the account has been deleted.'))
  } catch (error) {
    console.error('parent consent (decline) failed:', error)
    return res.status(500).type('html').send(message('Something went wrong. Please try again later.'))
  }
})

export default router
