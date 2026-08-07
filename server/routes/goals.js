import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { uid } from '../ids.js'

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// Write-through sync target for a student's Settings goals, mirroring
// server/routes/logs.js: always scoped to the caller's own account.
router.get('/', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, label, target, period, deadline, is_primary, created_at
       FROM goals WHERE user_id = $1 ORDER BY created_at ASC`,
      [req.auth.sub],
    )
    return res.json({ goals: rows })
  } catch (error) {
    console.error('goal fetch failed:', error)
    return res.status(500).json({ error: 'Could not fetch goals.' })
  }
})

router.post('/', limiter, requireDb, requireAuth(), async (req, res) => {
  const { label, target, period, deadline, isPrimary } = req.body
  const targetNum = Number(target)
  if (!label || typeof label !== 'string' || !Number.isFinite(targetNum) || targetNum <= 0) {
    return res.status(400).json({ error: 'label and a positive target are required.' })
  }
  try {
    const id = uid('goal')
    await query(
      `INSERT INTO goals (id, user_id, label, target, period, deadline, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, req.auth.sub, label, targetNum, period || null, deadline || null, Boolean(isPrimary)],
    )
    return res.status(201).json({ id })
  } catch (error) {
    console.error('goal create failed:', error)
    return res.status(500).json({ error: 'Could not save goal.' })
  }
})

router.patch('/:id', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query('SELECT user_id FROM goals WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'Goal not found.' })
    if (rows[0].user_id !== req.auth.sub) return res.status(403).json({ error: 'Not allowed.' })

    const { label, target, period, deadline, isPrimary } = req.body
    // isPrimary is a real boolean choice (false is meaningful — "no longer
    // primary" — so it can't be COALESCEd away like the other fields).
    if (isPrimary === true) {
      await query('UPDATE goals SET is_primary = false WHERE user_id = $1', [req.auth.sub])
    }
    await query(
      `UPDATE goals SET
         label      = COALESCE($1, label),
         target     = COALESCE($2, target),
         period     = COALESCE($3, period),
         deadline   = COALESCE($4, deadline),
         is_primary = COALESCE($5, is_primary)
       WHERE id = $6`,
      [label || null, target != null ? Number(target) : null, period || null, deadline || null, typeof isPrimary === 'boolean' ? isPrimary : null, req.params.id],
    )
    return res.json({ ok: true })
  } catch (error) {
    console.error('goal update failed:', error)
    return res.status(500).json({ error: 'Could not update goal.' })
  }
})

router.delete('/:id', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query('SELECT user_id FROM goals WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'Goal not found.' })
    if (rows[0].user_id !== req.auth.sub) return res.status(403).json({ error: 'Not allowed.' })

    await query('DELETE FROM goals WHERE id = $1', [req.params.id])
    return res.json({ ok: true })
  } catch (error) {
    console.error('goal delete failed:', error)
    return res.status(500).json({ error: 'Could not delete goal.' })
  }
})

export default router
