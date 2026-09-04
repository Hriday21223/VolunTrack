import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { uid } from '../ids.js'
import { requireAuth } from '../auth.js'
import { pushConfigured, vapidPublicKey, sendPush } from '../push.js'
import { nextOccurrenceUtc } from '../reminderSchedule.js'

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

// How far back a run looks for occurrences it may have missed (a skipped cron
// run, a sleeping backend). reminder_sends makes the replay idempotent, so a
// generous window costs nothing but avoids silently dropping a reminder.
const LOOKBACK_MS = 60 * 60 * 1000

const KINDS = ['one-off', 'daily', 'weekly', 'monthly']
const MAX_REMINDERS = 100

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// GET /api/reminders/config — lets the client decide whether to offer push at
// all, and hands it the key it needs to subscribe.
router.get('/config', limiter, (_req, res) => {
  res.json({ pushEnabled: pushConfigured(), publicKey: vapidPublicKey() })
})

router.post('/subscribe', limiter, requireDb, requireAuth(), async (req, res) => {
  if (!pushConfigured()) return res.status(503).json({ error: 'Push notifications are not configured on this server.' })

  const endpoint = String(req.body?.endpoint || '')
  const p256dh = String(req.body?.keys?.p256dh || '')
  const auth = String(req.body?.keys?.auth || '')
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 2000) {
    return res.status(400).json({ error: 'A valid https push endpoint is required.' })
  }
  if (!p256dh || !auth || p256dh.length > 256 || auth.length > 256) {
    return res.status(400).json({ error: 'Subscription keys are missing or malformed.' })
  }

  try {
    // The same browser re-subscribing must not create a second row, and a
    // subscription can move between accounts on a shared device.
    await query(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh,
             auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`,
      [uid('psub'), req.auth.sub, endpoint, p256dh, auth, String(req.headers['user-agent'] || '').slice(0, 300)],
    )
    return res.status(201).json({ ok: true })
  } catch (error) {
    console.error('push subscribe failed:', error)
    return res.status(500).json({ error: 'Could not save the subscription.' })
  }
})

router.post('/unsubscribe', limiter, requireDb, requireAuth(), async (req, res) => {
  const endpoint = String(req.body?.endpoint || '')
  if (!endpoint) return res.status(400).json({ error: 'endpoint is required.' })
  try {
    // Scoped to the caller so one account can't delete another's subscription.
    await query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, req.auth.sub])
    return res.json({ ok: true })
  } catch (error) {
    console.error('push unsubscribe failed:', error)
    return res.status(500).json({ error: 'Could not remove the subscription.' })
  }
})

// PUT /api/reminders/sync — the client owns its reminders (localStorage is the
// source of truth); this mirrors just enough for the server to know when to
// push. Replaced wholesale so a deletion on the client propagates.
router.put('/sync', limiter, requireDb, requireAuth(), async (req, res) => {
  const incoming = Array.isArray(req.body?.reminders) ? req.body.reminders : null
  if (!incoming) return res.status(400).json({ error: 'reminders array is required.' })
  if (incoming.length > MAX_REMINDERS) return res.status(400).json({ error: `At most ${MAX_REMINDERS} reminders can be synced.` })

  // Without a zone a 09:00 reminder would fire at the server's 09:00 (UTC),
  // not the user's — so an unusable timezone is a hard error, not a default.
  const timezone = String(req.body?.timezone || '')
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    return res.status(400).json({ error: 'A valid IANA timezone is required.' })
  }

  const rows = []
  for (const r of incoming) {
    if (!r || typeof r.id !== 'string' || !KINDS.includes(r.kind)) continue
    if (!/^\d{1,2}:\d{2}$/.test(String(r.time || ''))) continue
    rows.push([
      r.id.slice(0, 64), req.auth.sub,
      String(r.title || 'VolunTrack reminder').slice(0, 120),
      String(r.body || '').slice(0, 300),
      r.kind, String(r.time),
      Number.isInteger(r.weekday) ? r.weekday : null,
      Number.isInteger(r.dayOfMonth) ? r.dayOfMonth : null,
      r.startDate || null, r.endDate || null,
      r.enabled !== false, timezone,
    ])
  }

  try {
    await query('DELETE FROM reminders WHERE user_id = $1', [req.auth.sub])
    for (const row of rows) {
      await query(
        `INSERT INTO reminders
           (id, user_id, title, body, kind, time, weekday, day_of_month, start_date, end_date, enabled, timezone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title, body = EXCLUDED.body, kind = EXCLUDED.kind,
           time = EXCLUDED.time, weekday = EXCLUDED.weekday,
           day_of_month = EXCLUDED.day_of_month, start_date = EXCLUDED.start_date,
           end_date = EXCLUDED.end_date, enabled = EXCLUDED.enabled,
           timezone = EXCLUDED.timezone, updated_at = now()`,
        row,
      )
    }
    return res.json({ ok: true, synced: rows.length })
  } catch (error) {
    console.error('reminder sync failed:', error)
    return res.status(500).json({ error: 'Could not sync reminders.' })
  }
})

// POST /api/reminders/internal/run-due — cron entry point, guarded by a shared
// secret the same way the parent digest is. Render's free tier has no cron, so
// a GitHub Actions schedule calls this.
router.post('/internal/run-due', requireDb, async (req, res) => {
  const secret = process.env.CRON_SECRET
  if (!secret) return res.status(503).json({ error: 'CRON_SECRET is not configured.' })
  if (req.headers['x-cron-key'] !== secret) return res.status(403).json({ error: 'Forbidden.' })
  if (!pushConfigured()) return res.status(503).json({ error: 'Push notifications are not configured.' })

  const now = Date.now()
  const dryRun = req.body?.dryRun === true
  const summary = { considered: 0, due: 0, sent: 0, failed: 0, pruned: 0, skippedAlreadySent: 0 }

  try {
    const { rows: reminders } = await query('SELECT * FROM reminders WHERE enabled = true')
    summary.considered = reminders.length

    for (const r of reminders) {
      const fireAt = nextOccurrenceUtc({
        kind: r.kind,
        time: r.time,
        weekday: r.weekday,
        dayOfMonth: r.day_of_month,
        startDate: r.start_date,
        endDate: r.end_date,
        enabled: r.enabled,
        timezone: r.timezone,
      }, now - LOOKBACK_MS)

      if (fireAt == null || fireAt > now) continue
      summary.due += 1
      if (dryRun) continue

      // Atomic claim: two overlapping cron runs cannot both send the same
      // occurrence, because only one INSERT returns a row.
      const { rows: claimed } = await query(
        `INSERT INTO reminder_sends (reminder_id, fire_at) VALUES ($1, to_timestamp($2 / 1000.0))
         ON CONFLICT (reminder_id, fire_at) DO NOTHING
         RETURNING reminder_id`,
        [r.id, fireAt],
      )
      if (claimed.length === 0) { summary.skippedAlreadySent += 1; continue }

      const { rows: subs } = await query('SELECT * FROM push_subscriptions WHERE user_id = $1', [r.user_id])
      for (const sub of subs) {
        const result = await sendPush(sub, {
          title: r.title,
          body: r.body || 'Time to check on your volunteer work.',
          tag: `${r.id}@${fireAt}`,
          url: '/reminders',
        })
        if (result.ok) {
          summary.sent += 1
          await query('UPDATE push_subscriptions SET last_sent_at = now() WHERE id = $1', [sub.id]).catch(() => {})
        } else if (result.gone) {
          // Dead endpoint — the browser uninstalled the PWA or cleared data.
          summary.pruned += 1
          await query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]).catch(() => {})
        } else {
          summary.failed += 1
          console.error('push send failed:', result.error)
        }
      }
    }

    return res.json({ ok: true, dryRun, ...summary })
  } catch (error) {
    console.error('reminder run-due failed:', error)
    return res.status(500).json({ error: 'Could not run reminders.' })
  }
})

export default router
