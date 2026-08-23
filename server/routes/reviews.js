import express from 'express'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import { randomInt } from 'crypto'
import { query, hasDatabase } from '../db.js'
import { uid } from '../ids.js'
import { requireAuth } from '../auth.js'
import { sendEmail, emailFooterHtml } from '../email.js'
import { escapeHtml } from '../html.js'

const router = express.Router()

const PIN_TTL_MS = 10 * 60 * 1000
const PIN_MAX_ATTEMPTS = 5

// Public submission endpoint — keep it tighter than the general API limiter.
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

// Tighter than the general limiter — guards PIN request/confirm, which are
// otherwise only rate-limited per-review by consent_pin_attempts.
const consentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// Derives a display status from the raw row for the admin list — the table
// itself only tracks the underlying booleans/timestamps, not a state enum.
function deriveStatus(row, now) {
  if (row.consent_choice === 'no') return 'declined'
  if (row.consent_choice !== 'yes') return 'pending'
  if (!row.approved) return 'awaiting_admin'
  if (row.publish_at && new Date(row.publish_at) > now) return 'scheduled'
  if (row.expires_at && new Date(row.expires_at) <= now) return 'expired'
  return 'live'
}

function generatePin() {
  return String(randomInt(0, 10000)).padStart(4, '0')
}

// Submit a review (public — client-only users with no account can still
// leave one; `authenticate` still runs globally, so req.auth is set when a
// valid token is present and we capture its role/email/id for context).
// Held back from public display (approved = false) until the reviewer
// consents (see /mine/:id/consent) and an admin approves it (see
// PATCH /admin/:id/approve).
router.post('/', submitLimiter, requireDb, async (req, res) => {
  const rating = Number(req.body.rating)
  const comment = req.body.comment ? String(req.body.comment).trim() : null
  // Reviewer opts in to being named; otherwise the site shows "VolunTrack
  // <role>" instead of a real name.
  const name = req.body.name ? String(req.body.name).trim().slice(0, 100) : null

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be an integer from 1 to 5.' })
  }
  if (comment && comment.length > 2000) return res.status(400).json({ error: 'Comment is too long.' })

  try {
    const id = uid('rev')
    await query(
      'INSERT INTO reviews (id, rating, comment, name, email, role, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, rating, comment, name, req.auth?.email || null, req.auth?.role || null, req.auth?.sub || null],
    )
    return res.status(201).json({ ok: true, id })
  } catch (error) {
    console.error('review submit failed:', error)
    return res.status(500).json({ error: 'Could not save review.' })
  }
})

// The caller's own most recent review — powers the dashboard consent
// prompt (only shown while consent_choice is still null) without exposing
// anyone else's review data. Requires an account, since the consent flow
// needs a real email to send the PIN to.
router.get('/mine', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, rating, comment, approved, consent_choice, pending_consent_choice, publish_at, expires_at, created_at
       FROM reviews WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [req.auth.sub],
    )
    return res.json({ review: rows[0] || null })
  } catch (error) {
    console.error('load my review failed:', error)
    return res.status(500).json({ error: 'Could not load your review.' })
  }
})

// Request a one-time PIN to confirm a yes/no featuring decision. Whichever
// way they answer, the PIN proves the choice actually came from the account
// owner before it's recorded — see /mine/:id/confirm.
router.post('/mine/:id/consent', consentLimiter, requireDb, requireAuth(), async (req, res) => {
  const choice = req.body.choice
  if (choice !== 'yes' && choice !== 'no') {
    return res.status(400).json({ error: 'choice must be "yes" or "no".' })
  }

  try {
    const { rows } = await query('SELECT user_id, consent_choice FROM reviews WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'Review not found.' })
    if (rows[0].user_id !== req.auth.sub) return res.status(403).json({ error: 'Not allowed.' })
    if (rows[0].consent_choice) {
      return res.status(409).json({ error: 'Consent has already been recorded for this review.' })
    }

    const pin = generatePin()
    const pinHash = await bcrypt.hash(pin, 10)
    const expiresAt = new Date(Date.now() + PIN_TTL_MS)

    await query(
      `UPDATE reviews SET pending_consent_choice = $1, consent_pin_hash = $2, consent_pin_expires_at = $3, consent_pin_attempts = 0
       WHERE id = $4`,
      [choice, pinHash, expiresAt, req.params.id],
    )

    if (req.auth.email) {
      const choiceLabel = choice === 'yes' ? 'feature your review on the site' : 'not feature your review on the site'
      sendEmail({
        to: req.auth.email,
        subject: 'Confirm your VolunTrack review preference',
        html: `<p>Enter this code to confirm you'd like us to <strong>${escapeHtml(choiceLabel)}</strong>:</p><p style="font-size:24px;font-weight:600;letter-spacing:0.1em;">${pin}</p><p>It expires in 10 minutes. If you didn't request this, you can ignore this email.</p>${emailFooterHtml()}`,
      }).catch(() => {})
    }

    return res.json({ ok: true })
  } catch (error) {
    console.error('request review consent PIN failed:', error)
    return res.status(500).json({ error: 'Could not send confirmation code.' })
  }
})

// Confirm the PIN sent by /mine/:id/consent and finalize consent_choice.
// Saying yes only makes the review *eligible* for admin approval — it does
// not publish it. Saying no marks it declined so it can never be approved.
router.post('/mine/:id/confirm', consentLimiter, requireDb, requireAuth(), async (req, res) => {
  const pin = req.body.pin
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    return res.status(400).json({ error: 'Enter the 4-digit code.' })
  }

  try {
    const { rows } = await query(
      `SELECT user_id, pending_consent_choice, consent_pin_hash, consent_pin_expires_at, consent_pin_attempts
       FROM reviews WHERE id = $1`,
      [req.params.id],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Review not found.' })
    const row = rows[0]
    if (row.user_id !== req.auth.sub) return res.status(403).json({ error: 'Not allowed.' })
    if (!row.pending_consent_choice || !row.consent_pin_hash) {
      return res.status(400).json({ error: 'No confirmation is pending. Request a new code.' })
    }
    if (new Date(row.consent_pin_expires_at) < new Date()) {
      await query('UPDATE reviews SET pending_consent_choice = NULL, consent_pin_hash = NULL, consent_pin_expires_at = NULL, consent_pin_attempts = 0 WHERE id = $1', [req.params.id])
      return res.status(410).json({ error: 'That code expired. Request a new one.' })
    }
    if (row.consent_pin_attempts >= PIN_MAX_ATTEMPTS) {
      return res.status(429).json({ error: 'Too many attempts. Request a new code.' })
    }

    const matches = await bcrypt.compare(pin, row.consent_pin_hash)
    if (!matches) {
      await query('UPDATE reviews SET consent_pin_attempts = consent_pin_attempts + 1 WHERE id = $1', [req.params.id])
      return res.status(401).json({ error: 'Incorrect code.' })
    }

    await query(
      `UPDATE reviews SET consent_choice = pending_consent_choice, pending_consent_choice = NULL,
       consent_pin_hash = NULL, consent_pin_expires_at = NULL, consent_pin_attempts = 0 WHERE id = $1`,
      [req.params.id],
    )

    return res.json({ ok: true, choice: row.pending_consent_choice })
  } catch (error) {
    console.error('confirm review consent failed:', error)
    return res.status(500).json({ error: 'Could not confirm your choice.' })
  }
})

// Approved reviews only, and only within their scheduled window (public —
// powers the "What people are saying" testimonials on the landing page).
// Never exposes email. publish_at/expires_at are NULL on reviews approved
// before scheduling existed, so NULL is treated as "no restriction" for
// backward compatibility.
router.get('/public', limiter, requireDb, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, rating, comment, name, role, created_at FROM reviews
       WHERE approved = true
         AND (publish_at IS NULL OR publish_at <= now())
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY created_at DESC LIMIT 20`,
    )
    return res.json({ reviews: rows })
  } catch (error) {
    console.error('list public reviews failed:', error)
    return res.status(500).json({ error: 'Could not fetch reviews.' })
  }
})

// List all reviews, in any state (admin only).
router.get('/admin/list', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, rating, comment, name, email, role, approved, consent_choice, publish_at, expires_at, created_at
       FROM reviews ORDER BY created_at DESC`,
    )
    const now = new Date()
    const reviews = rows.map((row) => ({ ...row, status: deriveStatus(row, now) }))
    return res.json({ reviews })
  } catch (error) {
    console.error('list reviews failed:', error)
    return res.status(500).json({ error: 'Could not fetch reviews.' })
  }
})

// Approve-with-schedule, or unpublish (admin only). Approving requires the
// reviewer to have already consented (consent_choice = 'yes') — this step
// never bypasses that, it only decides *when* a consented review is
// actually visible. Notifies the reviewer by email the first time their
// review is scheduled — not on every reschedule/toggle, so re-approving
// after an accidental unpublish doesn't re-send it.
router.patch('/admin/:id/approve', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rows } = await query('SELECT approved, email, consent_choice FROM reviews WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'Review not found.' })
    const row = rows[0]

    if (req.body.approved === false) {
      await query('UPDATE reviews SET approved = false, publish_at = NULL, expires_at = NULL WHERE id = $1', [req.params.id])
      return res.json({ ok: true })
    }

    if (row.consent_choice !== 'yes') {
      return res.status(400).json({ error: "The reviewer hasn't consented to being featured yet." })
    }

    const removeAfterDays = Number(req.body.removeAfterDays)
    if (!Number.isInteger(removeAfterDays) || removeAfterDays < 1 || removeAfterDays > 365) {
      return res.status(400).json({ error: 'removeAfterDays must be an integer from 1 to 365.' })
    }
    const publishAt = req.body.publishAt ? new Date(req.body.publishAt) : new Date()
    if (Number.isNaN(publishAt.getTime())) {
      return res.status(400).json({ error: 'Invalid publishAt date.' })
    }
    const expiresAt = new Date(publishAt.getTime() + removeAfterDays * 24 * 60 * 60 * 1000)

    const wasApproved = row.approved
    await query('UPDATE reviews SET approved = true, publish_at = $1, expires_at = $2 WHERE id = $3', [publishAt, expiresAt, req.params.id])

    if (!wasApproved && row.email) {
      const publishAtStr = publishAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      const expiresAtStr = expiresAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      sendEmail({
        to: row.email,
        subject: 'Your VolunTrack review is scheduled',
        html: `<p>Thanks for sharing your feedback — your review will appear on the VolunTrack site starting <strong>${escapeHtml(publishAtStr)}</strong> and will be removed on <strong>${escapeHtml(expiresAtStr)}</strong>. We appreciate you taking the time to write it.</p>${emailFooterHtml()}`,
      }).catch(() => {})
    }

    return res.json({ ok: true, publishAt, expiresAt })
  } catch (error) {
    console.error('approve review failed:', error)
    return res.status(500).json({ error: 'Could not update review.' })
  }
})

// Delete a review (admin only).
router.delete('/admin/:id', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    await query('DELETE FROM reviews WHERE id = $1', [req.params.id])
    return res.json({ ok: true })
  } catch (error) {
    console.error('delete review failed:', error)
    return res.status(500).json({ error: 'Could not delete review.' })
  }
})

export default router
