import rateLimit from 'express-rate-limit'
import { timingSafeEqual } from 'crypto'

// Shared-secret auth for cron entrypoints hit by GitHub Actions. The global
// `authenticate` middleware is soft (never rejects), so these routes would be
// public without an explicit check — the x-cron-key header is the credential.
// Compared in constant time so response timing can't leak the secret.
// Returns null on success, or { code, error } to send back.
export function checkCronKey(req) {
  const secret = process.env.CRON_SECRET
  if (!secret) return { code: 503, error: 'CRON_SECRET is not configured.' }
  const provided = Buffer.from(String(req.get('x-cron-key') || ''))
  const expected = Buffer.from(secret)
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { code: 401, error: 'Not authorized.' }
  }
  return null
}

// Middleware form of checkCronKey.
export function requireCronKey(req, res, next) {
  const denied = checkCronKey(req)
  if (denied) return res.status(denied.code).json({ error: denied.error })
  next()
}

// The busiest schedule is every 15 minutes, so a legitimate caller makes a
// handful of requests per window; anything more is guessing at the secret.
export function cronLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
  })
}
