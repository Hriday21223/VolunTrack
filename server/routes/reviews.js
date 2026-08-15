import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { uid } from '../ids.js'
import { requireAuth } from '../auth.js'
import { sendEmail } from '../email.js'
import { escapeHtml } from '../html.js'

const router = express.Router()

// Public submission endpoint — keep it tighter than the general API limiter.
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
})

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// Submit a review (public — client-only users with no account can still
// leave one; `authenticate` still runs globally, so req.auth is set when a
// valid token is present and we capture its role/email for context). Held
// back from public display (approved = false) until an admin reviews it —
// see PATCH /admin/:id/approve.
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
      'INSERT INTO reviews (id, rating, comment, name, email, role) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, rating, comment, name, req.auth?.email || null, req.auth?.role || null],
    )
    return res.status(201).json({ ok: true, id })
  } catch (error) {
    console.error('review submit failed:', error)
    return res.status(500).json({ error: 'Could not save review.' })
  }
})

// Approved reviews only (public — powers the "What people are saying"
// testimonials on the landing page). Never exposes email.
router.get('/public', limiter, requireDb, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, rating, comment, name, role, created_at FROM reviews
       WHERE approved = true ORDER BY created_at DESC LIMIT 20`,
    )
    return res.json({ reviews: rows })
  } catch (error) {
    console.error('list public reviews failed:', error)
    return res.status(500).json({ error: 'Could not fetch reviews.' })
  }
})

// List all reviews, approved or not (admin only).
router.get('/admin/list', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rows } = await query('SELECT id, rating, comment, name, email, role, approved, created_at FROM reviews ORDER BY created_at DESC')
    return res.json({ reviews: rows })
  } catch (error) {
    console.error('list reviews failed:', error)
    return res.status(500).json({ error: 'Could not fetch reviews.' })
  }
})

// Approve or unapprove a review for public display (admin only). Notifies
// the reviewer by email the first time their review goes live — not on
// every toggle, so re-approving after an accidental unapprove doesn't
// re-send it.
router.patch('/admin/:id/approve', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const approved = req.body.approved !== false
  try {
    const { rows } = await query('SELECT approved, email FROM reviews WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'Review not found.' })
    const wasApproved = rows[0].approved

    await query('UPDATE reviews SET approved = $1 WHERE id = $2', [approved, req.params.id])

    if (approved && !wasApproved && rows[0].email) {
      sendEmail({
        to: rows[0].email,
        subject: 'Your VolunTrack review is now live',
        html: `<p>Thanks for sharing your feedback — your review has been approved and is now showing on the VolunTrack site. We appreciate you taking the time to write it.</p>`,
      }).catch(() => {})
    }

    return res.json({ ok: true })
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
