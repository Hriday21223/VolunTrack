// The public API (#622), /api/v1. Server-to-server only: mounted in server.js
// ahead of the CORS middleware, so no browser page can call it with a key.
// Every request needs an API key (server/apiKeys.js); errors use
// { error: { code, message } }. The data endpoints come in the next parts of
// #622; this part has /me so integrators can check a key.
import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { authenticateApiKey, apiError } from '../apiKeys.js'

const router = express.Router()

router.use((req, res, next) => {
  if (!hasDatabase()) return apiError(res, 503, 'unavailable', 'The API is not available on this server.')
  res.set('Cache-Control', 'no-store')
  next()
})
router.use(express.json({ limit: '256kb' }))
// Per address, before the key check, so guessing keys is slow.
router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1200,
  standardHeaders: false,
  legacyHeaders: false,
  handler: (req, res) => apiError(res, 429, 'rate_limited', 'Too many requests. Try again shortly.'),
}))
router.use(authenticateApiKey)
// Per key, not per IP: an integration on a shared host shouldn't starve another.
router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.apiKey.id,
  handler: (req, res) => apiError(res, 429, 'rate_limited', 'Too many requests for this key. Slow down and try again shortly.'),
}))

// GET /api/v1/me — who this key belongs to and what it may do.
router.get('/me', async (req, res) => {
  const k = req.apiKey
  try {
    let owner = { type: k.ownerType, id: k.ownerId, name: null }
    if (k.ownerType === 'school') owner.name = (await query('SELECT name FROM schools WHERE id = $1', [k.ownerId])).rows[0]?.name ?? null
    else if (k.ownerType === 'organization') owner.name = (await query('SELECT name FROM organizations WHERE id = $1', [k.ownerId])).rows[0]?.name ?? null
    else owner.name = (await query('SELECT name FROM users WHERE id = $1', [k.ownerId])).rows[0]?.name ?? null
    return res.json({ key: { id: k.id, name: k.name, mode: k.mode, scopes: k.scopes }, owner })
  } catch (error) {
    console.error('api v1 me failed:', error)
    return apiError(res, 500, 'server_error', 'Something went wrong.')
  }
})

router.use((req, res) => apiError(res, 404, 'not_found', `No endpoint ${req.method} /api/v1${req.path}.`))

export default router
