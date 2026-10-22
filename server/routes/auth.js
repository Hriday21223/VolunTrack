import express from 'express'
import rateLimit from 'express-rate-limit'
import validator from 'validator'
import bcrypt from 'bcryptjs'
import * as OTPAuth from 'otpauth'
import crypto from 'crypto'
import { query, hasDatabase } from '../db.js'
import { uid, generateToken, generateNumericCode } from '../ids.js'
import { signupPlatform } from '../platform.js'
import { hashPassword, verifyPassword, signToken, signTempToken, verifyTempToken, requireAuth,
         signEnrollmentToken, requireAuthOrEnrollment, mfaRequiredForRole, endSessions } from '../auth.js'
import { isWeakPassword, WEAK_PASSWORD_MESSAGE } from '../validate.js'
import { signInPolicyForEmail } from '../policy.js'
import { verifyTurnstile } from '../turnstile.js'
import { turnstileUnlessMonitor } from '../monitor.js'
import { recordAuditNow, AUDIT } from '../audit.js'
import { sendWelcomeEmail, sendParentConsentEmail, sendSignupCodeEmail, hasEmail, forLog } from '../email.js'
import { hasPasskeys } from '../passkeys.js'
import { checkSignupAge } from '../ageRules.js'
import { EMAIL_LANGUAGES } from '../emailStrings.js'

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

// A sync PIN is the whole credential for POST /sync-login, so it lives only
// long enough to type into the other device (#313). One without an expiry
// was set before this existed and counts as expired.
const SYNC_PIN_TTL_MINUTES = 15

function syncPinLive(row) {
  return Boolean(row.sync_pin && row.sync_pin_expires_at && new Date(row.sync_pin_expires_at) > new Date())
}

// Frees the numbers held by expired PINs, so the uniqueness check doesn't
// refuse a PIN nobody can use any more.
async function clearExpiredSyncPins() {
  await query(
    `UPDATE users SET sync_pin = NULL, sync_pin_expires_at = NULL
      WHERE sync_pin IS NOT NULL AND (sync_pin_expires_at IS NULL OR sync_pin_expires_at <= now())`,
  )
}

const SET_SYNC_PIN = `UPDATE users SET sync_pin = $1, sync_pin_expires_at = now() + interval '${SYNC_PIN_TTL_MINUTES} minutes'
                       WHERE id = $2 RETURNING *`

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
    // Self-declared at sign-up (parent-approved). The app keeps public-facing
    // asks, like the review popup, away from these accounts.
    under13: row.under_13 === true,
    // An expired PIN no longer signs anyone in, so it isn't shown either.
    syncPin: syncPinLive(row) ? row.sync_pin : null,
    syncPinExpiresAt: syncPinLive(row) ? row.sync_pin_expires_at : null,
    totpEnabled: row.totp_enabled,
    // 'sso' accounts have no password, so the UI asks them to confirm
    // sensitive actions (account deletion) a different way.
    authProvider: row.auth_provider ?? 'password',
    // Non-null means this account must enrol in MFA by that date; the UI uses
    // it to nag during the grace window.
    mfaRequiredAt: row.mfa_required_at ?? null,
    // App language last sent by PUT /me/language (null = never), so the app
    // can tell when this device's choice still needs sending.
    language: row.language ?? null,
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

// Checks a self sign-up (student, Volunteer Task Maker or parent). Shared by
// /register/send-code, so a code is only emailed for a sign-up that would
// otherwise succeed, and /register itself. → { error } or the cleaned fields.
function readSignup(body) {
  const name = validateName(body.name || '')
  const email = validateEmail(body.email || '')
  const password = validatePassword(body.password || '')
  const grade = validateGrade(body.grade || '')
  const studentIdNumber = validateStudentIdNumber(body.studentIdNumber || '')
  const role = ['volunteer', 'parent'].includes(body.role) ? body.role : 'student'

  if (!name) return { error: 'Name is required and must be valid.' }
  if (!email) return { error: 'Enter a valid email address.' }
  if (!password) return { error: 'Password must be at least 8 characters.' }
  if (isWeakPassword(password)) return { error: WEAK_PASSWORD_MESSAGE }

  // Every self sign-up gives a date of birth, used only for the age rules in
  // server/ageRules.js and never stored. A student under 13 needs a parent or
  // guardian to approve by email before the account can be used (see
  // parentConsent.js). Only this route asks: a student a school adds, or one
  // arriving through school SSO, is covered by the school's own consent.
  const ageCheck = checkSignupAge(role, body.dateOfBirth)
  if (ageCheck.error) return { error: ageCheck.error }
  // `under13: true` from the form is honoured too: it is set when this device
  // already entered an under-13 date, and it can only make the check stricter.
  const under13 = role === 'student' && (ageCheck.under13 || body.under13 === true)
  const parentEmail = under13 ? validateEmail(body.parentEmail || '') : ''
  if (under13) {
    if (!parentEmail) return { error: "Enter your parent or guardian's email address." }
    if (parentEmail === email) return { error: "Your parent or guardian's email must be different from yours." }
    // Without a way to reach the parent the account could never be unlocked.
    if (!hasEmail()) return { error: 'We cannot send the approval email right now. Please try again later.', status: 503 }
  }
  return { name, email, password, grade, studentIdNumber, role, under13, parentEmail }
}

// The emailed sign-up code (#310): six digits, good for 10 minutes and one
// use, and dead after SIGNUP_CODE_MAX_ATTEMPTS wrong guesses — 5 tries at a
// million values is what makes six digits enough.
const SIGNUP_CODE_TTL_MINUTES = 10
const SIGNUP_CODE_MAX_ATTEMPTS = 5
const SIGNUP_CODE_RESEND_SECONDS = 60

// Under-13 requests nobody approved are not kept: 14 days, then the account
// goes — before the email check, so the address can be used again. Sign-up
// codes go a day after expiring; until then a late entry is told it expired.
async function pruneStaleSignups() {
  await query(
    `DELETE FROM users
      WHERE parental_consent_status = 'pending'
        AND parent_consent_requested_at < now() - interval '${PARENT_CONSENT_TTL_DAYS} days'`,
  ).catch((e) => console.error('pending-consent prune failed:', e.message))
  await query("DELETE FROM signup_codes WHERE expires_at < now() - interval '1 day'")
    .catch((e) => console.error('sign-up code prune failed:', e.message))
}

// Sends the code. This, not /register, carries the CAPTCHA: it is the request
// that makes us email an address, and /register can't succeed without a code
// that came from here.
router.post('/register/send-code', authLimiter, requireDb, verifyTurnstile(), async (req, res) => {
  const signup = readSignup(req.body)
  if (signup.error) return res.status(signup.status || 400).json({ error: signup.error })
  const { email } = signup
  const devLog = !hasEmail() && process.env.NODE_ENV !== 'production'
  if (!hasEmail() && !devLog) {
    return res.status(503).json({ error: 'We cannot send the verification email right now. Please try again later.' })
  }

  try {
    await pruneStaleSignups()
    const existing = await query('SELECT 1 FROM users WHERE email = $1', [email])
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'An account with that email already exists.' })
    }
    const code = generateNumericCode(6)
    const codeHash = await bcrypt.hash(code, 10)
    // The WHERE on the upsert is the resend limit: a row sent less than a
    // minute ago is left alone and nothing comes back.
    const { rowCount } = await query(
      `INSERT INTO signup_codes (email, code_hash, expires_at, attempts, sent_at)
       VALUES ($1, $2, now() + interval '${SIGNUP_CODE_TTL_MINUTES} minutes', 0, now())
       ON CONFLICT (email) DO UPDATE
         SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0, sent_at = now()
         WHERE signup_codes.sent_at < now() - interval '${SIGNUP_CODE_RESEND_SECONDS} seconds'`,
      [email, codeHash],
    )
    if (rowCount === 0) {
      return res.status(429).json({ error: 'We just sent a code. Wait a minute before asking for another.' })
    }
    if (devLog) {
      console.log(`[dev] No email provider configured — sign-up code for ${forLog(email)}: ${code}`)
    } else {
      const sent = await sendSignupCodeEmail({ to: email, code, minutes: SIGNUP_CODE_TTL_MINUTES })
      if (!sent.sent) {
        await query('DELETE FROM signup_codes WHERE email = $1', [email])
        return res.status(502).json({ error: 'We could not send the verification email. Check the address and try again.' })
      }
    }
    return res.json({ ok: true, expiresInMinutes: SIGNUP_CODE_TTL_MINUTES })
  } catch (error) {
    console.error('send sign-up code failed:', error)
    return res.status(500).json({ error: 'Could not send the verification code.' })
  }
})

// Checks and spends the code for `email`. → null when it matched (the row is
// gone, so it can't be used again), otherwise { status, error }.
async function useSignupCode(email, code) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return { status: 400, error: 'Enter the 6-digit code we emailed you.' }
  }
  const { rows } = await query('SELECT code_hash, expires_at, attempts FROM signup_codes WHERE email = $1', [email])
  const row = rows[0]
  if (!row) return { status: 400, error: 'No code is waiting for this email. Ask for a new one.' }
  if (new Date(row.expires_at) < new Date()) {
    await query('DELETE FROM signup_codes WHERE email = $1', [email])
    return { status: 410, error: 'That code expired. Ask for a new one.' }
  }
  if (row.attempts >= SIGNUP_CODE_MAX_ATTEMPTS) {
    return { status: 429, error: 'Too many wrong codes. Ask for a new one.' }
  }
  if (!(await bcrypt.compare(code, row.code_hash))) {
    await query('UPDATE signup_codes SET attempts = attempts + 1 WHERE email = $1', [email])
    const left = SIGNUP_CODE_MAX_ATTEMPTS - row.attempts - 1
    return { status: 401, error: left > 0 ? `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Ask for a new one.' }
  }
  // Two requests racing on one good code: only the one that deletes the row wins.
  const spent = await query('DELETE FROM signup_codes WHERE email = $1 AND code_hash = $2', [email, row.code_hash])
  if (spent.rowCount === 0) return { status: 400, error: 'No code is waiting for this email. Ask for a new one.' }
  return null
}

router.post('/register', authLimiter, requireDb, async (req, res) => {
  const signup = readSignup(req.body)
  if (signup.error) return res.status(signup.status || 400).json({ error: signup.error })
  const { name, email, password, grade, studentIdNumber, role, under13, parentEmail } = signup

  try {
    await pruneStaleSignups()
    const existing = await query('SELECT 1 FROM users WHERE email = $1', [email])
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'An account with that email already exists.' })
    }
    const codeProblem = await useSignupCode(email, req.body.emailCode)
    if (codeProblem) return res.status(codeProblem.status).json({ error: codeProblem.error })
    const hash = await hashPassword(password)
    const id = uid('usr')
    const { rows } = await query(
      `INSERT INTO users (id, role, name, email, password_hash, grade, student_id_number, signup_platform)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [id, role, name, email, hash, grade || null, studentIdNumber || null, signupPlatform(req)],
    )
    const user = publicUser(rows[0])
    if (under13) {
      const token = generateToken()
      await query(
        `UPDATE users
            SET under_13 = true, parental_consent_status = 'pending', parent_consent_email = $1,
                parent_consent_token = $2, parent_consent_requested_at = now(), parent_consent_sent_at = now()
          WHERE id = $3`,
        [parentEmail, token, id],
      )
      await sendParentConsentEmail({ to: parentEmail, childName: user.name, childEmail: user.email, token })
      // No session and no welcome email: nothing is usable until the parent approves.
      return res.status(201).json({ pendingParentalConsent: true })
    }
    await sendWelcomeEmail({ to: user.email, name: user.name })
    return res.status(201).json({ token: signToken(user), user })
  } catch (error) {
    console.error('register failed:', error)
    return res.status(500).json({ error: 'Could not create account.' })
  }
})

// How long an under-13 sign-up waits for its parent before it is deleted.
export const PARENT_CONSENT_TTL_DAYS = 14

// Re-send the parent's approval email when the child tries to sign in, at
// most once an hour so the sign-in form can't be used to flood an inbox.
async function resendParentConsent(row) {
  if (!row.parent_consent_email || !row.parent_consent_token || !hasEmail()) return false
  const last = row.parent_consent_sent_at ? new Date(row.parent_consent_sent_at).getTime() : 0
  if (Date.now() - last < 60 * 60 * 1000) return false
  try {
    await query('UPDATE users SET parent_consent_sent_at = now() WHERE id = $1', [row.id])
    await sendParentConsentEmail({ to: row.parent_consent_email, childName: row.name, childEmail: row.email, token: row.parent_consent_token })
    return true
  } catch (error) {
    console.error('parent consent resend failed:', error.message)
    return false
  }
}

// The second step an account owes after its password, or null if none.
// `methods` lists what it can answer with; `requiresTotp` stays true for any
// second factor so a client from before passkeys still stops at a 2FA step
// rather than treating the response as a failed sign-in.
async function secondFactorChallenge(row) {
  const methods = []
  if (row.totp_enabled) methods.push('totp')
  if (await hasPasskeys(row.id)) methods.push('passkey')
  if (methods.length === 0) return null
  return { requiresTotp: true, methods, tempToken: signTempToken(publicUser(row)) }
}

router.post('/login', authLimiter, requireDb, turnstileUnlessMonitor(), async (req, res) => {
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
    // A school can require that its students arrive through its own IdP. The
    // check sits after the password verify on purpose: answering "this account
    // must use SSO" before knowing the password is right would turn the login
    // form into an oracle for which addresses belong to which school.
    //
    // Only password accounts are affected — an SSO account has no password to
    // get here with — and the rule is deliberately not extended to the email
    // domain allowlist, which is enforced where an account joins a tenant
    // rather than at every sign-in. Applied at login, an allowlist added later
    // would lock out the students already on the roster under their old
    // addresses.
    // Scoped to students: a school admin or staff member shares the school_id
    // that resolves this policy, and the toggle that sets it lives inside the
    // dashboard they would be locking themselves out of. The rule is about the
    // roster, and the UI says as much.
    if (row.role === 'student' && row.auth_provider !== 'sso') {
      const signIn = await signInPolicyForEmail(email)
      if (signIn?.policy?.signIn?.ssoOnly) {
        return res.status(403).json({
          error: `${signIn.schoolName || 'Your school'} requires you to sign in with your school account. Use the school sign-in option instead of a password.`,
          ssoRequired: true,
        })
      }
    }

    // An under-13 account stays locked until its parent approves. Checked
    // after the password, like the SSO rule above, so it can't be used to
    // probe which addresses have signed up.
    if (row.parental_consent_status === 'pending') {
      const resent = await resendParentConsent(row)
      return res.status(403).json({
        error: resent
          ? 'A parent or guardian needs to approve this account first. We just emailed them again.'
          : 'A parent or guardian needs to approve this account first. Ask them to check their email.',
        parentalConsentPending: true,
      })
    }

    const user = publicUser(row)
    const secondFactor = await secondFactorChallenge(row)
    if (secondFactor) return res.json(secondFactor)

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

// The app language the caller picked ('en' | 'es'), so emails sent to them —
// the parent weekly digest, the come-back nudge — use it (#416). The app
// sends it fire-and-forget; nothing else reads it.
router.put('/me/language', requireDb, requireAuth(), async (req, res) => {
  const language = req.body?.language
  if (!EMAIL_LANGUAGES.includes(language)) {
    return res.status(400).json({ error: 'Language must be "en" or "es".' })
  }
  try {
    const { rowCount } = await query('UPDATE users SET language = $1 WHERE id = $2', [language, req.auth.sub])
    if (rowCount === 0) return res.status(404).json({ error: 'Account not found.' })
    return res.json({ language })
  } catch (error) {
    console.error('language update failed:', error)
    return res.status(500).json({ error: 'Could not save your language.' })
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
  if (isWeakPassword(newPassword)) {
    return res.status(400).json({ error: WEAK_PASSWORD_MESSAGE })
  }

  try {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.auth.sub])
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' })

    const ok = await verifyPassword(currentPassword, rows[0].password_hash)
    if (!ok) return res.status(403).json({ error: 'Current password is incorrect.' })

    const hash = await hashPassword(newPassword)
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.auth.sub])
    // Whoever knew the old password may still hold a session; end them all and
    // hand this device a fresh one so it stays signed in.
    await endSessions(req.auth.sub)

    const user = publicUser({ ...rows[0], password_hash: hash })
    return res.json({ ok: true, user, token: signToken(user) })
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
    await clearExpiredSyncPins()
    const existing = await query('SELECT 1 FROM users WHERE sync_pin = $1 AND id != $2', [syncPin, req.auth.sub])
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'This sync PIN is already in use.' })
    }

    const { rows } = await query(SET_SYNC_PIN, [syncPin, req.auth.sub])
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' })
    return res.json({ user: publicUser(rows[0]) })
  } catch (error) {
    console.error('sync-pin update failed:', error)
    return res.status(500).json({ error: 'Could not update sync PIN.' })
  }
})

// Both PIN routes below issue a session the same way /login does, so they
// have to respect the same second-factor gates — otherwise TOTP (and the
// mandatory-MFA requirement for privileged roles) is simply routed around.
// Returns a response body to send instead of a session, or null to proceed.
async function secondFactorGate(row) {
  const secondFactor = await secondFactorChallenge(row)
  if (secondFactor) return { status: 200, body: secondFactor }
  // Past its enrolment deadline, a privileged account gets no session at all.
  // /login hands back an enrolment token for its setup flow; these routes have
  // no such flow, so they send the user to the normal sign-in page instead.
  const needsMfa = mfaRequiredForRole(row.role) && row.auth_provider !== 'sso'
  if (needsMfa && row.mfa_required_at && new Date(row.mfa_required_at) <= new Date()) {
    return {
      status: 403,
      body: { error: 'This account must finish two-factor setup. Sign in with your email and password.' },
    }
  }
  return null
}

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

    // Gate before the PIN is written: a PIN set on a password alone would be
    // a standing second-factor bypass for POST /sync-login. The client
    // finishes the TOTP challenge and then sets the PIN via PUT /sync-pin.
    const gate = await secondFactorGate(rows[0])
    if (gate) return res.status(gate.status).json(gate.body)

    await clearExpiredSyncPins()
    const existing = await query('SELECT 1 FROM users WHERE sync_pin = $1 AND id != $2', [syncPin, rows[0].id])
    if (existing.rowCount > 0) return res.status(409).json({ error: 'This sync PIN is already in use.' })

    const { rows: updated } = await query(SET_SYNC_PIN, [syncPin, rows[0].id])
    const user = publicUser(updated[0])
    return res.json({ token: signToken(user), user })
  } catch (error) {
    console.error('sync-pin-auth failed:', error)
    return res.status(500).json({ error: 'Could not update sync PIN.' })
  }
})

// Login with sync PIN (for mobile app sync). The PIN is the only credential —
// no email — so it is 100,000 guesses away from *some* account with a PIN set,
// and a per-IP rate limit alone doesn't hold against a bot rotating IPs.
router.post('/sync-login', authLimiter, requireDb, verifyTurnstile(), async (req, res) => {
  const syncPin = validateSyncPin(req.body.syncPin || '')
  
  if (!syncPin) {
    return res.status(400).json({ error: 'Sync PIN must be exactly 5 digits.' })
  }

  try {
    const { rows } = await query('SELECT * FROM users WHERE sync_pin = $1 AND sync_pin_expires_at > now()', [syncPin])
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired sync PIN. Make a new one in Settings.' })
    }
    // Clear the sync PIN so it can't be reused — including when a second
    // factor is still outstanding, since the PIN has now been spent. The
    // WHERE makes the spend atomic: of two requests with one PIN, only the
    // one that clears it goes on to get a session.
    const spent = await query('UPDATE users SET sync_pin = NULL, sync_pin_expires_at = NULL WHERE id = $1 AND sync_pin = $2', [rows[0].id, syncPin])
    if (spent.rowCount === 0) {
      return res.status(401).json({ error: 'Invalid or expired sync PIN. Make a new one in Settings.' })
    }
    const user = publicUser({ ...rows[0], sync_pin: null, sync_pin_expires_at: null })

    const gate = await secondFactorGate(rows[0])
    if (gate) return res.status(gate.status).json(gate.body)

    return res.json({ token: signToken(user), user })
  } catch (error) {
    console.error('sync-login failed:', error)
    return res.status(500).json({ error: 'Could not sign in with sync PIN.' })
  }
})

// ---------------------------------------------------------------------------
// TOTP Two-Factor Authentication
// ---------------------------------------------------------------------------

// Shared with server/routes/passkeys.js: a passkey stands where a TOTP code
// does, so an account whose only second factor is a passkey gets the same
// codes to fall back on when that device is lost.
export function generateBackupCodes(count = 10) {
  const codes = []
  for (let i = 0; i < count; i++) {
    codes.push(crypto.randomBytes(4).toString('hex'))
  }
  return codes
}

export async function hashBackupCodes(codes) {
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

    // A code stays valid for its whole 30 seconds, so without this anyone who
    // saw it typed could sign in with it again straight away.
    const step = Math.floor(Date.now() / 30000) + delta
    if (row.totp_last_step != null && step <= Number(row.totp_last_step)) {
      return res.status(401).json({ error: 'That code was already used. Wait for the next one.' })
    }

    // Success clears the counter, so a user who fumbles a code then gets it
    // right isn't left one mistake away from a lockout.
    await query(
      'UPDATE users SET totp_failed_attempts = 0, totp_locked_until = NULL, totp_last_step = $2 WHERE id = $1',
      [row.id, step],
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
    // The backup codes stay while a passkey is still a second factor —
    // they're its only way back in if that device is lost.
    const keepCodes = await hasPasskeys(row.id)
    await query(
      `UPDATE users
          SET totp_enabled = false, totp_secret = NULL,
              backup_codes = CASE WHEN $3 THEN backup_codes ELSE NULL END,
              mfa_required_at = CASE WHEN $2 THEN now() + interval '7 days' ELSE NULL END
        WHERE id = $1`,
      [req.auth.sub, rearm, keepCodes],
    )
    const updated = { ...row, totp_enabled: false, totp_secret: null, backup_codes: keepCodes ? row.backup_codes : null }
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

    // Codes back up whichever second factor the account has — an
    // authenticator app or a passkey.
    if (!row.backup_codes || !(row.totp_enabled || await hasPasskeys(row.id))) {
      return res.status(400).json({ error: '2FA is not enabled on this account.' })
    }

    // Shares /totp/challenge's per-account lockout, deliberately: a separate
    // counter would just let an attacker who has run the live-code lockout
    // out of attempts switch to guessing backup codes instead, and the
    // per-IP limiter alone is walkable with rotating addresses.
    if (row.totp_locked_until && new Date(row.totp_locked_until) > new Date()) {
      return res.status(429).json({ error: 'Too many incorrect codes. Try again in a few minutes.' })
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
      const attempts = (row.totp_failed_attempts || 0) + 1
      // See /totp/challenge for why the casts are explicit.
      await query(
        `UPDATE users
            SET totp_failed_attempts = $2::int,
                totp_locked_until = CASE WHEN $2::int >= $3::int
                                         THEN now() + interval '15 minutes'
                                         ELSE totp_locked_until END
          WHERE id = $1`,
        [row.id, attempts, TOTP_MAX_ATTEMPTS],
      ).catch((e) => console.error('totp lockout update failed:', e.message))
      return res.status(401).json({ error: 'Invalid backup code.' })
    }

    // Remove the used backup code. Conditional on the list being unchanged
    // since it was read, so two requests racing with the same code can't
    // both spend it: the second finds the list already shorter and fails.
    hashedCodes.splice(matchedIndex, 1)
    const spent = await query(
      'UPDATE users SET backup_codes = $1 WHERE id = $2 AND backup_codes = $3',
      [JSON.stringify(hashedCodes), row.id, row.backup_codes],
    )
    if (spent.rowCount === 0) return res.status(401).json({ error: 'Invalid backup code.' })
    await query(
      'UPDATE users SET totp_failed_attempts = 0, totp_locked_until = NULL WHERE id = $1',
      [row.id],
    ).catch((e) => console.error('totp counter reset failed:', e.message))

    const user = publicUser(row)
    return res.json({ token: signToken(user), user })
  } catch (error) {
    console.error('totp backup-recovery failed:', error)
    return res.status(500).json({ error: 'Could not verify backup code.' })
  }
})

// Roles that may erase themselves here. Deliberately narrow: public_tasks
// .created_by CASCADEs, and schools/organizations have no owner column, so a
// school or org account deleting itself would take its tasks with it and
// orphan the school its students are attached to. Those go through support.
const SELF_DELETABLE_ROLES = ['student', 'volunteer', 'parent']

// DELETE /api/auth/account — erase the caller's own account and everything
// that hangs off it. Until this existed, "delete account" only cleared the
// browser (src/hooks/useAuth.jsx), so every row stayed in Postgres. See #183.
router.delete('/account', authLimiter, requireDb, requireAuth(), async (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const confirmEmail = String(req.body?.email || '').trim().toLowerCase()

  try {
    const { rows } = await query(
      'SELECT id, role, email, password_hash, school_id, organization_id FROM users WHERE id = $1',
      [req.auth.sub],
    )
    const row = rows[0]
    if (!row) return res.status(404).json({ error: 'Account not found.' })

    if (!SELF_DELETABLE_ROLES.includes(row.role)) {
      return res.status(403).json({
        error: 'School, organization, and admin accounts cannot be deleted here. Contact us so the records attached to them are transferred or closed properly.',
      })
    }

    // A stolen token must not be enough to erase someone's record, so the
    // password is re-checked here exactly as /totp/disable does. SSO accounts
    // have none; typing the address is the equivalent deliberate step.
    if (row.password_hash) {
      if (!password) return res.status(400).json({ error: 'Your password is required to delete your account.' })
      if (!(await verifyPassword(password, row.password_hash))) {
        return res.status(403).json({ error: 'Incorrect password.' })
      }
    } else if (confirmEmail !== String(row.email || '').toLowerCase()) {
      return res.status(400).json({ error: 'Type your email address to confirm deletion.' })
    }

    // Awaited, unlike every other audit call: actor_id references the row we
    // are about to delete, so a fire-and-forget insert could land after the
    // DELETE and fail its foreign key. The event has to outlive the account —
    // actor_id nulls out, actor_role and actor_hash remain.
    await recordAuditNow(req, {
      action: AUDIT.ACCOUNT_DELETED,
      subjectUserId: row.id,
      schoolId: row.school_id,
      organizationId: row.organization_id,
      objectType: 'account',
      objectId: row.id,
      meta: { role: row.role },
    })

    // Two things carry this person's details without cascading: reviews
    // (user_id has no foreign key, so a published one kept their name on the
    // public site) and supervisor requests (student_user_id is SET NULL, which
    // left their name and email and the supervisor's on the row).
    await query('DELETE FROM reviews WHERE user_id = $1', [row.id])
    await query('DELETE FROM supervisor_verifications WHERE student_user_id = $1', [row.id])

    // Everything else the account owns cascades: logs, goals, pdf_uploads, task
    // signups, reminders, push subscriptions, parent links. What survives is
    // exactly what the privacy policy says survives — audit events with the
    // identity dropped, proof files in a school's own bucket, and transcripts
    // already exported.
    await query('DELETE FROM users WHERE id = $1', [row.id])
    return res.json({ ok: true })
  } catch (error) {
    console.error('account deletion failed:', error)
    return res.status(500).json({ error: 'Could not delete your account.' })
  }
})

export default router
