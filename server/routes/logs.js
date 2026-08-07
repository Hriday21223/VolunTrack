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

// Write-through sync target for a student's own Log Hours form. Always
// writes to the caller's own account — there is no way to pass a target
// user id here, which is what keeps a parent unable to write regardless of
// role checks (no route accepts one).
// Base64 dataURLs inflate ~33% over raw bytes; FileDrop caps uploads at
// 1.5MB client-side, so a well-behaved client never exceeds this.
const MAX_PROOF_PHOTO_CHARS = 2_200_000

router.post('/', limiter, requireDb, requireAuth(), async (req, res) => {
  const { date, activity, category, hours, notes, supervisorName, supervisorEmail, supervisorSignature, proofPhotoData, proofPhotoType } = req.body
  const hoursNum = Number(hours)
  if (!date || !activity || typeof activity !== 'string' || !Number.isFinite(hoursNum) || hoursNum <= 0) {
    return res.status(400).json({ error: 'date, activity, and positive hours are required.' })
  }
  if (proofPhotoData && proofPhotoData.length > MAX_PROOF_PHOTO_CHARS) {
    return res.status(400).json({ error: 'Proof photo is too large.' })
  }
  try {
    const id = uid('log')
    await query(
      `INSERT INTO logs (id, user_id, date, activity, category, hours, notes, supervisor_name, supervisor_email, supervisor_signature, proof_photo_data, proof_photo_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [id, req.auth.sub, date, activity, category || null, hoursNum, notes || null, supervisorName || null, supervisorEmail || null, supervisorSignature || null, proofPhotoData || null, proofPhotoType || null],
    )
    return res.status(201).json({ id })
  } catch (error) {
    console.error('log create failed:', error)
    return res.status(500).json({ error: 'Could not save log.' })
  }
})

router.patch('/:id', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query('SELECT user_id FROM logs WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'Log not found.' })
    if (rows[0].user_id !== req.auth.sub) return res.status(403).json({ error: 'Not allowed.' })

    const { date, activity, category, hours, notes, supervisorName, supervisorEmail, supervisorSignature, proofPhotoData, proofPhotoType } = req.body
    if (proofPhotoData && proofPhotoData.length > MAX_PROOF_PHOTO_CHARS) {
      return res.status(400).json({ error: 'Proof photo is too large.' })
    }
    await query(
      `UPDATE logs SET
         date = COALESCE($1, date),
         activity = COALESCE($2, activity),
         category = COALESCE($3, category),
         hours = COALESCE($4, hours),
         notes = COALESCE($5, notes),
         supervisor_name = COALESCE($6, supervisor_name),
         supervisor_email = COALESCE($7, supervisor_email),
         supervisor_signature = COALESCE($8, supervisor_signature),
         proof_photo_data = COALESCE($9, proof_photo_data),
         proof_photo_type = COALESCE($10, proof_photo_type)
       WHERE id = $11`,
      [date || null, activity || null, category || null, hours != null ? Number(hours) : null, notes || null, supervisorName || null, supervisorEmail || null, supervisorSignature || null, proofPhotoData || null, proofPhotoType || null, req.params.id],
    )
    return res.json({ ok: true })
  } catch (error) {
    console.error('log update failed:', error)
    return res.status(500).json({ error: 'Could not update log.' })
  }
})

router.delete('/:id', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query('SELECT user_id FROM logs WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'Log not found.' })
    if (rows[0].user_id !== req.auth.sub) return res.status(403).json({ error: 'Not allowed.' })

    await query('DELETE FROM logs WHERE id = $1', [req.params.id])
    return res.json({ ok: true })
  } catch (error) {
    console.error('log delete failed:', error)
    return res.status(500).json({ error: 'Could not delete log.' })
  }
})

// Read a user's logs — the caller themself, or a parent linked to them.
router.get('/:userId', limiter, requireDb, requireAuth(), async (req, res) => {
  const { userId } = req.params
  try {
    if (req.auth.sub !== userId) {
      if (req.auth.role !== 'parent') return res.status(403).json({ error: 'Not allowed.' })
      const { rows: link } = await query(
        'SELECT 1 FROM parent_child_links WHERE parent_id = $1 AND child_id = $2',
        [req.auth.sub, userId],
      )
      if (link.length === 0) return res.status(403).json({ error: 'Not allowed.' })
    }

    const { rows } = await query(
      `SELECT id, date, activity, category, hours, notes, supervisor_name, supervisor_email, supervisor_signature, proof_photo_data, proof_photo_type, verification_status, created_at
       FROM logs WHERE user_id = $1 ORDER BY date DESC, created_at DESC`,
      [userId],
    )
    return res.json({ logs: rows })
  } catch (error) {
    console.error('log fetch failed:', error)
    return res.status(500).json({ error: 'Could not fetch logs.' })
  }
})

export default router
