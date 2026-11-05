// Wallet card routes (#716): see server/wallet.js.
import express from 'express'
import rateLimit from 'express-rate-limit'
import { hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { query } from '../db.js'
import { appleWalletConfigured, googleWalletConfigured, googleSaveUrl, applePass, appleLinkToken, userFromLinkToken, appleAuthOk, appleBadgePass, googleBadgeSaveUrl } from '../wallet.js'
import { loadBadge } from '../badge.js'

const router = express.Router()
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please try again later.' } })
const requireDb = (_req, res, next) => (hasDatabase() ? next() : res.status(503).json({ error: 'Server database is not configured.' }))
const ROLES = ['student', 'volunteer']
const apiBase = (req) => (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')

// GET /api/wallet/status — which wallets are switched on.
router.get('/status', limiter, requireAuth(...ROLES), (_req, res) => {
  res.json({ apple: appleWalletConfigured(), google: googleWalletConfigured() })
})

// GET /api/wallet/google — { url } to "Save to Google Wallet".
router.get('/google', limiter, requireDb, requireAuth(...ROLES), async (req, res) => {
  try {
    const url = await googleSaveUrl(req.auth.sub)
    if (!url) return res.status(404).json({ error: 'Google Wallet isn\'t available yet.' })
    return res.json({ url })
  } catch (error) {
    console.error('google wallet failed:', error.message)
    return res.status(500).json({ error: 'Could not make your wallet card.' })
  }
})

// GET /api/wallet/apple-link — { url } valid for 5 minutes, opened by the phone.
router.get('/apple-link', limiter, requireAuth(...ROLES), (req, res) => {
  if (!appleWalletConfigured()) return res.status(404).json({ error: 'Apple Wallet isn\'t available yet.' })
  return res.json({ url: `${apiBase(req)}/api/wallet/apple/${appleLinkToken(req.auth.sub)}.pkpass` })
})

// GET /api/wallet/apple/:token.pkpass — the signed pass.
router.get('/apple/:token.pkpass', limiter, requireDb, async (req, res) => {
  const userId = userFromLinkToken(req.params.token)
  if (!userId) return res.status(404).type('text/plain').send('This link has expired. Open Reports and tap Add to Apple Wallet again.')
  try {
    const pass = await applePass(userId)
    if (!pass) return res.status(404).type('text/plain').send('Apple Wallet isn\'t available yet.')
    res.set('Content-Type', 'application/vnd.apple.pkpass')
    res.set('Content-Disposition', 'attachment; filename="voluntrack.pkpass"')
    res.set('Cache-Control', 'no-store')
    return res.send(pass)
  } catch (error) {
    console.error('apple wallet failed:', error.message)
    return res.status(500).type('text/plain').send('Could not make your wallet card.')
  }
})

// --- Event badge as a wallet ticket (#732) -------------------------------------
// GET /api/wallet/badge/:taskId/google — { url }.
router.get('/badge/:taskId/google', limiter, requireDb, requireAuth(...ROLES), async (req, res) => {
  try {
    const r = await loadBadge(req.params.taskId, req.auth.sub)
    if (r.error) return res.status(r.status).json({ error: r.error })
    const url = googleBadgeSaveUrl(r.badge)
    if (!url) return res.status(404).json({ error: 'Google Wallet isn\'t available yet.' })
    return res.json({ url })
  } catch (error) {
    console.error('google badge failed:', error.message)
    return res.status(500).json({ error: 'Could not make your wallet card.' })
  }
})

// GET /api/wallet/badge/:taskId/apple-link — { url } valid for 5 minutes.
router.get('/badge/:taskId/apple-link', limiter, requireDb, requireAuth(...ROLES), async (req, res) => {
  if (!appleWalletConfigured()) return res.status(404).json({ error: 'Apple Wallet isn\'t available yet.' })
  try {
    const r = await loadBadge(req.params.taskId, req.auth.sub)
    if (r.error) return res.status(r.status).json({ error: r.error })
    const token = appleLinkToken(JSON.stringify([req.auth.sub, String(req.params.taskId)]))
    return res.json({ url: `${apiBase(req)}/api/wallet/badge-apple/${token}.pkpass` })
  } catch (error) {
    console.error('apple badge link failed:', error.message)
    return res.status(500).json({ error: 'Could not make your wallet card.' })
  }
})

// GET /api/wallet/badge-apple/:token.pkpass — the signed ticket; the rules are checked again.
router.get('/badge-apple/:token.pkpass', limiter, requireDb, async (req, res) => {
  let ids = null
  try { ids = JSON.parse(userFromLinkToken(req.params.token) || 'null') } catch { ids = null }
  if (!Array.isArray(ids) || ids.length !== 2) return res.status(404).type('text/plain').send('This link has expired. Open your badge and tap Add to Apple Wallet again.')
  try {
    const r = await loadBadge(ids[1], ids[0])
    if (r.error) return res.status(r.status).type('text/plain').send(r.error)
    const pass = appleBadgePass(r.badge, r.place)
    if (!pass) return res.status(404).type('text/plain').send('Apple Wallet isn\'t available yet.')
    res.set('Content-Type', 'application/vnd.apple.pkpass')
    res.set('Content-Disposition', 'attachment; filename="volunteer-badge.pkpass"')
    res.set('Cache-Control', 'no-store')
    return res.send(pass)
  } catch (error) {
    console.error('apple badge failed:', error.message)
    return res.status(500).type('text/plain').send('Could not make your wallet card.')
  }
})

// --- Apple's pass web service (#730) -----------------------------------------
// Called by the phone, not the app: Apple's paths under webServiceURL, with
// "Authorization: ApplePass <token>". Only the pass's own serial and its
// HMAC token are ever accepted; nothing here reads a signed-in session.
const wsLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false })
const ws = express.Router()
const ID = /^[A-Za-z0-9._-]{1,128}$/
const ourType = (t) => t === process.env.APPLE_PASS_TYPE_ID
const cardBySerial = async (serial) => (await query('SELECT user_id, serial, updated_at FROM wallet_cards WHERE serial = $1 AND apple', [serial])).rows[0] || null
// Express 4 doesn't catch a rejected async handler, so each one is wrapped.
const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error('apple wallet web service failed:', e.message)
  if (!res.headersSent) res.sendStatus(500)
})
const tag = (d) => String(Math.floor(new Date(d).getTime() / 1000))

// Register a phone for updates to a pass.
ws.post('/v1/devices/:device/registrations/:type/:serial', safe(async (req, res) => {
  const { device, type, serial } = req.params
  const pushToken = String(req.body?.pushToken || '')
  if (!ourType(type) || !ID.test(device) || !/^[A-Fa-f0-9]{16,200}$/.test(pushToken)) return res.sendStatus(400)
  if (!appleAuthOk(serial, req.get('authorization'))) return res.sendStatus(401)
  if (!(await cardBySerial(serial))) return res.sendStatus(404)
  const { rows } = await query(
    `INSERT INTO wallet_apple_devices (device_id, serial, push_token) VALUES ($1, $2, $3)
     ON CONFLICT (device_id, serial) DO UPDATE SET push_token = EXCLUDED.push_token
     RETURNING (xmax = 0) AS created`,
    [device, serial, pushToken],
  )
  return res.sendStatus(rows[0]?.created ? 201 : 200)
}))

// Which of this phone's passes changed since the tag it last saw.
ws.get('/v1/devices/:device/registrations/:type', safe(async (req, res) => {
  const { device, type } = req.params
  if (!ourType(type) || !ID.test(device)) return res.sendStatus(400)
  const since = Number(req.query.passesUpdatedSince) || 0
  const { rows } = await query(
    `SELECT c.serial, c.updated_at FROM wallet_apple_devices d JOIN wallet_cards c ON c.serial = d.serial
      WHERE d.device_id = $1 AND date_trunc('second', c.updated_at) > to_timestamp($2)`,
    [device, since],
  )
  if (!rows.length) return res.sendStatus(204)
  const newest = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), rows[0].updated_at)
  return res.json({ serialNumbers: rows.map((r) => r.serial), lastUpdated: tag(newest) })
}))

// The newest version of a pass.
ws.get('/v1/passes/:type/:serial', safe(async (req, res) => {
  const { type, serial } = req.params
  if (!ourType(type)) return res.sendStatus(400)
  if (!appleAuthOk(serial, req.get('authorization'))) return res.sendStatus(401)
  const card = await cardBySerial(serial)
  if (!card) return res.sendStatus(404)
  const since = Date.parse(req.get('if-modified-since') || '')
  const updated = new Date(card.updated_at)
  if (since && Math.floor(updated.getTime() / 1000) <= Math.floor(since / 1000)) return res.sendStatus(304)
  const pass = await applePass(card.user_id)
  if (!pass) return res.sendStatus(404)
  res.set('Content-Type', 'application/vnd.apple.pkpass')
  res.set('Last-Modified', updated.toUTCString())
  res.set('Cache-Control', 'no-store')
  return res.send(pass)
}))

// The phone removed the pass.
ws.delete('/v1/devices/:device/registrations/:type/:serial', safe(async (req, res) => {
  const { device, type, serial } = req.params
  if (!ourType(type) || !ID.test(device)) return res.sendStatus(400)
  if (!appleAuthOk(serial, req.get('authorization'))) return res.sendStatus(401)
  await query('DELETE FROM wallet_apple_devices WHERE device_id = $1 AND serial = $2', [device, serial])
  return res.sendStatus(200)
}))

// Apple's error log for the web service: kept short in our own log.
ws.post('/v1/log', (req, res) => {
  const logs = Array.isArray(req.body?.logs) ? req.body.logs.slice(0, 5) : []
  for (const l of logs) console.warn('apple wallet log:', String(l).slice(0, 300))
  res.sendStatus(200)
})

router.use('/apple-ws', wsLimiter, requireDb, (_req, res, next) => (appleWalletConfigured() ? next() : res.sendStatus(404)), ws)

export default router
