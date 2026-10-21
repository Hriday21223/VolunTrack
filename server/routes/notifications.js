import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'

// The notification bell (src/components/NotificationBell.jsx). Every query is
// scoped by the token's own user id — a notification is readable and
// markable only by the person it was written for.

const router = express.Router()

// The bell polls once a minute per open tab, so this is generous.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Notifications are not available.' })
  return next()
}

const LATEST = 30
const MAX_IDS = 100

// GET /api/notifications — the latest 30 and how many are unread in all.
router.get('/', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const [{ rows }, { rows: countRows }] = await Promise.all([
      query(
        `SELECT id, kind, title, body, link, created_at, read_at
           FROM notifications WHERE user_id = $1
          ORDER BY created_at DESC, id DESC LIMIT ${LATEST}`,
        [req.auth.sub],
      ),
      query('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.auth.sub]),
    ])
    return res.json({
      notifications: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        body: r.body,
        link: r.link,
        createdAt: r.created_at,
        readAt: r.read_at,
      })),
      unread: countRows[0].n,
    })
  } catch (error) {
    console.error('notifications list failed:', error)
    return res.status(500).json({ error: 'Could not load notifications.' })
  }
})

// POST /api/notifications/read — { ids: [...] } marks those; no ids marks all.
router.post('/read', limiter, requireDb, requireAuth(), async (req, res) => {
  const raw = req.body?.ids
  if (raw !== undefined && !Array.isArray(raw)) return res.status(400).json({ error: 'ids must be a list.' })
  const ids = Array.isArray(raw) ? [...new Set(raw.map(String))].slice(0, MAX_IDS) : null
  try {
    let result
    if (ids) {
      if (ids.length === 0) return res.json({ ok: true, marked: 0 })
      result = await query(
        'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2::text[])',
        [req.auth.sub, ids],
      )
    } else {
      result = await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.auth.sub])
    }
    return res.json({ ok: true, marked: result.rowCount })
  } catch (error) {
    console.error('notifications mark read failed:', error)
    return res.status(500).json({ error: 'Could not update notifications.' })
  }
})

export default router
