// Wallet card routes (#716): see server/wallet.js.
import express from 'express'
import rateLimit from 'express-rate-limit'
import { hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { appleWalletConfigured, googleWalletConfigured, googleSaveUrl, applePass, appleLinkToken, userFromLinkToken } from '../wallet.js'

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

export default router
