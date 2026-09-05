import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

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

// Attaches req.auth = { sub, role, email } when a valid token is present.
// Rejects temp tokens (purpose: 'totp') — those are only for TOTP challenge.
export function authenticate(req, _res, next) {
  const token = bearer(req)
  if (!token) { req.auth = null; return next() }
  const payload = verifyToken(token)
  if (payload && payload.purpose) { req.auth = null; return next() }
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
