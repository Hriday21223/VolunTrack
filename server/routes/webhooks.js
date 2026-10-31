// Managing webhooks (#622, part 3) from Settings. Sending is server/webhooks.js.
import express from 'express'
import rateLimit from 'express-rate-limit'
import { hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { keyOwnerFor } from '../apiKeys.js'
import {
  WEBHOOK_EVENTS, WebhookError, listEndpoints, createEndpoint, updateEndpoint, deleteEndpoint,
  listDeliveries, sendTestEvent, resendDelivery,
} from '../webhooks.js'

const router = express.Router()
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please try again later.' } }))
router.use((_req, res, next) => (hasDatabase() ? next() : res.status(503).json({ error: 'Server database is not configured.' })))
router.use(requireAuth('school', 'org', 'volunteer'))
// Same owners as API keys: a school's main admin, an organization, an organizer.
router.use(async (req, res, next) => {
  try {
    req.owner = await keyOwnerFor(req.auth)
    if (!req.owner) return res.status(403).json({ error: 'This account can’t use webhooks.' })
    next()
  } catch (error) { next(error) }
})

const run = (fn) => async (req, res) => {
  try { await fn(req, res) } catch (error) {
    if (error instanceof WebhookError) return res.status(error.status).json({ error: error.message })
    console.error('webhook settings failed:', error.message)
    return res.status(500).json({ error: 'Could not update your webhooks.' })
  }
}

router.get('/', run(async (req, res) => res.json({ endpoints: await listEndpoints(req.owner), events: WEBHOOK_EVENTS[req.owner.ownerType] })))
// POST { url, events } → { endpoint, secret }; the secret is shown once.
router.post('/', run(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.status(201).json(await createEndpoint(req.owner, req.auth.sub, req.body || {}))
}))
router.patch('/:id', run(async (req, res) => res.json({ endpoint: await updateEndpoint(req.owner, req.params.id, req.body || {}) })))
router.delete('/:id', run(async (req, res) => { await deleteEndpoint(req.owner, req.params.id); res.json({ ok: true }) }))
router.get('/:id/deliveries', run(async (req, res) => res.json({ deliveries: await listDeliveries(req.owner, req.params.id) })))
router.post('/:id/test', run(async (req, res) => res.json(await sendTestEvent(req.owner, req.params.id))))
router.post('/deliveries/:id/resend', run(async (req, res) => res.json(await resendDelivery(req.owner, req.params.id))))

export default router
