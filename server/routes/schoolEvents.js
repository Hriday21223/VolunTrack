import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { uid } from '../ids.js'
import { readEvent } from '../schoolEvents.js'

// Events for schools and organizations (#995), at /api/events. The admin
// manages them (Admin → Invites, area 'invites'); the public route answers
// with the next published event that hasn't ended, or none.

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

const shape = (r) => ({
  id: r.id,
  title: r.title,
  startsAt: r.starts_at,
  timeZone: r.time_zone,
  durationMinutes: r.duration_minutes,
  mode: r.mode,
  place: r.place,
  agenda: r.agenda,
  offerCode: r.offer_code,
  offerText: r.offer_text,
  rsvpUrl: r.rsvp_url,
  published: r.published,
  updatedAt: r.updated_at,
})

// What anyone may see. The event code is the reward for attending, so it is
// never sent publicly: it's read out during the session. The page only learns
// that there is one.
const publicShape = (r) => {
  const { offerCode, ...rest } = shape(r)
  return { ...rest, hasOfferCode: Boolean(offerCode) }
}

// GET /api/events/upcoming — public. The next published event still to come
// (or under way), or { event: null }.
router.get('/upcoming', limiter, async (_req, res) => {
  if (!hasDatabase()) return res.json({ event: null })
  try {
    const { rows } = await query(
      `SELECT * FROM school_events
        WHERE published AND starts_at + make_interval(mins => duration_minutes) > now()
        ORDER BY starts_at LIMIT 1`,
    )
    res.set('Cache-Control', 'public, max-age=60')
    return res.json({ event: rows[0] ? publicShape(rows[0]) : null })
  } catch (error) {
    console.error('upcoming event failed:', error.message)
    return res.json({ event: null })
  }
})

// GET /api/events/one/:id — public. One published event, for a link to it
// (/events?id=…), including one that has ended (the page then says so).
router.get('/one/:id', limiter, async (req, res) => {
  if (!/^sev_[A-Za-z0-9_]{4,60}$/.test(req.params.id)) return res.status(404).json({ error: 'Event not found.' })
  if (!hasDatabase()) return res.status(404).json({ error: 'Event not found.' })
  try {
    const { rows } = await query('SELECT * FROM school_events WHERE id = $1 AND published', [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'Event not found.' })
    res.set('Cache-Control', 'public, max-age=60')
    return res.json({ event: publicShape(rows[0]) })
  } catch (error) {
    console.error('get event failed:', error.message)
    return res.status(500).json({ error: 'Could not load the event.' })
  }
})

// Admin: list, add, change, remove.
router.get('/admin', limiter, requireDb, requireAuth('admin'), async (_req, res) => {
  try {
    const { rows } = await query('SELECT * FROM school_events ORDER BY starts_at DESC LIMIT 100')
    return res.json({ events: rows.map(shape) })
  } catch (error) {
    console.error('list events failed:', error)
    return res.status(500).json({ error: 'Could not load events.' })
  }
})

router.post('/admin', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const { event: e, error } = readEvent(req.body)
  if (error) return res.status(400).json({ error })
  try {
    const { rows } = await query(
      `INSERT INTO school_events (id, title, starts_at, time_zone, duration_minutes, mode, place, agenda, offer_code, offer_text, rsvp_url, published, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [uid('sev'), e.title, e.startsAt, e.timeZone, e.durationMinutes, e.mode, e.place, e.agenda, e.offerCode, e.offerText, e.rsvpUrl, e.published, req.auth.sub],
    )
    return res.status(201).json({ event: shape(rows[0]) })
  } catch (error) {
    console.error('add event failed:', error)
    return res.status(500).json({ error: 'Could not save the event.' })
  }
})

router.patch('/admin/:id', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const { event: e, error } = readEvent(req.body)
  if (error) return res.status(400).json({ error })
  try {
    const { rows } = await query(
      `UPDATE school_events SET title=$2, starts_at=$3, time_zone=$4, duration_minutes=$5, mode=$6, place=$7, agenda=$8,
              offer_code=$9, offer_text=$10, rsvp_url=$11, published=$12, updated_at=now()
        WHERE id=$1 RETURNING *`,
      [req.params.id, e.title, e.startsAt, e.timeZone, e.durationMinutes, e.mode, e.place, e.agenda, e.offerCode, e.offerText, e.rsvpUrl, e.published],
    )
    if (!rows[0]) return res.status(404).json({ error: 'Event not found.' })
    return res.json({ event: shape(rows[0]) })
  } catch (error) {
    console.error('update event failed:', error)
    return res.status(500).json({ error: 'Could not save the event.' })
  }
})

router.delete('/admin/:id', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rowCount } = await query('DELETE FROM school_events WHERE id = $1', [req.params.id])
    if (!rowCount) return res.status(404).json({ error: 'Event not found.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('delete event failed:', error)
    return res.status(500).json({ error: 'Could not remove the event.' })
  }
})

export default router
