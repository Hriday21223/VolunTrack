// Sign in with Google or Apple (#661), for students, volunteers and parents.
// Off unless its keys are set:
//   Google: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET
//   Apple:  APPLE_SERVICE_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (the .p8 text)
// Redirect URI to register with each provider: <API>/api/auth/social/callback
//
// Flow: /:provider/start redirects to the provider (PKCE, state, nonce). The
// callback checks the ID token and then:
//   - an identity seen before → that account;
//   - else an account with the same, provider-verified email → linked, if it's
//     a student, volunteer or parent account with no two-step sign-in (anything
//     else signs in with its password, so a second factor is never skipped);
//   - else a new person → back to Register with a short-lived ticket, so they
//     still pick an account type and give a date of birth (age rules apply).
// The SPA gets a single-use code (the school SSO handoff, /api/auth/sso/exchange),
// never a token in the URL.
import express from 'express'
import rateLimit from 'express-rate-limit'
import { createHash, randomBytes } from 'crypto'
import * as oidc from 'openid-client'
import { SignJWT, importPKCS8 } from 'jose'
import { query, hasDatabase } from '../db.js'
import { uid, generateToken } from '../ids.js'

const router = express.Router()
router.use(express.urlencoded({ extended: false, limit: '20kb' }))
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please try again later.' } })
const requireDb = (_req, res, next) => (hasDatabase() ? next() : res.status(503).json({ error: 'Server database is not configured.' }))

const STATE_TTL_MS = 10 * 60 * 1000
const TICKET_TTL_MS = 30 * 60 * 1000
const CODE_TTL_MS = 60 * 1000
const SOCIAL_ROLES = ['student', 'volunteer', 'parent']
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')

export function socialProviders() {
  const env = process.env
  return {
    google: Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET),
    apple: Boolean(env.APPLE_SERVICE_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY),
  }
}

function apiBase(req) {
  return (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
}
function frontendUrl() {
  const first = (process.env.FRONTEND_URL || '').split(',').map((s) => s.trim()).find(Boolean)
  return (first || 'https://volunteer-track-two.vercel.app').replace(/\/$/, '')
}
const safeReturnTo = (v) => (typeof v === 'string' && /^\/(?!\/)[\w\-/?=&%.]*$/.test(v) ? v : '/dashboard')
function fail(res, message) {
  const u = new URL(`${frontendUrl()}/login`)
  u.searchParams.set('sso_error', message)
  return res.redirect(u.href)
}

// Apple's client secret is a short-lived JWT signed with the team's key.
async function appleClientSecret() {
  const key = await importPKCS8(String(process.env.APPLE_PRIVATE_KEY).replace(/\\n/g, '\n'), 'ES256')
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: process.env.APPLE_KEY_ID })
    .setIssuer(process.env.APPLE_TEAM_ID)
    .setAudience('https://appleid.apple.com')
    .setSubject(process.env.APPLE_SERVICE_ID)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key)
}

const configs = new Map()
async function providerConfig(provider) {
  if (provider === 'google') {
    if (!configs.has('google')) {
      configs.set('google', await oidc.discovery(new URL('https://accounts.google.com'), process.env.GOOGLE_OAUTH_CLIENT_ID, process.env.GOOGLE_OAUTH_CLIENT_SECRET))
    }
    return configs.get('google')
  }
  // Apple: the secret expires, so make a fresh config each time.
  return oidc.discovery(new URL('https://appleid.apple.com'), process.env.APPLE_SERVICE_ID, await appleClientSecret())
}

// GET /api/auth/social/providers → { google, apple }: which buttons to show.
router.get('/providers', (_req, res) => res.json(socialProviders()))

// GET /api/auth/social/:provider/start?returnTo=
router.get('/:provider/start', limiter, requireDb, async (req, res) => {
  const provider = req.params.provider
  if (!['google', 'apple'].includes(provider) || !socialProviders()[provider]) return fail(res, 'That sign-in option isn’t available.')
  try {
    const config = await providerConfig(provider)
    const state = oidc.randomState()
    const nonce = oidc.randomNonce()
    const verifier = oidc.randomPKCECodeVerifier()
    await query(
      'INSERT INTO social_login_states (state, provider, code_verifier, nonce, return_to, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [state, provider, verifier, nonce, safeReturnTo(req.query.returnTo), new Date(Date.now() + STATE_TTL_MS)],
    )
    const params = {
      redirect_uri: `${apiBase(req)}/api/auth/social/callback`,
      scope: 'openid email',
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
    }
    if (provider === 'google') params.prompt = 'select_account'
    if (provider === 'apple') params.response_mode = 'form_post'
    return res.redirect(oidc.buildAuthorizationUrl(config, params).href)
  } catch (error) {
    console.error('social start failed:', error.message)
    return fail(res, 'Could not start sign-in. Please try again.')
  }
})

async function handleCallback(req, res) {
  const state = String(req.query.state || req.body?.state || '')
  if (!state) return fail(res, 'Sign-in failed. Please try again.')
  try {
    const { rows } = await query('DELETE FROM social_login_states WHERE state = $1 RETURNING *', [state])
    const st = rows[0]
    if (!st || new Date(st.expires_at) < new Date()) return fail(res, 'That sign-in took too long. Please try again.')
    const config = await providerConfig(st.provider)
    // Apple posts the code back; rebuild the URL openid-client expects.
    const current = new URL(`${apiBase(req)}/api/auth/social/callback`)
    for (const [k, v] of Object.entries(req.method === 'POST' ? req.body : req.query)) if (typeof v === 'string' && k !== 'user') current.searchParams.set(k, v)
    const tokens = await oidc.authorizationCodeGrant(config, current, { pkceCodeVerifier: st.code_verifier, expectedState: state, expectedNonce: st.nonce })
    const claims = tokens.claims()
    const email = String(claims.email || '').trim().toLowerCase()
    const verified = claims.email_verified === true || claims.email_verified === 'true'
    if (!claims.sub || !email || !verified) return fail(res, 'Your account didn’t share a verified email, so we can’t sign you in with it.')
    const subject = String(claims.sub)

    // 1. Seen before.
    let userId = (await query('SELECT user_id FROM user_social_logins WHERE provider = $1 AND subject = $2', [st.provider, subject])).rows[0]?.user_id
    let user = userId ? (await query('SELECT id, role, totp_enabled, email_otp_enabled, parental_consent_status FROM users WHERE id = $1', [userId])).rows[0] : null

    // 2. Same verified email.
    if (!user) {
      user = (await query('SELECT id, role, totp_enabled, email_otp_enabled, parental_consent_status FROM users WHERE LOWER(email) = $1', [email])).rows[0] || null
      if (user) {
        const { rows: pk } = await query('SELECT 1 FROM passkeys WHERE user_id = $1 LIMIT 1', [user.id]).catch(() => ({ rows: [] }))
        if (!SOCIAL_ROLES.includes(user.role) || user.totp_enabled || user.email_otp_enabled || pk.length) {
          return fail(res, 'An account with this email already exists. Sign in with your password instead.')
        }
        await query('INSERT INTO user_social_logins (provider, subject, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [st.provider, subject, user.id])
      }
    }

    // 3. Someone new: finish on the Register page.
    if (!user) {
      const ticket = generateToken()
      await query(
        'INSERT INTO social_signup_tickets (ticket_hash, provider, subject, email, expires_at) VALUES ($1, $2, $3, $4, $5)',
        [sha(ticket), st.provider, subject, email, new Date(Date.now() + TICKET_TTL_MS)],
      )
      const u = new URL(`${frontendUrl()}/register`)
      u.searchParams.set('social', ticket)
      u.searchParams.set('email', email)
      return res.redirect(u.href)
    }

    // Two-step sign-in or a pending parent approval still apply.
    const { rows: pk } = await query('SELECT 1 FROM passkeys WHERE user_id = $1 LIMIT 1', [user.id]).catch(() => ({ rows: [] }))
    if (!SOCIAL_ROLES.includes(user.role) || user.totp_enabled || user.email_otp_enabled || pk.length) {
      return fail(res, 'This account uses two-step sign-in. Sign in with your password.')
    }
    if (user.parental_consent_status === 'pending') return fail(res, 'A parent needs to approve your account first.')

    const code = generateToken()
    await query('INSERT INTO sso_login_codes (code, user_id, expires_at) VALUES ($1, $2, $3)', [code, user.id, new Date(Date.now() + CODE_TTL_MS)])
    const target = new URL(`${frontendUrl()}/auth/sso/return`)
    target.searchParams.set('code', code)
    target.searchParams.set('returnTo', st.return_to || '/dashboard')
    return res.redirect(target.href)
  } catch (error) {
    console.error('social callback failed:', error.message)
    return fail(res, 'Sign-in failed. Please try again.')
  }
}
router.get('/callback', limiter, requireDb, handleCallback)
router.post('/callback', limiter, requireDb, handleCallback)

/**
 * Spends a sign-up ticket for `email` (used by POST /api/auth/register).
 * → { provider, subject } or null.
 */
export async function useSocialTicket(ticket, email) {
  if (typeof ticket !== 'string' || ticket.length < 20) return null
  const { rows } = await query('DELETE FROM social_signup_tickets WHERE ticket_hash = $1 RETURNING *', [sha(ticket)])
  const t = rows[0]
  if (!t || new Date(t.expires_at) < new Date() || t.email !== String(email).toLowerCase()) return null
  return { provider: t.provider, subject: t.subject }
}

export async function linkSocialLogin(userId, { provider, subject }) {
  await query('INSERT INTO user_social_logins (provider, subject, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [provider, subject, userId])
}

/** A password nobody knows, for accounts made through Google or Apple. */
export const randomPassword = () => `Vt-${randomBytes(18).toString('base64url')}-9a`

export default router
