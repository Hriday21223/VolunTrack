import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { query, hasDatabase } from './db.js'

const SALT_ROUNDS = 10
const TOKEN_TTL = '30d'

function secret() {
  const s = process.env.JWT_SECRET
  if (!s) {
    // Refuse to mint tokens with a default secret in production.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET is required in production.')
    }
    return 'dev-insecure-secret'
  }
  return s
}

export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export async function verifyPassword(password, hash) {
  if (!hash) return false
  return bcrypt.compare(password, hash)
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    secret(),
    { expiresIn: TOKEN_TTL },
  )
}

export function signTempToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email, purpose: 'totp' },
    secret(),
    { expiresIn: '5m' },
  )
}

export function verifyTempToken(token) {
  try {
    const payload = jwt.verify(token, secret())
    if (payload.purpose !== 'totp') return null
    return payload
  } catch {
    return null
  }
}

// Issued when a privileged account is past its MFA deadline but has no TOTP
// configured. It is deliberately NOT a session: authenticate() rejects any
// token carrying a `purpose`, so this only opens the two enrolment routes
// that explicitly opt in via requireEnrollmentToken().
export function signEnrollmentToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email, purpose: 'mfa_enroll' },
    secret(),
    { expiresIn: '20m' },
  )
}

export function verifyEnrollmentToken(token) {
  try {
    const payload = jwt.verify(token, secret())
    if (payload.purpose !== 'mfa_enroll') return null
    return payload
  } catch {
    return null
  }
}

// Accepts either a normal session (already on req.auth) or an enrolment
// token. Only the TOTP setup routes may use this — anything else must stay
// behind requireAuth, or the enrolment token would become a full session.
export function requireAuthOrEnrollment(req, res, next) {
  if (req.auth) return next()
  const header = req.headers.authorization || ''
  const [scheme, token] = header.split(' ')
  const payload = scheme === 'Bearer' && token ? verifyEnrollmentToken(token) : null
  if (!payload) return res.status(401).json({ error: 'Authentication required.' })
  req.auth = { sub: payload.sub, role: payload.role, email: payload.email }
  req.enrolling = true
  next()
}

// Roles whose access is broad enough that a phished password alone is not an
// acceptable control: admin reaches every tenant, school/org can read student
// documents and repoint where proof files are stored.
export const MFA_REQUIRED_ROLES = ['admin', 'school', 'school_staff', 'org']

export function mfaRequiredForRole(role) {
  return MFA_REQUIRED_ROLES.includes(role)
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, secret())
  } catch {
    return null
  }
}

function bearer(req) {
  const header = req.headers.authorization || ''
  const [scheme, token] = header.split(' ')
  return scheme === 'Bearer' && token ? token : null
}

// A JWT cannot be recalled once issued, so each account carries a cutoff:
// tokens older than it are refused. Cached briefly so a normal request costs
// no extra query; endSessions() updates the cache in the same step it writes.
const CUTOFF_TTL_MS = 60 * 1000
const cutoffCache = new Map()

async function sessionCutoffSeconds(userId) {
  const hit = cutoffCache.get(userId)
  if (hit && Date.now() - hit.at < CUTOFF_TTL_MS) return hit.seconds
  const { rows } = await query(
    'SELECT EXTRACT(EPOCH FROM sessions_valid_after) AS cutoff FROM users WHERE id = $1',
    [userId],
  )
  const seconds = rows[0]?.cutoff ? Math.floor(Number(rows[0].cutoff)) : 0
  cutoffCache.set(userId, { seconds, at: Date.now() })
  return seconds
}

// Signs every existing session for this account out. Call it before issuing
// the replacement token: `iat` is whole seconds, so a token minted in the same
// second as the cutoff still passes.
export async function endSessions(userId) {
  const { rows } = await query(
    `UPDATE users SET sessions_valid_after = date_trunc('second', now()) WHERE id = $1
     RETURNING EXTRACT(EPOCH FROM sessions_valid_after) AS cutoff`,
    [userId],
  )
  if (rows[0]) cutoffCache.set(userId, { seconds: Math.floor(Number(rows[0].cutoff)), at: Date.now() })
}

// Attaches req.auth = { sub, role, email } when a valid token is present.
// Rejects temp tokens (purpose: 'totp') — those are only for TOTP challenge.
export async function authenticate(req, _res, next) {
  const token = bearer(req)
  if (!token) { req.auth = null; return next() }
  const payload = verifyToken(token)
  if (payload && payload.purpose) { req.auth = null; return next() }
  if (payload && hasDatabase()) {
    try {
      if ((payload.iat || 0) < (await sessionCutoffSeconds(payload.sub))) { req.auth = null; return next() }
    } catch (error) {
      // A database blip must not sign everyone out; the token itself is valid.
      console.error('session cutoff check failed:', error.message)
    }
  }
  req.auth = payload
  next()
}

// Gate a route behind a valid token, optionally restricted to roles.
export function requireAuth(...roles) {
  return (req, res, next) => {
    if (!req.auth) return res.status(401).json({ error: 'Authentication required.' })
    if (roles.length && !roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'Not allowed.' })
    }
    next()
  }
}
