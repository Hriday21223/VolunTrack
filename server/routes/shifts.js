// A student's regular weekly shifts (#571): "every Tuesday 4–6 at the
// library". The app asks after each one whether they went; "Log it" opens Log
// Hours filled in from the shift, so the school's rules still apply when it's
// saved. Skipped weeks are remembered so the question isn't asked again.

import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { uid } from '../ids.js'

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

const MAX_SHIFTS = 10
const MAX_SKIPS = 30
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const coord = (v, limit) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null
}

const toJson = (r) => ({
  id: r.id,
  activity: r.activity,
  category: r.category,
  orgName: r.org_name || '',
  location: r.location || '',
  latitude: r.latitude != null ? Number(r.latitude) : null,
  longitude: r.longitude != null ? Number(r.longitude) : null,
  supervisorName: r.supervisor_name || '',
  supervisorEmail: r.supervisor_email || '',
  weekday: r.weekday,
  startTime: r.start_time,
  endTime: r.end_time,
  skipped: r.skipped || [],
  createdAt: r.created_at,
})

router.get('/', limiter, requireDb, requireAuth('student', 'volunteer'), async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM regular_shifts WHERE user_id = $1 ORDER BY weekday, start_time', [req.auth.sub])
    return res.json({ shifts: rows.map(toJson) })
  } catch (error) {
    console.error('shifts list failed:', error)
    return res.status(500).json({ error: 'Could not load your shifts.' })
  }
})

router.post('/', limiter, requireDb, requireAuth('student', 'volunteer'), async (req, res) => {
  const b = req.body || {}
  const activity = text(b.activity, 200)
  const weekday = Number(b.weekday)
  if (!activity) return res.status(400).json({ error: 'Say what you do on this shift.' })
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return res.status(400).json({ error: 'Pick a day of the week.' })
  if (!TIME.test(String(b.startTime || '')) || !TIME.test(String(b.endTime || ''))) return res.status(400).json({ error: 'Add a start and end time.' })
  if (String(b.endTime) <= String(b.startTime)) return res.status(400).json({ error: 'The end time must be after the start time.' })
  try {
    const { rows: count } = await query('SELECT COUNT(*)::int AS n FROM regular_shifts WHERE user_id = $1', [req.auth.sub])
    if (count[0].n >= MAX_SHIFTS) return res.status(409).json({ error: `You can save up to ${MAX_SHIFTS} regular shifts.` })
    const { rows } = await query(
      `INSERT INTO regular_shifts (id, user_id, activity, category, org_name, location, latitude, longitude,
                                   supervisor_name, supervisor_email, weekday, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [uid('shift'), req.auth.sub, activity, text(b.category, 60) || null, text(b.orgName, 200) || null, text(b.location, 300) || null,
        coord(b.latitude, 90), coord(b.longitude, 180), text(b.supervisorName, 100) || null, text(b.supervisorEmail, 254) || null,
        weekday, b.startTime, b.endTime],
    )
    return res.status(201).json({ shift: toJson(rows[0]) })
  } catch (error) {
    console.error('shift create failed:', error)
    return res.status(500).json({ error: 'Could not save the shift.' })
  }
})

router.delete('/:id', limiter, requireDb, requireAuth('student', 'volunteer'), async (req, res) => {
  try {
    const { rowCount } = await query('DELETE FROM regular_shifts WHERE id = $1 AND user_id = $2', [req.params.id, req.auth.sub])
    if (rowCount === 0) return res.status(404).json({ error: 'Shift not found.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('shift delete failed:', error)
    return res.status(500).json({ error: 'Could not remove the shift.' })
  }
})

// "I didn't go that week": that date is never asked about again.
router.post('/:id/skip', limiter, requireDb, requireAuth('student', 'volunteer'), async (req, res) => {
  const date = String(req.body?.date || '')
  if (!DATE.test(date)) return res.status(400).json({ error: 'Invalid date.' })
  try {
    const { rows } = await query(
      `UPDATE regular_shifts
          SET skipped = (SELECT COALESCE(jsonb_agg(d), '[]'::jsonb) FROM (
                SELECT d FROM jsonb_array_elements_text(COALESCE(skipped, '[]'::jsonb) || to_jsonb($3::text)) AS d
                GROUP BY d ORDER BY d DESC LIMIT ${MAX_SKIPS}) s)
        WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.auth.sub, date],
    )
    if (!rows[0]) return res.status(404).json({ error: 'Shift not found.' })
    return res.json({ shift: toJson(rows[0]) })
  } catch (error) {
    console.error('shift skip failed:', error)
    return res.status(500).json({ error: 'Could not skip that week.' })
  }
})

export default router
