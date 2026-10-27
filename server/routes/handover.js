// The new person's side of a handover (#550): open the emailed link, see what
// they're taking over, and accept. No sign-in; the one-time link is the key.
// Starting one lives with the school, organization and admin routes.

import express from 'express'
import rateLimit from 'express-rate-limit'
import { hasDatabase } from '../db.js'
import { handoverInfo, acceptHandover, sendHandoverError } from '../handover.js'

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

router.get('/:token', limiter, requireDb, async (req, res) => {
  try {
    return res.json(await handoverInfo(req.params.token))
  } catch (error) {
    return sendHandoverError(res, error, 'Could not open the invite.')
  }
})

router.post('/:token', limiter, requireDb, async (req, res) => {
  try {
    return res.json(await acceptHandover(req, req.params.token, { password: req.body?.password }))
  } catch (error) {
    return sendHandoverError(res, error, 'Could not accept the invite.')
  }
})

export default router
