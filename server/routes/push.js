// Phone and browser push for notifications (#603): the app registers its
// device token here, and Settings → Notifications reads and saves which kinds
// to push. Sending is server/pushNotify.js.
import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { uid } from '../ids.js'
import { cleanPrefs, pushAvailable, PUSH_GROUP_NAMES } from '../pushNotify.js'

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

const PLATFORMS = ['android', 'ios']
// FCM tokens are ~160 characters, APNs tokens 64 hex; leave room, refuse junk.
const TOKEN_RE = /^[A-Za-z0-9:_\-.]{20,4096}$/

// GET /api/push/prefs → { prefs, available: { native, web } }
router.get('/prefs', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query('SELECT push_prefs FROM users WHERE id = $1', [req.auth.sub])
    if (!rows[0]) return res.status(404).json({ error: 'Account not found.' })
    return res.json({ prefs: cleanPrefs(rows[0].push_prefs), available: pushAvailable() })
  } catch (error) {
    console.error('push prefs read failed:', error)
    return res.status(500).json({ error: 'Could not load your notification settings.' })
  }
})

// PATCH /api/push/prefs { hours?: bool, tasks?: bool, family?: bool, reminders?: bool }
router.patch('/prefs', limiter, requireDb, requireAuth(), async (req, res) => {
  const body = req.body || {}
  const changes = {}
  for (const g of PUSH_GROUP_NAMES) {
    if (body[g] === undefined) continue
    if (typeof body[g] !== 'boolean') return res.status(400).json({ error: `${g} must be true or false.` })
    changes[g] = body[g]
  }
  if (!Object.keys(changes).length) return res.status(400).json({ error: 'Nothing to change.' })
  try {
    const { rows } = await query(
      'UPDATE users SET push_prefs = push_prefs || $2::jsonb WHERE id = $1 RETURNING push_prefs',
      [req.auth.sub, JSON.stringify(changes)],
    )
    if (!rows[0]) return res.status(404).json({ error: 'Account not found.' })
    return res.json({ prefs: cleanPrefs(rows[0].push_prefs) })
  } catch (error) {
    console.error('push prefs save failed:', error)
    return res.status(500).json({ error: 'Could not save your notification settings.' })
  }
})

// POST /api/push/devices { token, platform }: this app install wants pushes.
// A token moves to whoever registered it last, so a shared phone that signs
// in as someone else stops getting the first person's notices.
router.post('/devices', limiter, requireDb, requireAuth(), async (req, res) => {
  const token = String(req.body?.token || '')
  const platform = req.body?.platform
  if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: 'platform must be android or ios.' })
  if (!TOKEN_RE.test(token)) return res.status(400).json({ error: 'That device token is not valid.' })
  try {
    await query(
      `INSERT INTO push_devices (id, user_id, platform, token) VALUES ($1, $2, $3, $4)
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, last_seen_at = now()`,
      [uid('pdev'), req.auth.sub, platform, token],
    )
    return res.status(201).json({ ok: true })
  } catch (error) {
    console.error('push device register failed:', error)
    return res.status(500).json({ error: 'Could not turn on notifications.' })
  }
})

// DELETE /api/push/devices { token }: sign-out, or notifications turned off on
// this device. Only the caller's own token can be removed.
router.delete('/devices', limiter, requireDb, requireAuth(), async (req, res) => {
  const token = String(req.body?.token || '')
  try {
    await query('DELETE FROM push_devices WHERE token = $1 AND user_id = $2', [token, req.auth.sub])
    return res.json({ ok: true })
  } catch (error) {
    console.error('push device remove failed:', error)
    return res.status(500).json({ error: 'Could not turn off notifications.' })
  }
})

export default router
