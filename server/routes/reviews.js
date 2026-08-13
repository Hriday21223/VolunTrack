import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { uid } from '../ids.js'
import { requireAuth } from '../auth.js'

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
// valid token is present and we attach the email for context).
router.post('/', submitLimiter, requireDb, async (req, res) => {
  const rating = Number(req.body.rating)
  const comment = req.body.comment ? String(req.body.comment).trim() : null

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be an integer from 1 to 5.' })
  }
  if (comment && comment.length > 2000) return res.status(400).json({ error: 'Comment is too long.' })

  try {
    const id = uid('rev')
    await query(
      'INSERT INTO reviews (id, rating, comment, email) VALUES ($1, $2, $3, $4)',
      [id, rating, comment, req.auth?.email || null],
    )
    return res.status(201).json({ ok: true, id })
  } catch (error) {
    console.error('review submit failed:', error)
    return res.status(500).json({ error: 'Could not save review.' })
  }
})

// List reviews (admin only).
router.get('/admin/list', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rows } = await query('SELECT id, rating, comment, email, created_at FROM reviews ORDER BY created_at DESC')
    return res.json({ reviews: rows })
  } catch (error) {
    console.error('list reviews failed:', error)
    return res.status(500).json({ error: 'Could not fetch reviews.' })
  }
})

export default router
