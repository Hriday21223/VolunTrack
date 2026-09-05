import express from 'express'
import rateLimit from 'express-rate-limit'
import validator from 'validator'
import bcrypt from 'bcryptjs'
import * as OTPAuth from 'otpauth'
import crypto from 'crypto'
import { query, hasDatabase } from '../db.js'
import { uid } from '../ids.js'
import { hashPassword, verifyPassword, signToken, signTempToken, verifyTempToken, requireAuth,
         signEnrollmentToken, requireAuthOrEnrollment, mfaRequiredForRole } from '../auth.js'
import { verifyTurnstile } from '../turnstile.js'
import { sendWelcomeEmail } from '../email.js'

const router = express.Router()

// Consecutive wrong TOTP codes before an account is briefly locked.
const TOTP_MAX_ATTEMPTS = 8

// Rate limit auth endpoints to prevent brute force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.' },
})

// Input validation helpers
function validateEmail(email) {
  const trimmed = email.trim().toLowerCase()
  if (!validator.isEmail(trimmed)) {
    return null
  }
  // Additional length check to prevent excessively long emails
  if (trimmed.length > 254) {
    return null
  }
  return trimmed
}

function validateName(name) {
  const trimmed = name.trim()
  // Allow letters, spaces, hyphens, apostrophes - common in names
  if (!validator.isLength(trimmed, { min: 1, max: 100 })) {
    return null
  }
  if (!/^[\p{L}\s\-''.]+$/u.test(trimmed)) {
    return null
  }
  return trimmed
}

function validatePassword(password) {
  if (!validator.isLength(password, { min: 8, max: 128 })) {
    return null
  }
  return password
}

function validateGrade(grade) {
  if (!grade) return null
  const trimmed = grade.trim()
  if (!validator.isLength(trimmed, { max: 20 })) {
    return null
  }
  return trimmed
}

function validateStudentIdNumber(id) {
  if (!id) return null
  const trimmed = id.trim()
  if (!validator.isLength(trimmed, { max: 40 })) {
    return null
  }
  return trimmed
}

function validateSyncPin(pin) {
  if (!pin) return null
  const trimmed = pin.trim()
  if (!/^\d{5}$/.test(trimmed)) {
    return null
  }
  return trimmed
}

export function publicUser(row) {
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    email: row.email,
    schoolId: row.school_id,
    schoolPaymentStatus: row.school_payment_status ?? null,
    grade: row.grade,
    studentIdNumber: row.student_id_number,
    syncPin: row.sync_pin,
    totpEnabled: row.totp_enabled,
    // Non-null means this account must enrol in MFA by that date; the UI uses
    // it to nag during the grace window.
    mfaRequiredAt: row.mfa_required_at ?? null,
    createdAt: row.created_at,
  }
}

export const USER_WITH_SCHOOL_SELECT = `
  SELECT u.*, s.payment_status AS school_payment_status
  FROM users u LEFT JOIN schools s ON s.id = u.school_id
`

function requireDb(_req, res, next) {
  if (!hasDatabase()) {
    return res.status(503).json({ error: 'Server database is not configured.' })
  }
  next()
}

router.post('/register', authLimiter, requireDb, verifyTurnstile(), async (req, res) => {
  const name = validateName(req.body.name || '')
  const email = validateEmail(req.body.email || '')
  const password = validatePassword(req.body.password || '')
  const grade = validateGrade(req.body.grade || '')
  const studentIdNumber = validateStudentIdNumber(req.body.studentIdNumber || '')
  const role = ['volunteer', 'parent'].includes(req.body.role) ? req.body.role : 'student'

  if (!name) {
    return res.status(400).json({ error: 'Name is required and must be valid.' })
  }
  if (!email) {
    return res.status(400).json({ error: 'Enter a valid email address.' })
  }
  if (!password) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' })
  }

  try {
    const existing = await query('SELECT 1 FROM users WHERE email = $1', [email])
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'An account with that email already exists.' })
    }
    const hash = await hashPassword(password)
    const id = uid('usr')
    const { rows } = await query(
      `INSERT INTO users (id, role, name, email, password_hash, grade, student_id_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, role, name, email, hash, grade || null, studentIdNumber || null],
    )
    const user = publicUser(rows[0])
    await sendWelcomeEmail({ to: user.email, name: user.name })
    return res.status(201).json({ token: signToken(user), user })
  } catch (error) {
    console.error('register failed:', error)
    return res.status(500).json({ error: 'Could not create account.' })
  }
})

router.post('/login', authLimiter, requireDb, async (req, res) => {
  const email = validateEmail(req.body.email || '')
  const password = validatePassword(req.body.password || '')

  if (!email) {
    return res.status(400).json({ error: 'Enter a valid email address.' })
  }
  if (!password) {
    return res.status(400).json({ error: 'Password is required.' })
  }

  try {
    const { rows } = await query(`${USER_WITH_SCHOOL_SELECT} WHERE u.email = $1`, [email])
    const row = rows[0]
    const ok = row && (await verifyPassword(password, row.password_hash))
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password.' })
    }
    const user = publicUser(row)
    if (row.totp_enabled) {
      return res.json({ requiresTotp: true, tempToken: signTempToken(user) })
    }

    // Privileged roles must have TOTP. SSO accounts are exempt: they hold no
    // VolunTrack password, so MFA belongs to their school's IdP, and an
    // enrolment flow they cannot complete would just lock them out.
    const needsMfa = mfaRequiredForRole(row.role) && row.auth_provider !== 'sso'
    if (needsMfa && row.mfa_required_at) {
      const deadline = new Date(row.mfa_required_at)
      if (deadline <= new Date()) {
        // Past the deadline: hand back a token that opens only the two
        // enrolment routes, never a session.
        return res.json({
          requiresMfaEnrollment: true,
          enrollmentToken: signEnrollmentToken(user),
          deadline: row.mfa_required_at,
          user,
        })
      }
      // Still in the grace window — sign in, but tell the client to nag.
      return res.json({ token: signToken(user), user, mfaEnrollmentDue: row.mfa_required_at })
    }

    return res.json({ token: signToken(user), user })
  } catch (error) {
    console.error('login failed:', error)
    return res.status(500).json({ error: 'Could not sign in.' })
  }
})

router.get('/me', requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query(`${USER_WITH_SCHOOL_SELECT} WHERE u.id = $1`, [req.auth.sub])
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' })
    return res.json({ user: publicUser(rows[0]) })
  } catch (error) {
    console.error('me failed:', error)
    return res.status(500).json({ error: 'Could not load account.' })
  }
})

// Update the caller's own profile fields — narrow on purpose: name, grade,
// and student ID number only. School linking has its own dedicated flow
// (join codes / invites in server/routes/school.js) and isn't touched here.
router.patch('/profile', requireDb, requireAuth(), async (req, res) => {
  const name = req.body.name !== undefined ? validateName(req.body.name || '') : undefined
  if (req.body.name !== undefined && !name) {
    return res.status(400).json({ error: 'Name is required and must be valid.' })
  }
  const grade = req.body.grade !== undefined ? validateGrade(req.body.grade || '') : undefined
  const studentIdNumber = req.body.studentIdNumber !== undefined ? validateStudentIdNumber(req.body.studentIdNumber || '') : undefined

  try {
    await query(
      `UPDATE users SET
         name = COALESCE($1, name),
         grade = CASE WHEN $2::boolean THEN $3 ELSE grade END,
         student_id_number = CASE WHEN $4::boolean THEN $5 ELSE student_id_number END
       WHERE id = $6`,
      [name || null, grade !== undefined, grade || null, studentIdNumber !== undefined, studentIdNumber || null, req.auth.sub],
    )
    const { rows } = await query(`${USER_WITH_SCHOOL_SELECT} WHERE u.id = $1`, [req.auth.sub])
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' })
    return res.json({ user: publicUser(rows[0]) })
  } catch (error) {
    console.error('profile update failed:', error)
    return res.status(500).json({ error: 'Could not update profile.' })
  }
})

// Change password (requires current password for verification)
router.put('/password', requireDb, requireAuth(), async (req, res) => {
  const currentPassword = req.body.currentPassword
  const newPassword = validatePassword(req.body.newPassword || '')

  if (!currentPassword) {
    return res.status(400).json({ error: 'Current password is required.' })
  }
  if (!newPassword) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' })
  }

  try {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.auth.sub])
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' })

    const ok = await verifyPassword(currentPassword, rows[0].password_hash)
    if (!ok) return res.status(403).json({ error: 'Current password is incorrect.' })

    const hash = await hashPassword(newPassword)
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.auth.sub])

    const user = publicUser({ ...rows[0], password_hash: hash })
    return res.json({ ok: true, user })
  } catch (error) {
    console.error('password change failed:', error)
    return res.status(500).json({ error: 'Could not update password.' })
  }
})

// Set or update sync PIN
router.put('/sync-pin', requireDb, requireAuth(), async (req, res) => {
  const syncPin = validateSyncPin(req.body.syncPin || '')
  
  if (!syncPin) {
    return res.status(400).json({ error: 'Sync PIN must be exactly 5 digits.' })
  }

  try {
    // Check if PIN is already taken by another user
    const existing = await query('SELECT 1 FROM users WHERE sync_pin = $1 AND id != $2', [syncPin, req.auth.sub])
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'This sync PIN is already in use.' })
    }

    const { rows } = await query(
      'UPDATE users SET sync_pin = $1 WHERE id = $2 RETURNING *',
      [syncPin, req.auth.sub]
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' })
    return res.json({ user: publicUser(rows[0]) })
  } catch (error) {
    console.error('sync-pin update failed:', error)
    return res.status(500).json({ error: 'Could not update sync PIN.' })
  }
})

// Set sync PIN using email + password (no JWT required — for users whose
// browser session doesn't have a token due to localStorage-only login).
router.post('/sync-pin-auth', authLimiter, requireDb, async (req, res) => {
  const email = validateEmail(req.body.email || '')
  const password = req.body.password
  const syncPin = validateSyncPin(req.body.syncPin || '')

  if (!email) return res.status(400).json({ error: 'Enter a valid email address.' })
  if (!password) return res.status(400).json({ error: 'Password is required.' })
  if (!syncPin) return res.status(400).json({ error: 'Sync PIN must be exactly 5 digits.' })

  try {
    const { rows } = await query('SELECT * FROM users WHERE email = $1', [email])
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' })

    const ok = await verifyPassword(password, rows[0].password_hash)
    if (!ok) return res.status(403).json({ error: 'Password is incorrect.' })

    const existing = await query('SELECT 1 FROM users WHERE sync_pin = $1 AND id != $2', [syncPin, rows[0].id])
    if (existing.rowCount > 0) return res.status(409).json({ error: 'This sync PIN is already in use.' })

    const { rows: updated } = await query(
      'UPDATE users SET sync_pin = $1 WHERE id = $2 RETURNING *',
      [syncPin, rows[0].id]
    )
    const user = publicUser(updated[0])
    return res.json({ token: signToken(user), user })
  } catch (error) {
    console.error('sync-pin-auth failed:', error)
    return res.status(500).json({ error: 'Could not update sync PIN.' })
  }
})

// Login with sync PIN (for mobile app sync)
router.post('/sync-login', authLimiter, requireDb, async (req, res) => {
  const syncPin = validateSyncPin(req.body.syncPin || '')
  
  if (!syncPin) {
    return res.status(400).json({ error: 'Sync PIN must be exactly 5 digits.' })
  }

  try {
    const { rows } = await query('SELECT * FROM users WHERE sync_pin = $1', [syncPin])
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid sync PIN.' })
    }
    const user = publicUser(rows[0])
    // Clear the sync PIN so it can't be reused
    await query('UPDATE users SET sync_pin = NULL WHERE id = $1', [rows[0].id])
    return res.json({ token: signToken(user), user })
  } catch (error) {
    console.error('sync-login failed:', error)
    return res.status(500).json({ error: 'Could not sign in with sync PIN.' })
  }
})

// Grant admin role to the ADMIN_EMAIL user (self-service promotion)
router.post('/grant-admin', authLimiter, requireDb, requireAuth(), async (req, res) => {
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase()
  if (!adminEmail) return res.status(500).json({ error: 'ADMIN_EMAIL not configured.' })
  if (req.auth.email !== adminEmail) return res.status(403).json({ error: 'Not allowed.' })
  try {
    await query('UPDATE users SET role = $1 WHERE id = $2 AND email = $3', ['admin', req.auth.sub, adminEmail])
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.auth.sub])
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' })
    const user = publicUser(rows[0])
    return res.json({ token: signToken(user), user })
  } catch (error) {
    console.error('grant-admin failed:', error)
    return res.status(500).json({ error: 'Could not grant admin role.' })
  }
})

// ---------------------------------------------------------------------------
// TOTP Two-Factor Authentication
// ---------------------------------------------------------------------------

function generateBackupCodes(count = 10) {
  const codes = []
  for (let i = 0; i < count; i++) {
    codes.push(crypto.randomBytes(4).toString('hex'))
  }
  return codes
}

async function hashBackupCodes(codes) {
  const hashed = []
  for (const code of codes) {
    hashed.push(await bcrypt.hash(code, 10))
  }
  return JSON.stringify(hashed)
}

// POST /api/auth/totp/setup — generate secret + backup codes (not yet enabled)
router.post('/totp/setup', authLimiter, requireDb, requireAuthOrEnrollment, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.auth.sub])
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' })
    const row = rows[0]
    if (row.totp_enabled) {
      return res.status(400).json({ error: '2FA is already enabled. Disable it first.' })
    }

    const totp = new OTPAuth.TOTP({
      issuer: 'VolunTrack',
      label: row.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: new OTPAuth.Secret({ size: 20 }),
    })

    const uri = totp.toString()
    const secretBase32 = totp.secret.base32

    const backupCodes = generateBackupCodes(10)
    const hashed = await hashBackupCodes(backupCodes)

    // Store the secret temporarily (not enabled yet)
    await query(
      'UPDATE users SET totp_secret = $1, backup_codes = $2 WHERE id = $3',
      [secretBase32, hashed, req.auth.sub],
    )

    return res.json({ secret: secretBase32, uri, backupCodes })
  } catch (error) {
    console.error('totp setup failed:', error)
    return res.status(500).json({ error: 'Could not set up 2FA.' })
  }
})

// POST /api/auth/totp/verify-setup — confirm a code to enable 2FA
router.post('/totp/verify-setup', authLimiter, requireDb, requireAuthOrEnrollment, async (req, res) => {
  const code = String(req.body.code || '').trim()
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Enter a 6-digit code.' })
  }

  try {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.auth.sub])
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' })
    const row = rows[0]
    if (row.totp_enabled) {
      return res.status(400).json({ error: '2FA is already enabled.' })
    }
    if (!row.totp_secret) {
      return res.status(400).json({ error: 'No 2FA setup in progress. Run /totp/setup first.' })
    }

    const totp = new OTPAuth.TOTP({
      issuer: 'VolunTrack',
      label: row.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(row.totp_secret),
    })

    const delta = totp.validate({ token: code, window: 1 })
    if (delta === null) {
      return res.status(401).json({ error: 'Invalid code. Try again.' })
    }

    // Enrolment satisfied, so the deadline no longer applies.
    await query('UPDATE users SET totp_enabled = true, mfa_required_at = NULL WHERE id = $1', [req.auth.sub])
    // Reflect the write: `row` predates the UPDATE, so spreading it alone
    // would hand the client a deadline that no longer exists and leave the
    // UI nagging about enrolment the user has just completed.
    const enabled = publicUser({ ...row, totp_enabled: true, mfa_required_at: null })

    // A user who got here on an enrolment token has no session yet — issuing
    // one now is what makes the forced-enrolment path usable instead of a
    // dead end. They have just proven possession of the TOTP secret.
    if (req.enrolling) {
      return res.json({ ok: true, user: enabled, token: signToken(enabled) })
    }
    return res.json({ ok: true, user: enabled })
  } catch (error) {
    console.error('totp verify-setup failed:', error)
    return res.status(500).json({ error: 'Could not verify 2FA code.' })
  }
})

// POST /api/auth/totp/challenge — verify TOTP during login (uses temp token)
router.post('/totp/challenge', authLimiter, requireDb, async (req, res) => {
  const { tempToken, code } = req.body
  if (!tempToken || typeof tempToken !== 'string') {
    return res.status(400).json({ error: 'Missing temporary token.' })
  }
  if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
    return res.status(400).json({ error: 'Enter a 6-digit code.' })
  }

  const payload = verifyTempToken(tempToken)
  if (!payload) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' })
  }

  try {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [payload.sub])
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' })
    const row = rows[0]

    if (!row.totp_enabled || !row.totp_secret) {
      return res.status(400).json({ error: '2FA is not enabled on this account.' })
    }

    // Bound to the account, not the IP: 6 digits is only ~1e6 possibilities,
    // which a botnet spreading attempts across addresses would walk through
    // while staying under any per-IP limit.
    if (row.totp_locked_until && new Date(row.totp_locked_until) > new Date()) {
      return res.status(429).json({ error: 'Too many incorrect codes. Try again in a few minutes.' })
    }

    const totp = new OTPAuth.TOTP({
      issuer: 'VolunTrack',
      label: row.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(row.totp_secret),
    })

    const delta = totp.validate({ token: code.trim(), window: 1 })
    if (delta === null) {
      const attempts = (row.totp_failed_attempts || 0) + 1
      // Explicit casts: $2 is both assigned to an integer column and compared,
      // and without them Postgres fails with "inconsistent types deduced for
      // parameter $2" — which a swallowed error would turn into a lockout
      // that silently never engages.
      await query(
        `UPDATE users
            SET totp_failed_attempts = $2::int,
                totp_locked_until = CASE WHEN $2::int >= $3::int
                                         THEN now() + interval '15 minutes'
                                         ELSE totp_locked_until END
          WHERE id = $1`,
        [row.id, attempts, TOTP_MAX_ATTEMPTS],
      ).catch((e) => console.error('totp lockout update failed:', e.message))
      return res.status(401).json({ error: 'Invalid code. Try again.' })
    }

    // Success clears the counter, so a user who fumbles a code then gets it
    // right isn't left one mistake away from a lockout.
    await query(
      'UPDATE users SET totp_failed_attempts = 0, totp_locked_until = NULL WHERE id = $1',
      [row.id],
    ).catch((e) => console.error('totp counter reset failed:', e.message))

    const user = publicUser(row)
    return res.json({ token: signToken(user), user })
  } catch (error) {
    console.error('totp challenge failed:', error)
    return res.status(500).json({ error: 'Could not verify code.' })
  }
})

// POST /api/auth/totp/disable — disable 2FA (requires password)
router.post('/totp/disable', authLimiter, requireDb, requireAuth(), async (req, res) => {
  const password = req.body.password
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Password is required to disable 2FA.' })
  }

  try {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.auth.sub])
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' })
    const row = rows[0]

    if (!row.totp_enabled) {
      return res.status(400).json({ error: '2FA is not enabled.' })
    }

    const ok = await verifyPassword(password, row.password_hash)
    if (!ok) return res.status(403).json({ error: 'Incorrect password.' })

    // Turning MFA off on a privileged account must re-arm the requirement,
    // not silently exempt it forever. A short window, since this account was
    // already enrolled and is choosing to step back.
    const rearm = mfaRequiredForRole(row.role) && row.auth_provider !== 'sso'
    await query(
      `UPDATE users
          SET totp_enabled = false, totp_secret = NULL, backup_codes = NULL,
              mfa_required_at = CASE WHEN $2 THEN now() + interval '7 days' ELSE NULL END
        WHERE id = $1`,
      [req.auth.sub, rearm],
    )
    const updated = { ...row, totp_enabled: false, totp_secret: null, backup_codes: null }
    return res.json({ ok: true, user: publicUser(updated) })
  } catch (error) {
    console.error('totp disable failed:', error)
    return res.status(500).json({ error: 'Could not disable 2FA.' })
  }
})

// POST /api/auth/totp/backup-recovery — use a backup code in place of the
// TOTP code during login. Like /totp/challenge, this requires a valid
// tempToken from a successful password login: a backup code only ever
// substitutes for the second factor, never for the password.
router.post('/totp/backup-recovery', authLimiter, requireDb, async (req, res) => {
  const { tempToken } = req.body
  const code = String(req.body.code || '').trim().toLowerCase()

  if (!tempToken || typeof tempToken !== 'string') {
    return res.status(400).json({ error: 'Session expired. Please log in again.' })
  }
  if (!code) return res.status(400).json({ error: 'Backup code is required.' })

  const payload = verifyTempToken(tempToken)
  if (!payload) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' })
  }

  try {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [payload.sub])
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' })
    const row = rows[0]

    if (!row.totp_enabled || !row.backup_codes) {
      return res.status(400).json({ error: '2FA is not enabled on this account.' })
    }

    const hashedCodes = JSON.parse(row.backup_codes)
    let matchedIndex = -1

    for (let i = 0; i < hashedCodes.length; i++) {
      if (await bcrypt.compare(code, hashedCodes[i])) {
        matchedIndex = i
        break
      }
    }

    if (matchedIndex === -1) {
      return res.status(401).json({ error: 'Invalid backup code.' })
    }

    // Remove the used backup code
    hashedCodes.splice(matchedIndex, 1)
    await query('UPDATE users SET backup_codes = $1 WHERE id = $2', [JSON.stringify(hashedCodes), row.id])

    const user = publicUser(row)
    return res.json({ token: signToken(user), user })
  } catch (error) {
    console.error('totp backup-recovery failed:', error)
    return res.status(500).json({ error: 'Could not verify backup code.' })
  }
})

export default router
