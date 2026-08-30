// Cloudflare Turnstile verification for public, unauthenticated endpoints.
//
// IP-based rate limiting (express-rate-limit) is the only other guard on the
// public write endpoints, and a bot rotating IPs/proxies sails straight
// through per-IP limits. Turnstile adds a proof-of-humanity check on top.
//
// Entirely opt-in: with TURNSTILE_SECRET_KEY unset the middleware is a no-op,
// so local dev, the client-only demo, and any deployment that hasn't
// configured Turnstile keep working unchanged (same pattern as the optional
// SMTP / optional DATABASE_URL config elsewhere).

const SECRET = process.env.TURNSTILE_SECRET_KEY || ''
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

// A Turnstile token is ~narrow, but Cloudflare doesn't publish a hard cap;
// reject anything absurd before spending a round-trip on it.
const MAX_TOKEN_LENGTH = 4096

export function turnstileConfigured() {
  return Boolean(SECRET)
}

/**
 * Express middleware: verifies the Turnstile token on the request before the
 * route handler runs. The client sends the token as `turnstileToken` in the
 * JSON body (falls back to the widget's native `cf-turnstile-response` field).
 *
 * Responses:
 *   400 — configured but no/oversized token supplied
 *   403 — token rejected by Cloudflare (expired, replayed, forged)
 *   502 — couldn't reach Cloudflare to verify
 */
export function verifyTurnstile() {
  return async function turnstileMiddleware(req, res, next) {
    if (!SECRET) return next()

    const token =
      (req.body && (req.body.turnstileToken || req.body['cf-turnstile-response'])) || ''

    if (!token || typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) {
      return res.status(400).json({ error: 'CAPTCHA verification is required.' })
    }

    try {
      const form = new URLSearchParams()
      form.append('secret', SECRET)
      form.append('response', token)
      // Trust proxy is set (see server.js), so req.ip is the real client IP.
      const ip = req.headers['cf-connecting-ip'] || req.ip
      if (ip) form.append('remoteip', String(ip))

      const response = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      })
      const data = await response.json()

      if (!data.success) {
        return res.status(403).json({ error: 'CAPTCHA verification failed. Please try again.' })
      }
      return next()
    } catch (error) {
      console.error('Turnstile verification request failed:', error)
      return res.status(502).json({ error: 'Could not verify CAPTCHA. Please try again.' })
    }
  }
}
