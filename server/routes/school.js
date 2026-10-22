import express from 'express'
import rateLimit from 'express-rate-limit'
import validator from 'validator'
import { query, hasDatabase, getPool, nextAccountCode, assignReferralCode, settleSingleOpenInvoice } from '../db.js'
import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { uid, generateToken } from '../ids.js'
import { signupPlatform } from '../platform.js'
import { hashPassword, verifyPassword, signToken, requireAuth, authenticate } from '../auth.js'
import { isWeakPassword, WEAK_PASSWORD_MESSAGE, isValidDateString, MAX_HOURS_PER_ENTRY } from '../validate.js'
import { verifyTurnstile } from '../turnstile.js'
import { sendEmail, sendWelcomeEmail, emailFooterHtml, paymentNoticeHtml, hasEmail, backendUrl } from '../email.js'
import { getPaymentInstructions } from './settings.js'
import { escapeHtml } from '../html.js'
import { recordAudit, AUDIT } from '../audit.js'
import { policyForSchool } from '../policy.js'
import { emailAllowedBySignIn, goalHoursFor, gradeKey, gradeLabel } from '../requirements.js'
import { decryptSecret, hasEncryptionKey } from '../secrets.js'
import { keyBelongsTo, presign, withPrefix } from '../storage/s3.js'
import { recordReferral } from './referral.js'
import { requireCronKey, cronLimiter } from '../cronAuth.js'
import { claimCode, releaseCode, markCodeUser, CODE_REQUIRED_MESSAGE, CODE_REJECTED_MESSAGE } from '../registrationCodes.js'
import { isSignatureImage } from '../signature.js'
import { icsCalendar, icsEvent } from '../ics.js'
import { notify } from '../notifications.js'

const router = express.Router()

// Shared across every route in this file, including reads (a single
// dashboard load fires several parallel GETs: pdfs, tasks, info,
// notifications, students, staff, invoices) — needs headroom above what a
// write-focused limiter would use, or ordinary browsing exhausts the budget
// before an admin gets to an action like sending a payment notice.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

// Messaging a roster fans one click out to every approved volunteer, so it
// gets a tighter cap than the general one — the same posture as the app's
// other outbound-email endpoints.
const taskMailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages sent. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// Blocks student submissions and school-admin management routes until the
// user's school has a verified payment. Looks up school_id fresh from the
// DB (not the JWT) so a payment status change takes effect immediately.
async function requirePaidSchool(req, res, next) {
  try {
    const { rows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    const schoolId = rows[0]?.school_id
    if (!schoolId) return res.status(400).json({ error: 'No school linked to your account.' })

    const { rows: schoolRows } = await query('SELECT payment_status FROM schools WHERE id = $1', [schoolId])
    if (schoolRows.length === 0) return res.status(404).json({ error: 'School not found.' })
    if (schoolRows[0].payment_status !== 'paid') {
      return res.status(403).json({ error: 'This school has not completed payment yet. Submissions are paused until payment is verified.' })
    }
    next()
  } catch (error) {
    console.error('requirePaidSchool check failed:', error)
    return res.status(500).json({ error: 'Could not verify school payment status.' })
  }
}

// Register a school. If `inviteToken` is present, it must reference a
// pending, unexpired invite — consumed (marked 'completed') on success so
// it can't be reused.
router.post('/register', limiter, requireDb, verifyTurnstile(), async (req, res) => {
  const name = String(req.body.name || '').trim()
  const email = String(req.body.email || '').trim().toLowerCase()
  const password = req.body.password
  const pin = String(req.body.pin || '').trim().toLowerCase()
  const inviteToken = req.body.inviteToken ? String(req.body.inviteToken).trim() : null
  // Without an invite link, a one-time code from us is required (#287), so a
  // school can't become a customer without having contacted us.
  const registrationCode = !inviteToken && req.body.registrationCode ? String(req.body.registrationCode) : null
  // Optional. A bad or expired code must never block a registration — the
  // school still gets its account, the admin just sees no referral attached.
  const referralCode = req.body.referralCode ? String(req.body.referralCode).trim().toUpperCase() : null

  if (!name || name.length > 100) return res.status(400).json({ error: 'School name is required.' })
  if (!email || !validator.isEmail(email) || email.length > 254) return res.status(400).json({ error: 'Valid email required.' })
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' })
  if (isWeakPassword(password)) return res.status(400).json({ error: WEAK_PASSWORD_MESSAGE })
  if (!pin || !/^[a-z]+-?\d{3,5}$/.test(pin)) return res.status(400).json({ error: 'School code must be letters followed by digits (e.g. cisd-12345).' })
  if (!inviteToken && !registrationCode) return res.status(403).json({ error: CODE_REQUIRED_MESSAGE.school })

  let claimedCodeId = null
  try {
    let invite = null
    if (inviteToken) {
      const { rows: inviteRows } = await query('SELECT * FROM school_invites WHERE token = $1', [inviteToken])
      invite = inviteRows[0]
      if (!invite || invite.status !== 'pending' || new Date(invite.expires_at) < new Date()) {
        return res.status(410).json({ error: 'This invite link has expired or was already used.' })
      }
    }

    const existing = await query('SELECT 1 FROM schools WHERE pin = $1', [pin])
    if (existing.rowCount > 0) return res.status(409).json({ error: 'That school code is already taken.' })

    const existingUser = await query('SELECT 1 FROM users WHERE email = $1', [email])
    if (existingUser.rowCount > 0) return res.status(409).json({ error: 'An account with that email already exists.' })

    // Spent only now, once every other check has passed, so a taken email or
    // school code doesn't cost the school its registration code.
    if (registrationCode) {
      claimedCodeId = await claimCode('school', registrationCode)
      if (!claimedCodeId) return res.status(410).json({ error: CODE_REJECTED_MESSAGE })
    }

    const schoolId = uid('sch')
    await query(
      'INSERT INTO schools (id, name, pin, contact_email, organization_id, account_code) VALUES ($1, $2, $3, $4, $5, $6)',
      [schoolId, name, pin, email, invite?.organization_id || null, await nextAccountCode('schools')],
    )
    await assignReferralCode('schools', schoolId, name).catch((e) => console.error('referral code failed:', e.message))

    const hash = await hashPassword(password)
    const userId = uid('usr')
    const { rows } = await query(
      `INSERT INTO users (id, role, name, email, password_hash, school_id, signup_platform)
       VALUES ($1, 'school', $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, name, email, hash, schoolId, signupPlatform(req)],
    )
    await markCodeUser(claimedCodeId, userId)

    if (invite) {
      await query(`UPDATE school_invites SET status = 'completed' WHERE id = $1`, [invite.id])
    }

    let referral = null
    if (referralCode) {
      const result = await recordReferral({ code: referralCode, referredType: 'school', referredId: schoolId })
      referral = result.ok ? { referrerName: result.referrerName } : { error: result.reason }
    }

    const user = { id: rows[0].id, role: rows[0].role, name: rows[0].name, email: rows[0].email, schoolId: rows[0].school_id, grade: rows[0].grade }
    await sendWelcomeEmail({ to: user.email, name: user.name })
    return res.status(201).json({ token: signToken(user), user, referral })
  } catch (error) {
    await releaseCode(claimedCodeId).catch((e) => console.error('registration code release failed:', e.message))
    console.error('school register failed:', error)
    return res.status(500).json({ error: 'Could not register school.' })
  }
})

// Look up a pending invite by token (public — the school clicks the emailed
// link before they're authenticated). Returns just enough to pre-fill the
// registration form.
router.get('/invite/:token', limiter, requireDb, async (req, res) => {
  try {
    const { rows } = await query('SELECT name, email, status, expires_at FROM school_invites WHERE token = $1', [req.params.token])
    if (rows.length === 0) return res.status(404).json({ error: 'Invite not found.' })
    const invite = rows[0]
    if (invite.status !== 'pending' || new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This invite link has expired or was already used.' })
    }
    return res.json({ name: invite.name, email: invite.email })
  } catch (error) {
    console.error('invite lookup failed:', error)
    return res.status(500).json({ error: 'Could not look up invite.' })
  }
})

// Join a school (student enters school code)
// Students are the only role that joins a school by code. This was
// requireAuth() with no roles, so a volunteer, parent or org account that
// typed a code into the Settings join box had schools.id written onto its own
// user row — an org is meant to own schools, a parent reaches a child's hours
// through parent_child_links, and a volunteer isn't enrolled anywhere.
router.post('/join', limiter, requireDb, requireAuth('student'), async (req, res) => {
  const pin = String(req.body.pin || '').trim().toLowerCase()

  if (!pin) return res.status(400).json({ error: 'School code is required.' })

  try {
    const { rows } = await query('SELECT id, name FROM schools WHERE pin = $1', [pin])
    if (rows.length === 0) return res.status(404).json({ error: 'No school found with that code.' })
    const target = rows[0]

    const { rows: meRows } = await query('SELECT school_id, email FROM users WHERE id = $1', [req.auth.sub])
    const currentSchoolId = meRows[0]?.school_id || null

    // A school may restrict which email domains can join it — the code alone
    // is a weak gate once it has been passed around a group chat. Checked here
    // rather than at every sign-in, so adding the rule later cannot lock out
    // students already on the roster under an old address. The address comes
    // from the users row, not the JWT, so an email change can't be outrun by
    // an old token.
    const targetPolicy = await policyForSchool(target.id)
    if (targetPolicy && !emailAllowedBySignIn(targetPolicy.policy, meRows[0]?.email)) {
      const domains = targetPolicy.policy.signIn.allowedEmailDomains.join(', ')
      return res.status(403).json({ error: `${target.name} only accepts accounts from: ${domains}.` })
    }

    if (currentSchoolId === target.id) {
      return res.status(409).json({ error: 'You are already linked to that school.' })
    }

    // First join links immediately — that is the documented flow, and there is
    // no existing school whose roster the student is leaving.
    if (!currentSchoolId) {
      await query('UPDATE users SET school_id = $1 WHERE id = $2', [target.id, req.auth.sub])
      return res.json({ ok: true, schoolId: target.id })
    }

    // A transfer is different: it hands this student's whole record to a
    // different school, so that school has to agree to take it. Until then
    // nothing moves — the student stays exactly where they are (#143 step 5).
    const { rows: created } = await query(
      `INSERT INTO school_transfers (id, user_id, from_school_id, to_school_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) WHERE status = 'pending'
       DO UPDATE SET to_school_id = EXCLUDED.to_school_id,
                     from_school_id = EXCLUDED.from_school_id,
                     created_at = now()
       RETURNING id`,
      [uid('xfer'), req.auth.sub, currentSchoolId, target.id],
    )

    recordAudit(req, {
      action: AUDIT.TRANSFER_REQUESTED,
      subjectUserId: req.auth.sub,
      schoolId: target.id,
      objectType: 'school_transfer',
      objectId: created[0]?.id || null,
      meta: { fromSchoolId: currentSchoolId, toSchoolId: target.id },
    })

    return res.json({
      ok: true,
      pending: true,
      schoolName: target.name,
      message: `${target.name} has been asked to accept your transfer. Your hours stay with your current school until they do.`,
    })
  } catch (error) {
    console.error('school join failed:', error)
    return res.status(500).json({ error: 'Could not join school.' })
  }
})

// GET /api/school/transfer/mine — the student's own open request, if any.
router.get('/transfer/mine', limiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT t.id, t.status, t.created_at, s.name AS to_school_name
         FROM school_transfers t
         JOIN schools s ON s.id = t.to_school_id
        WHERE t.user_id = $1 AND t.status = 'pending'
        LIMIT 1`,
      [req.auth.sub],
    )
    return res.json({ transfer: rows[0] || null })
  } catch (error) {
    console.error('transfer lookup failed:', error)
    return res.status(500).json({ error: 'Could not load your transfer request.' })
  }
})

// DELETE /api/school/transfer/mine — student changes their mind.
router.delete('/transfer/mine', limiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const { rowCount } = await query(
      `UPDATE school_transfers SET status = 'cancelled', decided_at = now()
        WHERE user_id = $1 AND status = 'pending'`,
      [req.auth.sub],
    )
    if (rowCount === 0) return res.status(404).json({ error: 'You have no pending transfer request.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('transfer cancel failed:', error)
    return res.status(500).json({ error: 'Could not cancel the request.' })
  }
})

// A student leaves their school (graduated, homeschooling, changed their
// mind). Moving to another school is a transfer instead. From here the school
// no longer sees their hours or reports, which only go to a student's current
// school; the hours themselves stay in the student's account.
router.post('/leave', limiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const { rows } = await query(
      'UPDATE users SET school_id = NULL WHERE id = $1 AND school_id IS NOT NULL RETURNING id',
      [req.auth.sub],
    )
    if (rows.length === 0) return res.status(404).json({ error: "You aren't linked to a school." })
    await query(
      `UPDATE school_transfers SET status = 'cancelled', decided_at = now()
        WHERE user_id = $1 AND status = 'pending'`,
      [req.auth.sub],
    )
    return res.json({ ok: true })
  } catch (error) {
    console.error('leave school failed:', error)
    return res.status(500).json({ error: 'Could not leave the school.' })
  }
})

// GET /api/school/transfers — requests waiting on this school.
router.get('/transfers', limiter, requireDb, requireAuth('school', 'school_staff'), requirePaidSchool, async (req, res) => {
  try {
    const { rows: meRows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    const schoolId = meRows[0]?.school_id
    if (!schoolId) return res.status(404).json({ error: 'School not found.' })

    const { rows } = await query(
      `SELECT t.id, t.created_at, u.id AS student_id, u.name AS student_name,
              u.email AS student_email, u.grade, f.name AS from_school_name
         FROM school_transfers t
         JOIN users u ON u.id = t.user_id
         LEFT JOIN schools f ON f.id = t.from_school_id
        WHERE t.to_school_id = $1 AND t.status = 'pending'
        ORDER BY t.created_at DESC`,
      [schoolId],
    )
    return res.json({ transfers: rows })
  } catch (error) {
    console.error('transfer list failed:', error)
    return res.status(500).json({ error: 'Could not fetch transfer requests.' })
  }
})

// POST /api/school/transfers/:id/decide { decision: 'accept' | 'decline' }
// Accepting is the only thing that actually moves school_id. The student's
// logs, verifications and proof pointers are left exactly as they are — the
// record travels with the account rather than being copied or re-entered.
router.post('/transfers/:id/decide', limiter, requireDb, requireAuth('school', 'school_staff'), requirePaidSchool, async (req, res) => {
  const decision = String(req.body?.decision || '').trim().toLowerCase()
  if (!['accept', 'decline'].includes(decision)) {
    return res.status(400).json({ error: 'Decision must be accept or decline.' })
  }

  try {
    const { rows: meRows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    const schoolId = meRows[0]?.school_id
    if (!schoolId) return res.status(404).json({ error: 'School not found.' })

    // Scoped to this school and to 'pending' in the same statement, so a
    // request belonging to another school — or already decided — matches
    // nothing rather than being checked and then acted on separately.
    const { rows } = await query(
      `UPDATE school_transfers
          SET status = $1, decided_by = $2, decided_at = now()
        WHERE id = $3 AND to_school_id = $4 AND status = 'pending'
        RETURNING user_id, from_school_id, to_school_id`,
      [decision === 'accept' ? 'accepted' : 'declined', req.auth.sub, req.params.id, schoolId],
    )
    if (rows.length === 0) {
      return res.status(404).json({ error: 'That request is no longer open.' })
    }
    const transfer = rows[0]

    if (decision === 'accept') {
      await query('UPDATE users SET school_id = $1 WHERE id = $2', [transfer.to_school_id, transfer.user_id])
      // The student's submitted reports go with them. One in the former
      // school's own storage stays there: the new school can't reach that bucket.
      await query(
        'UPDATE pdf_uploads SET school_id = $1 WHERE user_id = $2 AND school_id = $3 AND storage_id IS NULL',
        [transfer.to_school_id, transfer.user_id, transfer.from_school_id],
      )
    }

    recordAudit(req, {
      action: AUDIT.TRANSFER_DECIDED,
      subjectUserId: transfer.user_id,
      schoolId,
      objectType: 'school_transfer',
      objectId: req.params.id,
      meta: { decision, fromSchoolId: transfer.from_school_id, toSchoolId: transfer.to_school_id },
    })

    return res.json({ ok: true, decision })
  } catch (error) {
    console.error('transfer decision failed:', error)
    return res.status(500).json({ error: 'Could not record the decision.' })
  }
})

// Get students under this school (school admin only)
router.get('/students', limiter, requireDb, requireAuth('school', 'school_staff'), requirePaidSchool, async (req, res) => {
  try {
    const { rows: userRows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    if (userRows.length === 0 || !userRows[0].school_id) return res.status(404).json({ error: 'School not found.' })

    const { rows } = await query(
      `SELECT id, name, email, grade, created_at FROM users
       WHERE school_id = $1 AND role = 'student'
       ORDER BY created_at DESC`,
      [userRows[0].school_id],
    )
    recordAudit(req, {
      action: AUDIT.STUDENT_LIST_READ,
      schoolId: userRows[0].school_id,
      objectType: 'student_list',
      meta: { count: rows.length },
    })
    return res.json({ students: rows })
  } catch (error) {
    console.error('school students failed:', error)
    return res.status(500).json({ error: 'Could not fetch students.' })
  }
})

// --- Students behind on hours ------------------------------------------------
//
// Each linked student's hours against the school's requirement (Requirements →
// goals, per grade or one total), so the school can see who still has hours
// to go and email them a reminder. Rejected entries don't count, matching the
// student's own progress (countedLogs in src/lib/achievements.js).

const REMINDER_GAP_DAYS = 7
const MAX_REMIND_AT_ONCE = 200

async function schoolProgress(schoolId) {
  const resolved = await policyForSchool(schoolId)
  const policy = resolved?.policy
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.grade, u.hours_reminded_at, u.parental_consent_status,
            COALESCE(SUM(l.hours) FILTER (WHERE l.verification_status IS DISTINCT FROM 'rejected'), 0)::float AS hours,
            to_char(MAX(l.date), 'YYYY-MM-DD') AS last_log_date
       FROM users u LEFT JOIN logs l ON l.user_id = u.id
      WHERE u.school_id = $1 AND u.role = 'student'
      GROUP BY u.id
      ORDER BY u.name`,
    [schoolId],
  )
  const students = rows.map((r) => {
    const target = goalHoursFor(policy, r.grade)
    const hours = Math.round(r.hours * 100) / 100
    return {
      id: r.id, name: r.name, email: r.email, grade: r.grade,
      hours, target, remaining: target ? Math.max(0, Math.round((target - hours) * 100) / 100) : null,
      lastLogDate: r.last_log_date, remindedAt: r.hours_reminded_at,
      // An under-13 account still waiting for a parent can't sign in yet.
      consentPending: r.parental_consent_status === 'pending',
    }
  })
  return { schoolName: resolved?.schoolName || '', deadline: policy?.goals?.deadline || null, students }
}

router.get('/students/progress', limiter, requireDb, requireAuth('school', 'school_staff'), requirePaidSchool, async (req, res) => {
  try {
    const { rows: userRows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    const schoolId = userRows[0]?.school_id
    if (!schoolId) return res.status(404).json({ error: 'School not found.' })
    const progress = await schoolProgress(schoolId)
    recordAudit(req, { action: AUDIT.STUDENT_LIST_READ, schoolId, objectType: 'student_progress', meta: { count: progress.students.length } })
    return res.json({ deadline: progress.deadline, reminderGapDays: REMINDER_GAP_DAYS, students: progress.students })
  } catch (error) {
    console.error('student progress failed:', error)
    return res.status(500).json({ error: 'Could not load student progress.' })
  }
})

// --- Graduation report -------------------------------------------------------
//
// GET /graduation-report?grade=12&hours=approved|counted
// Which students in one grade met the school's hour requirement, for a
// counselor to print or export. Grades are compared through gradeKey(), the
// same way goalHoursFor() picks a per-grade target, so "12", "12th" and
// "Senior" are one grade. Defaults to approved hours only: a graduation
// sign-off should rest on verified hours. "counted" adds pending, and rejected
// hours never count either way.

const roundHours = (n) => Math.round(n * 100) / 100

// Kindergarten, then 1–12 in order, then anything a school labels itself.
function gradeSortValue(key) {
  if (key === 'K') return 0
  if (/^\d{1,2}$/.test(key)) return Number(key)
  return 100
}

router.get('/graduation-report', limiter, requireDb, requireAuth('school', 'school_staff'), requirePaidSchool, async (req, res) => {
  const hoursMode = req.query.hours === 'counted' ? 'counted' : 'approved'
  try {
    const { rows: userRows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    const schoolId = userRows[0]?.school_id
    if (!schoolId) return res.status(404).json({ error: 'School not found.' })

    const resolved = await policyForSchool(schoolId)
    const policy = resolved?.policy
    const goals = policy?.goals || {}
    const requirementSet = goals.totalHours != null || Object.keys(goals.byGrade || {}).length > 0

    const { rows } = await query(
      `SELECT u.id, u.name, u.email, u.grade,
              COALESCE(SUM(l.hours) FILTER (WHERE l.verification_status = 'approved'), 0)::float AS approved,
              COALESCE(SUM(l.hours) FILTER (WHERE l.id IS NOT NULL
                AND l.verification_status IS DISTINCT FROM 'approved'
                AND l.verification_status IS DISTINCT FROM 'rejected'), 0)::float AS pending
         FROM users u LEFT JOIN logs l ON l.user_id = u.id
        WHERE u.school_id = $1 AND u.role = 'student'
        GROUP BY u.id
        ORDER BY u.name`,
      [schoolId],
    )

    // Only grades that actually exist among this school's students.
    const counts = new Map()
    let ungraded = 0
    for (const r of rows) {
      const key = gradeKey(r.grade)
      if (!key) { ungraded++; continue }
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    const grades = [...counts.entries()]
      .map(([key, count]) => ({ key, label: gradeLabel(key), count, target: goalHoursFor(policy, key) }))
      .sort((a, b) => gradeSortValue(a.key) - gradeSortValue(b.key) || a.key.localeCompare(b.key))
    const numeric = grades.filter((g) => /^\d{1,2}$/.test(g.key))
    const defaultGrade = (numeric.length ? numeric[numeric.length - 1] : grades[grades.length - 1])?.key || null

    const grade = gradeKey(typeof req.query.grade === 'string' ? req.query.grade.slice(0, 40) : '') || defaultGrade
    const target = grade ? goalHoursFor(policy, grade) : null

    const students = rows
      .filter((r) => grade && gradeKey(r.grade) === grade)
      .map((r) => {
        const approvedHours = roundHours(r.approved)
        const pendingHours = roundHours(r.pending)
        const countedHours = roundHours(r.approved + r.pending)
        const hours = hoursMode === 'counted' ? countedHours : approvedHours
        const met = target != null && hours >= target
        return {
          id: r.id, name: r.name, email: r.email, grade: r.grade,
          approvedHours, pendingHours, countedHours, hours,
          met,
          shortfall: target != null ? roundHours(Math.max(0, target - hours)) : null,
        }
      })
      // Missed first, furthest behind at the top; then everyone who met it.
      .sort((a, b) => Number(a.met) - Number(b.met)
        || (b.shortfall ?? 0) - (a.shortfall ?? 0)
        || String(a.name || '').localeCompare(String(b.name || '')))

    const met = students.filter((s) => s.met).length
    recordAudit(req, {
      action: AUDIT.STUDENT_LIST_READ,
      schoolId,
      objectType: 'graduation_report',
      meta: { grade, hoursMode, count: students.length },
    })
    return res.json({
      schoolName: resolved?.schoolName || '',
      generatedAt: new Date().toISOString(),
      hoursMode,
      grade,
      gradeLabel: grade ? gradeLabel(grade) : null,
      grades,
      ungraded,
      requirementSet,
      target,
      deadline: goals.deadline || null,
      note: goals.note || '',
      summary: { students: students.length, met, missed: students.length - met },
      students,
    })
  } catch (error) {
    console.error('graduation report failed:', error)
    return res.status(500).json({ error: 'Could not build the graduation report.' })
  }
})

// POST { studentIds }: email each one still short of their hours. Students
// who met their goal, have no goal, or were reminded in the last week are skipped.
router.post('/students/remind', limiter, requireDb, requireAuth('school', 'school_staff'), requirePaidSchool, async (req, res) => {
  const ids = Array.isArray(req.body?.studentIds) ? [...new Set(req.body.studentIds.map(String))] : []
  if (ids.length === 0) return res.status(400).json({ error: 'Choose at least one student.' })
  if (ids.length > MAX_REMIND_AT_ONCE) return res.status(400).json({ error: `Remind at most ${MAX_REMIND_AT_ONCE} students at once.` })
  try {
    const { rows: userRows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    const schoolId = userRows[0]?.school_id
    if (!schoolId) return res.status(404).json({ error: 'School not found.' })
    const { schoolName, deadline, students } = await schoolProgress(schoolId)
    const site = String(process.env.FRONTEND_URL || 'https://volunteer-track-two.vercel.app').replace(/\/$/, '')
    const cutoff = Date.now() - REMINDER_GAP_DAYS * 24 * 60 * 60 * 1000
    let sent = 0
    let skipped = 0
    for (const s of students.filter((st) => ids.includes(st.id))) {
      if (!s.target || s.remaining <= 0 || s.consentPending || (s.remindedAt && new Date(s.remindedAt).getTime() > cutoff)) { skipped++; continue }
      // Claim the week first, so two clicks can't send two emails.
      const { rowCount } = await query(
        `UPDATE users SET hours_reminded_at = now()
          WHERE id = $1 AND school_id = $2 AND (hours_reminded_at IS NULL OR hours_reminded_at < now() - interval '${REMINDER_GAP_DAYS} days')`,
        [s.id, schoolId],
      )
      if (!rowCount) { skipped++; continue }
      notify(s.id, {
        kind: 'hours_reminder',
        title: `You have ${s.remaining} hours to go`,
        body: `${schoolName || 'Your school'} asks for ${s.target} volunteer hours${deadline ? ` by ${deadline}` : ''}. You have ${s.hours} so far.`,
        link: '/opportunities',
      })
      await sendEmail({
        to: s.email,
        subject: `${s.remaining} volunteer hours to go`,
        html: `
          <h2>${escapeHtml(`You have ${s.remaining} hours to go`)}</h2>
          <p>${escapeHtml(`Hi ${s.name || 'there'}, ${schoolName || 'your school'} asks for ${s.target} volunteer hours${deadline ? ` by ${deadline}` : ''}. You have ${s.hours} so far.`)}</p>
          <p>Find a task on <a href="${escapeHtml(site)}/opportunities">Opportunities</a>, or log hours you've already done on <a href="${escapeHtml(site)}/log">Log Hours</a>.</p>
          ${emailFooterHtml()}
        `,
      })
      sent++
    }
    recordAudit(req, { action: AUDIT.STUDENT_LIST_READ, schoolId, objectType: 'hours_reminder', meta: { sent, skipped } })
    return res.json({ sent, skipped })
  } catch (error) {
    console.error('hours reminder failed:', error)
    return res.status(500).json({ error: 'Could not send reminders.' })
  }
})

// Invite a student to the school by email (school admin only)
router.post('/add-student', limiter, requireDb, requireAuth('school', 'school_staff'), requirePaidSchool, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase()
  if (!email || !validator.isEmail(email)) return res.status(400).json({ error: 'Valid email required.' })

  try {
    const { rows: userRows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    if (userRows.length === 0 || !userRows[0].school_id) return res.status(404).json({ error: 'School not found.' })

    const { rows: target } = await query('SELECT id, school_id, role FROM users WHERE email = $1', [email])
    if (target.length === 0) return res.status(404).json({ error: 'No user found with that email.' })
    if (target[0].school_id) return res.status(409).json({ error: 'This student is already linked to a school.' })
    if (target[0].role !== 'student') return res.status(400).json({ error: 'That user is not a student.' })

    // An invite, not a link: the student accepts in Settings before this
    // school can see their hours. Linking straight away let any school claim
    // any student account whose email it knew.
    const { rows: invited } = await query(
      `INSERT INTO school_student_invites (id, school_id, user_id, invited_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (school_id, user_id) WHERE status = 'pending' DO NOTHING
       RETURNING id`,
      [uid('sinv'), userRows[0].school_id, target[0].id, req.auth.sub],
    )
    if (invited.length > 0) notifyStudentInvite(userRows[0].school_id, target[0].id)
    return res.json({ ok: true, invited: true })
  } catch (error) {
    console.error('add-student failed:', error)
    return res.status(500).json({ error: 'Could not add student.' })
  }
})

async function notifyStudentInvite(schoolId, userId) {
  try {
    const { rows } = await query(
      'SELECT s.name AS school_name, u.email, u.name FROM schools s, users u WHERE s.id = $1 AND u.id = $2',
      [schoolId, userId],
    )
    const row = rows[0]
    if (!row?.email) return
    const link = `${String(process.env.FRONTEND_URL || '').replace(/\/$/, '')}/settings`
    await sendEmail({
      to: row.email,
      subject: `${row.school_name} wants to add you on VolunTrack`,
      html: `<p>Hi ${escapeHtml(row.name || 'there')},</p><p>${escapeHtml(row.school_name)} would like to add you to their school on VolunTrack. If you accept, they'll be able to see the hours you log and review them.</p><p>Open <a href="${link}">Settings → Join school</a> to accept or decline. Nothing is shared unless you accept.</p>${emailFooterHtml()}`,
    })
  } catch (error) {
    console.error('student invite email failed:', error)
  }
}

// A student's pending invites from schools.
router.get('/invites/mine', limiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT i.id, s.name AS school_name, i.created_at
         FROM school_student_invites i JOIN schools s ON s.id = i.school_id
        WHERE i.user_id = $1 AND i.status = 'pending'
        ORDER BY i.created_at DESC`,
      [req.auth.sub],
    )
    return res.json({ invites: rows.map((r) => ({ id: r.id, schoolName: r.school_name, createdAt: r.created_at })) })
  } catch (error) {
    console.error('student invites fetch failed:', error)
    return res.status(500).json({ error: 'Could not load invites.' })
  }
})

// The student accepts or declines. Accepting links them, if they aren't at a
// school already (moving schools is a transfer, which the new school accepts).
router.post('/invites/:id/decide', limiter, requireDb, requireAuth('student'), async (req, res) => {
  const decision = req.body?.decision
  if (decision !== 'accept' && decision !== 'decline') return res.status(400).json({ error: 'Decision must be accept or decline.' })
  try {
    const { rows } = await query(
      "SELECT school_id FROM school_student_invites WHERE id = $1 AND user_id = $2 AND status = 'pending'",
      [req.params.id, req.auth.sub],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'That invite is no longer open.' })
    if (decision === 'accept') {
      const { rows: me } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
      if (me[0]?.school_id) {
        return res.status(409).json({ error: "You're already at a school. To move, enter the new school's code in Settings to request a transfer." })
      }
      await query('UPDATE users SET school_id = $1 WHERE id = $2', [rows[0].school_id, req.auth.sub])
      // Other schools' invites can't be accepted now, so they're closed too.
      await query(
        "UPDATE school_student_invites SET status = 'declined', decided_at = now() WHERE user_id = $1 AND status = 'pending' AND id <> $2",
        [req.auth.sub, req.params.id],
      )
    }
    await query(
      'UPDATE school_student_invites SET status = $1, decided_at = now() WHERE id = $2',
      [decision === 'accept' ? 'accepted' : 'declined', req.params.id],
    )
    return res.json({ ok: true, joined: decision === 'accept' })
  } catch (error) {
    console.error('student invite decision failed:', error)
    return res.status(500).json({ error: 'Could not save your answer.' })
  }
})

const MAX_CO_ADMINS = 10

// List co-admins for the school (school admin or a co-admin can view)
router.get('/staff', limiter, requireDb, requireAuth('school', 'school_staff'), requirePaidSchool, async (req, res) => {
  try {
    const { rows: userRows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    if (userRows.length === 0 || !userRows[0].school_id) return res.status(404).json({ error: 'School not found.' })

    const { rows } = await query(
      `SELECT id, name, email, created_at FROM users
       WHERE school_id = $1 AND role = 'school_staff'
       ORDER BY created_at DESC`,
      [userRows[0].school_id],
    )
    return res.json({ staff: rows })
  } catch (error) {
    console.error('school staff list failed:', error)
    return res.status(500).json({ error: 'Could not fetch staff.' })
  }
})

// Add a co-admin (school admin only — co-admins cannot add other co-admins).
// Capped at MAX_CO_ADMINS per school.
router.post('/staff', limiter, requireDb, requireAuth('school'), requirePaidSchool, async (req, res) => {
  const name = String(req.body.name || '').trim()
  const email = String(req.body.email || '').trim().toLowerCase()
  const password = req.body.password

  if (!name || name.length > 100) return res.status(400).json({ error: 'Name is required.' })
  if (!email || !validator.isEmail(email) || email.length > 254) return res.status(400).json({ error: 'Valid email required.' })
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' })
  if (isWeakPassword(password)) return res.status(400).json({ error: WEAK_PASSWORD_MESSAGE })

  try {
    const { rows: userRows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    if (userRows.length === 0 || !userRows[0].school_id) return res.status(404).json({ error: 'School not found.' })
    const schoolId = userRows[0].school_id

    const { rows: countRows } = await query(
      `SELECT COUNT(*) FROM users WHERE school_id = $1 AND role = 'school_staff'`,
      [schoolId],
    )
    if (Number(countRows[0].count) >= MAX_CO_ADMINS) {
      return res.status(409).json({ error: `You've reached the limit of ${MAX_CO_ADMINS} co-admins.` })
    }

    const existingUser = await query('SELECT 1 FROM users WHERE email = $1', [email])
    if (existingUser.rowCount > 0) return res.status(409).json({ error: 'An account with that email already exists.' })

    const hash = await hashPassword(password)
    const userId = uid('usr')
    await query(
      `INSERT INTO users (id, role, name, email, password_hash, school_id)
       VALUES ($1, 'school_staff', $2, $3, $4, $5)`,
      [userId, name, email, hash, schoolId],
    )
    // A new co-admin can read every student at this school from here on.
    recordAudit(req, {
      action: AUDIT.STAFF_ADDED,
      subjectUserId: userId,
      schoolId,
      objectType: 'user',
      objectId: userId,
    })
    return res.status(201).json({ ok: true })
  } catch (error) {
    console.error('add school staff failed:', error)
    return res.status(500).json({ error: 'Could not add co-admin.' })
  }
})

// Remove a co-admin (school admin only)
router.delete('/staff/:id', limiter, requireDb, requireAuth('school'), requirePaidSchool, async (req, res) => {
  try {
    const { rows: userRows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    if (userRows.length === 0 || !userRows[0].school_id) return res.status(404).json({ error: 'School not found.' })

    const { rowCount } = await query(
      `DELETE FROM users WHERE id = $1 AND school_id = $2 AND role = 'school_staff'`,
      [req.params.id, userRows[0].school_id],
    )
    if (rowCount === 0) return res.status(404).json({ error: 'Co-admin not found.' })
    recordAudit(req, {
      action: AUDIT.STAFF_REMOVED,
      schoolId: userRows[0].school_id,
      objectType: 'user',
      objectId: req.params.id,
    })
    return res.json({ ok: true })
  } catch (error) {
    console.error('remove school staff failed:', error)
    return res.status(500).json({ error: 'Could not remove co-admin.' })
  }
})

// ---------------------------------------------------------------------------
// Student documents and tenant storage (#143 step 6)
// ---------------------------------------------------------------------------

// The active storage config a school's documents go through: its own, else its
// parent organization's. Mirrors resolveStorageForUser() in routes/storage.js,
// but keyed by school rather than by user — the drain job works school by
// school, and an upload is attached to a school id that an admin may have
// supplied rather than to the caller's own account.
async function activeStorageForSchool(schoolId) {
  if (!schoolId) return null
  const { rows } = await query(
    `SELECT ts.* FROM tenant_storage ts
       LEFT JOIN schools s ON s.id = $1
      WHERE ts.status = 'active'
        AND (ts.school_id = $1 OR (s.organization_id IS NOT NULL AND ts.organization_id = s.organization_id))
      ORDER BY (ts.school_id IS NOT NULL) DESC
      LIMIT 1`,
    [schoolId],
  )
  return rows[0] || null
}

// Shape presign() wants, decrypting the stored secret access key.
function usableStorage(row) {
  return {
    bucket: row.bucket,
    region: row.region,
    endpoint: row.endpoint,
    prefix: row.prefix,
    accessKeyId: row.access_key_id,
    secretAccessKey: decryptSecret(row.secret_encrypted),
  }
}

// Upload a PDF (student or admin)
const SUBMITTED_DOCUMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
// Per student, for documents held in our database (base64, so ~4/3 of the file).
const MAX_STORED_DOCUMENT_BYTES_PER_STUDENT = 25 * 1024 * 1024

router.post('/upload', limiter, requireDb, requireAuth('student', 'admin'), async (req, res, next) => {
  if (req.auth.role === 'admin') return next()
  return requirePaidSchool(req, res, next)
}, async (req, res) => {
  const { filename, fileData, fileType, storageId, objectKey, fileBytes } = req.body

  if (!filename) return res.status(400).json({ error: 'Filename required.' })
  if (!fileData && !objectKey) return res.status(400).json({ error: 'Filename and file data required.' })
  if (String(filename).length > 200) return res.status(400).json({ error: 'That file name is too long.' })
  // The school opens these in the browser, so the type a student declares is
  // limited to what it shows safely (src/components/SubmittedDocument.jsx).
  const type = String(fileType || 'application/pdf').toLowerCase()
  if (!SUBMITTED_DOCUMENT_TYPES.includes(type)) {
    return res.status(400).json({ error: 'Submit a PDF or an image (PNG, JPEG or WebP).' })
  }
  if (fileData && typeof fileData !== 'string') return res.status(400).json({ error: 'Invalid file data.' })

  try {
    const { rows: userRows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    let schoolId = userRows[0]?.school_id
    if (!schoolId && req.body.schoolId) {
      // Only the admin branch reaches here (a student always has school_id).
      // The target school id comes from the request body, so confirm it
      // actually exists before attaching an upload to it rather than
      // relying on the FK constraint to reject bad input.
      const { rows: schoolRows } = await query('SELECT 1 FROM schools WHERE id = $1', [req.body.schoolId])
      if (schoolRows.length === 0) return res.status(400).json({ error: 'That school does not exist.' })
      schoolId = req.body.schoolId
    }
    if (!schoolId) return res.status(400).json({ error: 'No school linked to your account.' })

    // Where the school has its own bucket the browser has already uploaded
    // there, and all we are handed is a pointer — which is caller-supplied, so
    // it is verified rather than trusted: the key must sit in this student's
    // own namespace inside a config that is actually active.
    let storedId = null
    let storedKey = null
    if (objectKey || storageId) {
      const { rows: cfgRows } = await query(
        `SELECT id, prefix FROM tenant_storage WHERE id = $1 AND status = 'active'`,
        [storageId],
      )
      const cfg = cfgRows[0]
      if (!cfg || !keyBelongsTo(cfg, objectKey, req.auth.sub)) {
        return res.status(400).json({ error: 'That file reference is not valid.' })
      }
      storedId = cfg.id
      storedKey = String(objectKey)
    } else {
      // No pointer: this is the legacy base64 path. Refuse it when the school
      // does have a bucket, rather than adding new bytes to the column #143
      // step 6 exists to drain — the client should have used the presigned
      // upload, so this means something went wrong worth surfacing.
      //
      // Guarded on the encryption key as well: without it the presigned route
      // returns 503, so refusing here too would leave the student unable to
      // submit anything at all. Falling back to base64 is the lesser evil.
      const active = hasEncryptionKey() ? await activeStorageForSchool(schoolId) : null
      if (active) {
        return res.status(409).json({
          error: 'Your school stores documents in its own storage. Please retry the upload.',
        })
      }
      // These bytes live in our database, so one account can't be allowed to
      // fill it: a cap on what each student keeps here.
      const { rows: usage } = await query(
        'SELECT COALESCE(SUM(octet_length(file_data)), 0)::bigint AS bytes FROM pdf_uploads WHERE user_id = $1',
        [req.auth.sub],
      )
      if (Number(usage[0].bytes) + fileData.length > MAX_STORED_DOCUMENT_BYTES_PER_STUDENT) {
        return res.status(413).json({ error: 'You have reached the storage limit for submitted documents. Ask your school to review the ones already sent.' })
      }
    }

    const id = uid('pdf')
    await query(
      `INSERT INTO pdf_uploads (id, user_id, school_id, filename, file_data, file_type, storage_id, object_key, file_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        req.auth.sub,
        schoolId,
        filename,
        storedKey ? null : fileData,
        type,
        storedId,
        storedKey,
        storedKey && Number.isInteger(fileBytes) ? fileBytes : null,
      ],
    )
    return res.status(201).json({ ok: true, id, direct: Boolean(storedKey) })
  } catch (error) {
    console.error('pdf upload failed:', error)
    return res.status(500).json({ error: 'Could not upload file.' })
  }
})

// Get PDFs for a student (school admin can see all, student can see own)
router.get('/pdfs', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    if (req.auth.role === 'school' || req.auth.role === 'school_staff') {
      const { rows: userRows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
      if (!userRows[0]?.school_id) return res.status(404).json({ error: 'School not found.' })
      const { rows } = await query(
        `SELECT p.id, p.user_id, u.name AS user_name, u.email AS user_email, p.filename, p.file_type, p.status, p.notes, p.created_at
         FROM pdf_uploads p JOIN users u ON p.user_id = u.id
         WHERE p.school_id = $1 AND u.school_id = $1
         ORDER BY p.created_at DESC`,
        [userRows[0].school_id],
      )
      return res.json({ pdfs: rows })
    }
    const { rows } = await query(
      `SELECT id, filename, file_type, status, notes, created_at
       FROM pdf_uploads WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.auth.sub],
    )
    return res.json({ pdfs: rows })
  } catch (error) {
    console.error('pdf list failed:', error)
    return res.status(500).json({ error: 'Could not fetch PDFs.' })
  }
})

// Get a single PDF with file data
router.get('/pdf/:id', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM pdf_uploads WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'PDF not found.' })

    const pdf = rows[0]
    // Default-deny: only the owning student, an admin, or staff at the
    // owning school may read a PDF (which includes its base64 file data).
    // Any other role falls through to a 403 rather than being allowed by omission.
    const { role, sub } = req.auth
    let allowed = false
    if (role === 'admin') {
      allowed = true
    } else if (role === 'student') {
      allowed = pdf.user_id === sub
    } else if (role === 'school' || role === 'school_staff') {
      // Only while the student is still at this school: a former school no
      // longer sees their record (see the transfer step above).
      const { rows: userRows } = await query('SELECT id, school_id FROM users WHERE id = ANY($1::text[])', [[sub, pdf.user_id]])
      const staffSchool = userRows.find((u) => u.id === sub)?.school_id
      const studentSchool = userRows.find((u) => u.id === pdf.user_id)?.school_id
      allowed = Boolean(staffSchool) && pdf.school_id === staffSchool && studentSchool === staffSchool
    }
    if (!allowed) {
      // An attempt is as interesting as a success.
      recordAudit(req, {
        action: AUDIT.PDF_READ,
        outcome: 'denied',
        subjectUserId: pdf.user_id,
        schoolId: pdf.school_id,
        objectType: 'pdf_upload',
        objectId: pdf.id,
      })
      return res.status(403).json({ error: 'Not allowed.' })
    }

    // This response hands over the document — either the base64 itself or a
    // URL that works for whoever holds it — so the read is exactly the kind
    // that must leave a trace. The key is recorded, never the signed URL,
    // which is itself a live grant.
    recordAudit(req, {
      action: AUDIT.PDF_READ,
      subjectUserId: pdf.user_id,
      schoolId: pdf.school_id,
      objectType: 'pdf_upload',
      objectId: pdf.id,
      meta: { filename: pdf.filename, ...(pdf.object_key ? { key: pdf.object_key, storageId: pdf.storage_id } : {}) },
    })

    const base = {
      id: pdf.id,
      filename: pdf.filename,
      fileType: pdf.file_type,
      status: pdf.status,
      notes: pdf.notes,
      createdAt: pdf.created_at,
    }

    // A document in the school's own bucket: mint a short-lived GET rather
    // than proxying the bytes through us.
    if (pdf.object_key && pdf.storage_id) {
      const { rows: cfgRows } = await query('SELECT * FROM tenant_storage WHERE id = $1', [pdf.storage_id])
      if (!cfgRows[0]) {
        return res.status(410).json({ error: 'The storage this document was written to is no longer configured.' })
      }
      const expiresIn = 300
      const url = presign(usableStorage(cfgRows[0]), { method: 'GET', key: pdf.object_key, expiresIn })
      return res.json({ pdf: { ...base, url, expiresIn } })
    }

    return res.json({ pdf: { ...base, fileData: pdf.file_data } })
  } catch (error) {
    console.error('pdf get failed:', error)
    return res.status(500).json({ error: 'Could not fetch PDF.' })
  }
})

// Approve or reject a PDF (school admin)
router.patch('/pdf/:id/review', limiter, requireDb, requireAuth('school', 'school_staff'), requirePaidSchool, async (req, res) => {
  const { status, notes } = req.body
  if (!status || !['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Status must be approved or rejected.' })

  try {
    const { rows: userRows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    const { rows } = await query('SELECT * FROM pdf_uploads WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'PDF not found.' })
    if (rows[0].school_id !== userRows[0]?.school_id) return res.status(403).json({ error: 'Not your school.' })
    const { rows: studentRows } = await query('SELECT school_id FROM users WHERE id = $1', [rows[0].user_id])
    if (studentRows[0]?.school_id !== rows[0].school_id) return res.status(403).json({ error: 'This student is no longer at your school.' })

    await query(
      'UPDATE pdf_uploads SET status = $1, notes = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $4',
      [status, notes || null, req.auth.sub, req.params.id],
    )
    recordAudit(req, {
      action: AUDIT.PDF_REVIEWED,
      subjectUserId: rows[0].user_id,
      schoolId: rows[0].school_id,
      objectType: 'pdf_upload',
      objectId: req.params.id,
      meta: { status },
    })
    return res.json({ ok: true })
  } catch (error) {
    console.error('pdf review failed:', error)
    return res.status(500).json({ error: 'Could not update PDF.' })
  }
})

// Get school info by pin or id
router.get('/info', limiter, requireDb, async (req, res) => {
  const pin = String(req.query.pin || '').trim().toLowerCase()
  const id = String(req.query.id || '').trim()
  if (!pin && !id) return res.status(400).json({ error: 'School code or id required.' })
  try {
    // This route is unauthenticated (a public join pin is enough), so it must
    // not expose the bank/payment confirmation reference the school submitted.
    // payment_notes is kept — the school's own dashboard shows it as the
    // "confirmation could not be verified" message (SchoolDashboard.jsx).
    const cols = 'id, name, pin, payment_status, payment_notes, paid_at, payment_due_date'
    let rows
    if (pin) {
      const r = await query(`SELECT ${cols} FROM schools WHERE pin = $1`, [pin])
      rows = r.rows
    } else {
      const r = await query(`SELECT ${cols} FROM schools WHERE id = $1`, [id])
      rows = r.rows
    }
    if (rows.length === 0) return res.status(404).json({ error: 'No school found.' })
    const school = rows[0]

    // The join code and the payment state are the school's own business. This
    // route has to stay unauthenticated so someone can look a school up by its
    // code before they have an account, but that means anyone holding a school
    // id could otherwise read the code back out — and a linked student has no
    // use for it beyond passing it on. So the public shape is just id + name,
    // and the rest is added only for the school's own admins.
    let privileged = req.auth?.role === 'admin'
    if (!privileged && (req.auth?.role === 'school' || req.auth?.role === 'school_staff')) {
      const me = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
      privileged = me.rows[0]?.school_id === school.id
    }
    if (!privileged) return res.json({ school: { id: school.id, name: school.name } })

    return res.json({ school: { id: school.id, name: school.name, pin: school.pin, paymentStatus: school.payment_status, paymentNotes: school.payment_notes, paidAt: school.paid_at, paymentDueDate: school.payment_due_date } })
  } catch (error) {
    return res.status(500).json({ error: 'Could not fetch school.' })
  }
})

// Change this school's join code (school admin only — not school_staff, who
// can review hours but shouldn't be able to invalidate the code students are
// being handed). Rotating is safe: /join copies the school id onto the user
// row, so already-linked students keep their link when the code changes.
router.patch('/code', limiter, requireDb, requireAuth('school'), async (req, res) => {
  const pin = String(req.body.pin || '').trim().toLowerCase()

  if (!pin) return res.status(400).json({ error: 'School code is required.' })
  if (!/^[a-z]+-?\d{3,5}$/.test(pin)) return res.status(400).json({ error: 'School code must be letters followed by digits (e.g. cisd-12345).' })

  try {
    const { rows: userRows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    const schoolId = userRows[0]?.school_id
    if (!schoolId) return res.status(404).json({ error: 'School not found.' })

    const { rows: current } = await query('SELECT pin FROM schools WHERE id = $1', [schoolId])
    if (current.length === 0) return res.status(404).json({ error: 'School not found.' })
    if (current[0].pin === pin) return res.json({ ok: true, pin })

    // Pre-checked for a friendly message; the UNIQUE index on schools.pin is
    // what actually prevents two schools racing onto the same code.
    const existing = await query('SELECT 1 FROM schools WHERE pin = $1', [pin])
    if (existing.rowCount > 0) return res.status(409).json({ error: 'That school code is already taken.' })

    await query('UPDATE schools SET pin = $1 WHERE id = $2', [pin, schoolId])
    return res.json({ ok: true, pin })
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That school code is already taken.' })
    console.error('school code change failed:', error)
    return res.status(500).json({ error: 'Could not update school code.' })
  }
})

// --- Public volunteer tasks (any user can post, any user can sign up) ---

// Create a public task (phone required)
// A task's map position. Stored values feed everyone's distance search, so
// they're range-checked: undefined/'' means none, anything else must be real.
function coordinate(value, max) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null }
  const n = Number(value)
  return Number.isFinite(n) && Math.abs(n) <= max ? { ok: true, value: n } : { ok: false }
}

// A task's category: one of the app's activity categories (the same list as
// src/lib/categories.js), or none. '' and null both mean none.
const TASK_CATEGORIES = [
  'Community Service', 'Environmental', 'Education & Tutoring', 'Health & Wellness', 'Animal Welfare',
  'Arts & Culture', 'Sports & Coaching', 'Religious & Faith', 'Political & Advocacy', 'Disaster Relief', 'Other',
]
const taskCategory = (v) => (v == null || v === '' ? { ok: true, value: null }
  : TASK_CATEGORIES.includes(v) ? { ok: true, value: v } : { ok: false })

router.post('/public-tasks', limiter, requireDb, requireAuth(), async (req, res) => {
  const { title, description, location, date, time, slotsTotal, phone, latitude, longitude, importantInfo } = req.body
  const category = taskCategory(req.body.category)
  if (!category.ok) return res.status(400).json({ error: 'Pick a category from the list.' })
  const lat = coordinate(latitude, 90)
  const lng = coordinate(longitude, 180)
  if (!lat.ok || !lng.ok) return res.status(400).json({ error: 'Invalid map position.' })
  if (!title || !description || !location || !date) return res.status(400).json({ error: 'Title, description, location, and date required.' })
  if (!phone) return res.status(400).json({ error: 'Phone number is required so volunteers can reach you.' })
  if (!isValidDateString(date)) return res.status(400).json({ error: 'Enter the date as YYYY-MM-DD.' })
  // Yesterday is allowed so a host a few time zones behind the server can
  // still post something happening today.
  if (date < new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)) {
    return res.status(400).json({ error: 'The task date is in the past.' })
  }
  // Only the global 1MB body limit bounded these before, and GET /public-tasks
  // returns them to every visitor — cap each one like /messages does.
  const textLimits = [
    ['Title', title, 200],
    ['Description', description, 5000],
    ['Location', location, 300],
    ['Phone number', phone, 30],
    ['Time', time, 20],
    ['Important info', importantInfo, 2000],
  ]
  for (const [label, value, max] of textLimits) {
    if (value != null && (typeof value !== 'string' || value.length > max)) {
      return res.status(400).json({ error: `${label} must be text of at most ${max} characters.` })
    }
  }
  // A negative or non-integer slot count is truthy and numeric, so it would
  // slip past the `|| 1` default below and permanently lock the task as full.
  // Same bounds as editing the task (PATCH below); a huge number overflowed
  // the INTEGER column and came back as a server error.
  if (slotsTotal != null && slotsTotal !== '' && (!Number.isInteger(Number(slotsTotal)) || Number(slotsTotal) < 1 || Number(slotsTotal) > 1000)) {
    return res.status(400).json({ error: 'Volunteers needed must be between 1 and 1000.' })
  }
  // "Repeat every week for N more weeks": N copies, each 7 days after the
  // last. Absent or 0 is the plain single task.
  const { repeatWeeks } = req.body
  const repeat = repeatWeeks == null || repeatWeeks === '' ? 0 : Number(repeatWeeks)
  if (!['number', 'string'].includes(typeof (repeatWeeks ?? 0)) || !Number.isInteger(repeat) || repeat < 0 || repeat > 12) {
    return res.status(400).json({ error: 'Repeat weekly must be between 0 and 12 more weeks.' })
  }
  // Day arithmetic in UTC, so a daylight-saving change can't shift a copy.
  const dates = Array.from({ length: repeat + 1 }, (_, i) => {
    const d = new Date(`${date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 7 * i)
    return d.toISOString().slice(0, 10)
  })

  try {
    const { rows } = await query('SELECT name, email, posting_suspended_at FROM users WHERE id = $1', [req.auth.sub])
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' })
    // Suspended by the admin after a report (server/routes/reports.js).
    if (rows[0].posting_suspended_at) {
      return res.status(403).json({ error: "Your account can't post volunteer tasks right now. Contact us if you think this is a mistake." })
    }

    // Every week of a repeat goes in together or not at all, so a failure
    // can't leave the organizer with half a series to find and fix.
    const created = []
    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      for (const day of dates) {
        const id = uid('ptask')
        await client.query(
          `INSERT INTO public_tasks (id, title, description, location, date, time, slots_total, created_by, creator_name, creator_email, phone, latitude, longitude, important_info, category)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [id, title, description, location, day, time || null, Number(slotsTotal) || 1, req.auth.sub, rows[0].name, rows[0].email, phone, lat.value, lng.value, importantInfo || null, category.value],
        )
        created.push({ id, date: day })
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
    // Once per post, after it's saved: a weekly series is one email, not one per week.
    notifyFollowers(req.auth.sub, created[0].id)
    return res.status(201).json({ ok: true, id: created[0].id, createdCount: created.length, tasks: created })
  } catch (error) {
    console.error('create public task failed:', error)
    return res.status(500).json({ error: 'Could not create task.' })
  }
})

// List open public tasks. Phone hidden unless user is signed up and approved.
// Accept optional lat/lng query params to sort by distance.
// Accept optional maxDistance (km) to filter by radius.
router.get('/public-tasks', limiter, requireDb, authenticate, async (req, res) => {
  try {
    const userId = req.auth?.sub || null
    const lat = req.query.lat ? Number(req.query.lat) : null
    const lng = req.query.lng ? Number(req.query.lng) : null
    const maxDistance = req.query.maxDistance ? Number(req.query.maxDistance) : null
    // Out-of-range coordinates made the distance maths fail (ASIN of a value
    // above 1) and took the whole list down with it; they're ignored instead.
    const useDist = lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng)
      && Math.abs(lat) <= 90 && Math.abs(lng) <= 180

    const params = userId ? [userId] : []

    const distExpr = useDist
      ? `CASE WHEN t.latitude IS NOT NULL AND t.longitude IS NOT NULL THEN
           6371 * 2 * ASIN(LEAST(1, SQRT(
             POWER(SIN(RADIANS(t.latitude - $${params.length + 1}) / 2), 2) +
             COS(RADIANS($${params.length + 1})) * COS(RADIANS(t.latitude)) *
             POWER(SIN(RADIANS(t.longitude - $${params.length + 2}) / 2), 2)
           )))
         ELSE NULL END AS distance`
      : 'NULL AS distance'

    const selectParams = useDist ? [...params, lat, lng] : [...params]

    // Radius filter runs against `sub.distance` (the column already computed
    // in the inner SELECT) — the `t` alias is out of scope at this outer
    // level. `sub.distance` is NULL for tasks with no coordinates, which are
    // excluded from a radius-filtered result.
    const filterByRadius = useDist && maxDistance && !isNaN(maxDistance)
    const filterClause = filterByRadius
      ? `WHERE sub.distance IS NOT NULL AND sub.distance <= $${selectParams.length + 1}`
      : ''
    const filterParams = filterByRadius ? [maxDistance] : []

    const { rows } = await query(
      `SELECT * FROM (
        SELECT t.id, t.title, t.description, t.location, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.slots_total, t.status, t.category,
               t.creator_name, t.latitude, t.longitude, ${distExpr}, t.created_at,
               (SELECT COUNT(*) FROM public_task_signups WHERE task_id = t.id AND status IN ('pending', 'approved')) AS slots_filled,
               (SELECT COUNT(*) FROM public_task_signups WHERE task_id = t.id AND status = 'waitlisted') AS waitlist_count,
               ${userId ? `(SELECT status FROM public_task_signups WHERE task_id = t.id AND user_id = $1) AS my_signup_status` : 'NULL AS my_signup_status'},
               ${userId ? `${WAITLIST_POSITION_SQL('t.id', '$1')} AS my_waitlist_position` : 'NULL AS my_waitlist_position'},
               ${userId ? `CASE WHEN (SELECT status FROM public_task_signups WHERE task_id = t.id AND user_id = $1) = 'approved' THEN t.phone ELSE NULL END AS phone` : 'NULL AS phone'},
               ${userId ? `CASE WHEN (SELECT status FROM public_task_signups WHERE task_id = t.id AND user_id = $1) = 'approved' THEN t.important_info ELSE NULL END AS important_info` : 'NULL AS important_info'},
               t.created_by AS organizer_id,
               ${userId ? 'EXISTS (SELECT 1 FROM organizer_follows f WHERE f.user_id = $1 AND f.organizer_id = t.created_by)' : 'false'} AS i_follow_organizer,
               ${userId ? 'EXISTS (SELECT 1 FROM saved_tasks st WHERE st.user_id = $1 AND st.task_id = t.id)' : 'false'} AS i_saved,
               -- The organizer's average across all their tasks, only once
               -- three students have rated: one or two ratings say too little.
               CASE WHEN orating.n >= 3 THEN orating.avg END AS organizer_rating_avg,
               CASE WHEN orating.n >= 3 THEN orating.n END AS organizer_rating_count
        FROM public_tasks t
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS n, ROUND(AVG(r.stars)::numeric, 1)::float8 AS avg
            FROM task_ratings r JOIN public_tasks rt ON rt.id = r.task_id
           WHERE rt.created_by = t.created_by
        ) orating ON true
        -- A task whose day has passed isn't an opportunity any more. One day
        -- of slack, since the server's "today" is UTC's, ahead of US dates.
        WHERE t.status = 'open' AND t.date >= CURRENT_DATE - 1
          -- Report and block (server/routes/reports.js): nothing from an
          -- organizer the admin suspended, or one this viewer blocked.
          AND NOT EXISTS (SELECT 1 FROM users cu WHERE cu.id = t.created_by AND cu.posting_suspended_at IS NOT NULL)
          ${userId ? 'AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = $1 AND b.blocked_id = t.created_by)' : ''}
       ) sub
       ${filterClause}
       ${useDist ? `ORDER BY distance ASC NULLS LAST, date ASC, created_at DESC` : 'ORDER BY date ASC, created_at DESC'}`,
      [...selectParams, ...filterParams],
    )
    return res.json({ tasks: rows })
  } catch (error) {
    console.error('list public tasks failed:', error)
    return res.status(500).json({ error: 'Could not fetch tasks.' })
  }
})

// --- Following an organizer --------------------------------------------------
// A student follows an organizer from a task card on Opportunities and is
// emailed when that organizer posts a new task (notifyFollowers below).

// GET /api/school/public-tasks/organizers/following — who the caller follows.
router.get('/public-tasks/organizers/following', limiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.name FROM organizer_follows f JOIN users u ON u.id = f.organizer_id
        WHERE f.user_id = $1 ORDER BY f.created_at DESC`,
      [req.auth.sub],
    )
    return res.json({ following: rows })
  } catch (error) {
    console.error('following list failed:', error)
    return res.status(500).json({ error: 'Could not load who you follow.' })
  }
})

// POST /api/school/public-tasks/organizers/:organizerId/follow
router.post('/public-tasks/organizers/:organizerId/follow', limiter, requireDb, requireAuth('student'), async (req, res) => {
  const organizerId = String(req.params.organizerId)
  if (organizerId === req.auth.sub) return res.status(400).json({ error: "You can't follow yourself." })
  try {
    // Only someone who has posted a volunteer task can be followed, so this
    // can't be used to probe for arbitrary account IDs.
    const { rows } = await query(
      `SELECT EXISTS (SELECT 1 FROM public_tasks WHERE created_by = $1) AS posts,
              EXISTS (SELECT 1 FROM user_blocks WHERE blocker_id = $2 AND blocked_id = $1) AS blocked`,
      [organizerId, req.auth.sub],
    )
    if (!rows[0].posts) return res.status(404).json({ error: 'Organizer not found.' })
    if (rows[0].blocked) return res.status(400).json({ error: 'You blocked this organizer. Unblock them in Settings to follow them.' })
    await query(
      'INSERT INTO organizer_follows (user_id, organizer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.auth.sub, organizerId],
    )
    return res.json({ ok: true, following: true })
  } catch (error) {
    console.error('follow organizer failed:', error)
    return res.status(500).json({ error: 'Could not follow this organizer.' })
  }
})

// DELETE /api/school/public-tasks/organizers/:organizerId/follow
router.delete('/public-tasks/organizers/:organizerId/follow', limiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    await query('DELETE FROM organizer_follows WHERE user_id = $1 AND organizer_id = $2', [req.auth.sub, String(req.params.organizerId)])
    return res.json({ ok: true, following: false })
  } catch (error) {
    console.error('unfollow organizer failed:', error)
    return res.status(500).json({ error: 'Could not unfollow this organizer.' })
  }
})

// --- Saving a task for later -------------------------------------------------
// A student bookmarks a task on Opportunities. The daily run-reminders job
// rings their bell once if it's about to happen or fill up and they still
// haven't signed up (remindSavedTasks below). Saving and signing up are
// independent: a saved task stays saved after you sign up.

// GET /api/school/public-tasks/saved — the caller's saved tasks that are still
// an opportunity: open, not past (same one day of slack as the main list), and
// not from an organizer who is suspended or whom the caller blocked. Same card
// shape as GET /public-tasks, plus saved_at and signed_up.
router.get('/public-tasks/saved', limiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT t.id, t.title, t.description, t.location, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.slots_total, t.status, t.category,
              t.creator_name, t.latitude, t.longitude, NULL AS distance, t.created_at,
              (SELECT COUNT(*) FROM public_task_signups WHERE task_id = t.id AND status IN ('pending', 'approved')) AS slots_filled,
              (SELECT COUNT(*) FROM public_task_signups WHERE task_id = t.id AND status = 'waitlisted') AS waitlist_count,
              my.status AS my_signup_status,
              ${WAITLIST_POSITION_SQL('t.id', '$1')} AS my_waitlist_position,
              CASE WHEN my.status = 'approved' THEN t.phone ELSE NULL END AS phone,
              CASE WHEN my.status = 'approved' THEN t.important_info ELSE NULL END AS important_info,
              t.created_by AS organizer_id,
              EXISTS (SELECT 1 FROM organizer_follows f WHERE f.user_id = $1 AND f.organizer_id = t.created_by) AS i_follow_organizer,
              true AS i_saved,
              st.created_at AS saved_at,
              (my.status IS NOT NULL) AS signed_up,
              CASE WHEN orating.n >= 3 THEN orating.avg END AS organizer_rating_avg,
              CASE WHEN orating.n >= 3 THEN orating.n END AS organizer_rating_count
         FROM saved_tasks st
         JOIN public_tasks t ON t.id = st.task_id
         LEFT JOIN public_task_signups my ON my.task_id = t.id AND my.user_id = $1
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS n, ROUND(AVG(r.stars)::numeric, 1)::float8 AS avg
             FROM task_ratings r JOIN public_tasks rt ON rt.id = r.task_id
            WHERE rt.created_by = t.created_by
         ) orating ON true
        WHERE st.user_id = $1
          AND t.status = 'open' AND t.date >= CURRENT_DATE - 1
          AND NOT EXISTS (SELECT 1 FROM users cu WHERE cu.id = t.created_by AND cu.posting_suspended_at IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = $1 AND b.blocked_id = t.created_by)
        ORDER BY t.date ASC, t.created_at DESC`,
      [req.auth.sub],
    )
    return res.json({ tasks: rows })
  } catch (error) {
    console.error('saved tasks list failed:', error)
    return res.status(500).json({ error: 'Could not load your saved tasks.' })
  }
})

// PUT /api/school/public-tasks/:id/save — idempotent. Only a task the caller
// could see on Opportunities can be saved (open, not past, organizer neither
// suspended nor blocked by them), so this can't probe for hidden task IDs.
router.put('/public-tasks/:id/save', limiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT 1 FROM public_tasks t
        WHERE t.id = $1 AND t.status = 'open' AND t.date >= CURRENT_DATE - 1
          AND NOT EXISTS (SELECT 1 FROM users cu WHERE cu.id = t.created_by AND cu.posting_suspended_at IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = $2 AND b.blocked_id = t.created_by)`,
      [String(req.params.id), req.auth.sub],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Task not found.' })
    await query(
      'INSERT INTO saved_tasks (user_id, task_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.auth.sub, String(req.params.id)],
    )
    return res.json({ ok: true, saved: true })
  } catch (error) {
    console.error('save task failed:', error)
    return res.status(500).json({ error: 'Could not save this task.' })
  }
})

// DELETE /api/school/public-tasks/:id/save — idempotent; works on any task,
// so a cancelled or hidden one can still be cleared.
router.delete('/public-tasks/:id/save', limiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    await query('DELETE FROM saved_tasks WHERE user_id = $1 AND task_id = $2', [req.auth.sub, String(req.params.id)])
    return res.json({ ok: true, saved: false })
  } catch (error) {
    console.error('unsave task failed:', error)
    return res.status(500).json({ error: 'Could not unsave this task.' })
  }
})

// Part of the daily run-reminders job. One bell notification per saved task —
// no email: a bookmark is a light signal, and the student didn't ask to be
// mailed about it. Fires when a saved task the student hasn't signed up for
// (no signup row of any status, so waitlisted / parent-pending / declined all
// count as having acted) is 0–2 days away or at least 80% full. The UPDATE
// stamps reminded_at and returns the rows in one statement, so a duplicate
// run can't ring twice. Same skips as everything else that reaches a student
// on an organizer's behalf: suspended organizers, blocked organizers, and
// under-13 accounts still waiting on a parent.
async function remindSavedTasks({ dryRun = false } = {}) {
  const due = `
         st.reminded_at IS NULL
     AND t.id = st.task_id AND u.id = st.user_id
     AND t.status = 'open'
     AND t.date >= CURRENT_DATE
     AND (u.parental_consent_status IS NULL OR u.parental_consent_status <> 'pending')
     AND NOT EXISTS (SELECT 1 FROM public_task_signups s WHERE s.task_id = t.id AND s.user_id = st.user_id)
     AND NOT EXISTS (SELECT 1 FROM users cu WHERE cu.id = t.created_by AND cu.posting_suspended_at IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = st.user_id AND b.blocked_id = t.created_by)
     AND (t.date <= CURRENT_DATE + 2
          OR (t.slots_total > 0 AND (SELECT COUNT(*) FROM public_task_signups f
                                      WHERE f.task_id = t.id AND f.status IN ('pending', 'approved')) >= 0.8 * t.slots_total))`
  if (dryRun) {
    const { rows } = await query(`SELECT COUNT(*)::int AS n FROM saved_tasks st, public_tasks t, users u WHERE ${due}`)
    return { due: rows[0].n, notified: 0, dryRun: true }
  }
  const { rows } = await query(
    `UPDATE saved_tasks st SET reminded_at = now()
       FROM public_tasks t, users u
      WHERE ${due}
  RETURNING st.user_id, t.id AS task_id, t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.slots_total,
            (t.date <= CURRENT_DATE + 2) AS soon,
            (SELECT COUNT(*)::int FROM public_task_signups f WHERE f.task_id = t.id AND f.status IN ('pending', 'approved')) AS filled`,
  )
  for (const r of rows) {
    const when = [r.date, r.time].filter(Boolean).join(' at ')
    const spots = Math.max(0, Number(r.slots_total) - r.filled)
    // Awaited (it never throws) so the cron's response means "done".
    await notify(r.user_id, {
      kind: 'saved_task_reminder',
      title: r.title,
      body: r.soon
        ? `A task you saved is coming up${when ? ` · ${when}` : ''}. Sign up if you're going.`
        : spots === 0
          ? 'A task you saved is full now. You can still join the waitlist.'
          : `A task you saved is filling up: ${spots} ${spots === 1 ? 'spot' : 'spots'} left.`,
      link: `/opportunities?task=${encodeURIComponent(r.task_id)}`,
    })
  }
  return { due: rows.length, notified: rows.length }
}

// Emails each follower about a new task. Fire-and-forget, like
// notifySignupDecision: never awaited, so it can't fail or slow the post.
// One message per address (never a shared thread — see taskEmailHtml).
// Skipped: a suspended organizer, a closed task, followers who blocked the
// organizer, under-13 accounts still waiting on a parent, and — as
// announcements do — the @test.com fixtures. Throttle: the UPDATE claims only
// follows not emailed in the last hour and stamps them in the same statement,
// so a burst of postings (or a repeating task) sends each follower one email.
async function notifyFollowers(organizerId, taskId) {
  try {
    const { rows: taskRows } = await query(
      `SELECT t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location, t.creator_name
         FROM public_tasks t JOIN users o ON o.id = t.created_by
        WHERE t.id = $1 AND t.created_by = $2 AND t.status = 'open' AND o.posting_suspended_at IS NULL`,
      [taskId, organizerId],
    )
    const task = taskRows[0]
    if (!task) return
    // The bell gets every post, unthrottled: an in-app entry costs nobody an
    // email. Same skips as the email, minus the @test.com one.
    const { rows: followers } = await query(
      `SELECT f.user_id FROM organizer_follows f JOIN users u ON u.id = f.user_id
        WHERE f.organizer_id = $1
          AND (u.parental_consent_status IS NULL OR u.parental_consent_status <> 'pending')
          AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = f.user_id AND b.blocked_id = $1)`,
      [organizerId],
    )
    const when = [task.date, task.time].filter(Boolean).join(' at ')
    for (const f of followers) {
      notify(f.user_id, {
        kind: 'new_task',
        title: task.title,
        body: `New from ${task.creator_name || 'an organizer you follow'}${when ? ` · ${when}` : ''}`,
        link: `/opportunities?task=${encodeURIComponent(taskId)}`,
      })
    }
    const { rows } = await query(
      `UPDATE organizer_follows f SET last_notified_at = now()
         FROM users u
        WHERE f.organizer_id = $1 AND u.id = f.user_id AND u.email IS NOT NULL
          AND (f.last_notified_at IS NULL OR f.last_notified_at < now() - interval '1 hour')
          AND (u.parental_consent_status IS NULL OR u.parental_consent_status <> 'pending')
          AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = f.user_id AND b.blocked_id = $1)
        RETURNING u.email, u.name`,
      [organizerId],
    )
    const subject = `New task from ${task.creator_name || 'an organizer'}: ${task.title}`
    const seen = new Set()
    for (const r of rows) {
      const email = String(r.email).trim().toLowerCase()
      if (!email || seen.has(email)) continue
      seen.add(email)
      if (email.endsWith('@test.com')) {
        console.log(`[follow] skipped @test.com fixture ${email}: ${subject}`)
        continue
      }
      await sendEmail({
        to: email,
        subject,
        html: taskEmailHtml({
          heading: 'A new volunteer task',
          lines: [
            `Hi ${r.name || 'there'}, ${task.creator_name || 'an organizer you follow'} just posted a new task. Sign up from Opportunities in VolunTrack.`,
            'You get these because you follow this organizer. Unfollow from Opportunities to stop them.',
          ],
          task,
        }),
      })
    }
  } catch (error) {
    console.error('follower notification failed:', error)
  }
}

// Add to calendar: a task as an .ics file, which phones and calendar apps
// open as "add this event". Public, like the task list: no sign-in, and only
// for a task the list would show. The event rules (two hours, or all day
// without a time; floating times) live in ../ics.js, shared with the feed.
router.get('/public-tasks/:id/calendar.ics', limiter, requireDb, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT t.id, t.title, t.description, t.location, to_char(t.date, 'YYYY-MM-DD') AS date, t.time,
              t.creator_name, t.latitude, t.longitude
         FROM public_tasks t
        WHERE t.id = $1 AND t.status <> 'cancelled'
          AND NOT EXISTS (SELECT 1 FROM users cu WHERE cu.id = t.created_by AND cu.posting_suspended_at IS NOT NULL)`,
      [req.params.id],
    )
    const t = rows[0]
    if (!t) return res.status(404).json({ error: 'Task not found.' })
    const site = String(process.env.FRONTEND_URL || '').replace(/\/$/, '')
    res.set('Content-Type', 'text/calendar; charset=utf-8')
    res.set('Content-Disposition', 'attachment; filename="volunteer-task.ics"')
    res.set('Cache-Control', 'no-store')
    return res.send(icsCalendar([icsEvent(t, { link: site && `${site}/opportunities` })]))
  } catch (error) {
    console.error('task calendar file failed:', error)
    return res.status(500).json({ error: 'Could not make the calendar file.' })
  }
})

// Calendar feed: one subscribable .ics link per student or Task Maker that
// lists their sign-ups and the tasks they posted, so a calendar app keeps them
// up to date. The link's secret (users.calendar_token) is the only credential
// — calendar apps can't send a sign-in — so it is made on first request and a
// reset replaces it, which kills the old link. The URL points at this backend,
// since that is what the calendar app fetches.
const FEED_ROLES = ['student', 'volunteer']
const FEED_TOKEN_RE = /^[0-9a-f]{64}$/

function calendarFeedUrl(req, token) {
  const base = process.env.PUBLIC_BACKEND_URL
    || (process.env.NODE_ENV === 'production' ? 'https://voluntrack-backend-frrh.onrender.com' : `${req.protocol}://${req.get('host')}`)
  return `${String(base).replace(/\/$/, '')}/api/school/calendar/${token}.ics`
}

// Calendar apps poll every few hours; this only stops someone hammering the
// feed or trying tokens.
const calendarFeedLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please try again later.',
})

router.get('/calendar/feed', limiter, requireDb, requireAuth(...FEED_ROLES), async (req, res) => {
  try {
    // COALESCE keeps an existing token, so two tabs asking at once agree.
    const { rows } = await query(
      'UPDATE users SET calendar_token = COALESCE(calendar_token, $2) WHERE id = $1 RETURNING calendar_token',
      [req.auth.sub, generateToken()],
    )
    if (!rows[0]) return res.status(404).json({ error: 'Account not found.' })
    return res.json({ url: calendarFeedUrl(req, rows[0].calendar_token) })
  } catch (error) {
    console.error('calendar feed link failed:', error)
    return res.status(500).json({ error: 'Could not make your calendar link.' })
  }
})

router.post('/calendar/feed/reset', limiter, requireDb, requireAuth(...FEED_ROLES), async (req, res) => {
  try {
    const { rows } = await query(
      'UPDATE users SET calendar_token = $2 WHERE id = $1 RETURNING calendar_token',
      [req.auth.sub, generateToken()],
    )
    if (!rows[0]) return res.status(404).json({ error: 'Account not found.' })
    return res.json({ url: calendarFeedUrl(req, rows[0].calendar_token) })
  } catch (error) {
    console.error('calendar feed reset failed:', error)
    return res.status(500).json({ error: 'Could not reset your calendar link.' })
  }
})

// Public: no sign-in, the token is the credential. Sign-ups that still count
// (pending, approved, waitlisted, waiting for a parent's OK) and the user's own posted tasks, not
// cancelled, from 30 days ago on. Each UID is the task id, so an edited task
// updates in place in the subscriber's calendar.
router.get('/calendar/:token.ics', calendarFeedLimiter, requireDb, async (req, res) => {
  const notFound = () => res.status(404).type('text/plain').send('Calendar not found.')
  try {
    const token = String(req.params.token || '')
    if (!FEED_TOKEN_RE.test(token)) return notFound()
    const { rows: users } = await query(
      `SELECT id, role FROM users WHERE calendar_token = $1 AND role = ANY($2::text[])`,
      [token, FEED_ROLES],
    )
    const user = users[0]
    if (!user) return notFound()
    const cols = `t.id, t.title, t.description, t.location, to_char(t.date, 'YYYY-MM-DD') AS date, t.time,
                  t.creator_name, t.latitude, t.longitude`
    const [signups, posted] = await Promise.all([
      query(
        `SELECT ${cols}, s.status AS signup_status
           FROM public_task_signups s
           JOIN public_tasks t ON t.id = s.task_id
          WHERE s.user_id = $1 AND s.status IN ('pending','approved','waitlisted','parent_pending')
            AND t.status <> 'cancelled' AND t.date >= CURRENT_DATE - 30
            AND NOT EXISTS (SELECT 1 FROM users cu WHERE cu.id = t.created_by AND cu.posting_suspended_at IS NOT NULL)
          ORDER BY t.date, t.id
          LIMIT 500`,
        [user.id],
      ),
      query(
        `SELECT ${cols}
           FROM public_tasks t
          WHERE t.created_by = $1 AND t.status <> 'cancelled' AND t.date >= CURRENT_DATE - 30
          ORDER BY t.date, t.id
          LIMIT 500`,
        [user.id],
      ),
    ])
    const site = String(process.env.FRONTEND_URL || '').replace(/\/$/, '')
    const now = new Date()
    const seen = new Set()
    const events = []
    for (const t of signups.rows) {
      seen.add(t.id)
      const summaryPrefix = { waitlisted: 'Waitlist: ', pending: 'Pending: ', parent_pending: 'Needs parent OK: ' }[t.signup_status] || ''
      events.push(icsEvent(t, { link: site && `${site}/attendance`, summaryPrefix, now }))
    }
    for (const t of posted.rows) {
      if (seen.has(t.id)) continue
      events.push(icsEvent(t, { link: site && `${site}/my-tasks`, now }))
    }
    res.set('Content-Type', 'text/calendar; charset=utf-8')
    res.set('Content-Disposition', 'inline; filename="voluntrack.ics"')
    res.set('Cache-Control', 'no-store')
    return res.send(icsCalendar(events, [
      'X-WR-CALNAME:VolunTrack',
      'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
      'X-PUBLISHED-TTL:PT1H',
    ]))
  } catch (error) {
    console.error('calendar feed failed:', error)
    return res.status(500).type('text/plain').send('Could not make the calendar.')
  }
})

// Sign up for a public task
router.post('/public-tasks/:id/signup', limiter, requireDb, requireAuth(), async (req, res) => {
  // The capacity check and the insert must be atomic, or two concurrent
  // requests both read COUNT(*) = slots_total - 1 and both insert, pushing the
  // task past slots_total. Run them in one transaction and take a row lock on
  // the parent public_tasks row (SELECT ... FOR UPDATE) so signups for the same
  // task serialize: the second request blocks until the first commits, then its
  // fresh COUNT(*) reflects the row the first one added.
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT t.status, t.slots_total, t.created_by, t.date < CURRENT_DATE - 1 AS past,
              (SELECT posting_suspended_at IS NOT NULL FROM users WHERE id = t.created_by) AS host_suspended,
              EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = $2 AND b.blocked_id = t.created_by) AS host_blocked
         FROM public_tasks t WHERE t.id = $1 FOR UPDATE OF t`,
      [req.params.id, req.auth.sub],
    )
    if (rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Task not found.' })
    }
    if (rows[0].created_by === req.auth.sub) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'You are hosting this task, so you cannot sign up for it.' })
    }
    if (rows[0].status === 'cancelled') {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'This task was cancelled.' })
    }
    if (rows[0].status === 'closed') {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Task is closed.' })
    }
    if (rows[0].past) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'This task has already happened.' })
    }
    // Hidden from the list already (reports.js); refused here too.
    if (rows[0].host_suspended || rows[0].host_blocked) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: "This task isn't available." })
    }

    // Came from a friend's invite link: kept only when that friend really
    // invited this address to this task and is still going. Anything else is
    // ignored, never an error — the link is shareable and can go stale.
    const invitedBy = await verifiedInviter(client, req.params.id, req.auth.sub, req.body?.invitedBy)

    // Already signed up: return the existing row instead of reporting "full".
    // A parent's earlier no is the exception: signing up again asks again.
    const { rows: existing } = await client.query(
      'SELECT id, status FROM public_task_signups WHERE task_id = $1 AND user_id = $2',
      [req.params.id, req.auth.sub],
    )
    if (existing.length > 0 && existing[0].status !== 'parent_declined') {
      await client.query('COMMIT')
      return res.json({
        ok: true,
        id: existing[0].id,
        ...(existing[0].status === 'parent_pending' ? { parentPending: true } : {}),
      })
    }
    if (existing.length > 0) {
      await client.query('DELETE FROM public_task_signups WHERE id = $1', [existing[0].id])
    }

    // Under 13 (users.under_13, set at self-registration — see ageRules.js;
    // NULL when the age was never asked, which keeps today's flow): the
    // sign-up waits for a parent's OK, holding no slot and hidden from the
    // organizer. A full task still needs { waitlist: true }, as for anyone;
    // whether it lands as pending or waitlisted is decided when the parent
    // says yes (decideParentOk).
    const { rows: me } = await client.query('SELECT under_13 FROM users WHERE id = $1', [req.auth.sub])
    if (me[0]?.under_13 === true) {
      const { rows: taken } = await client.query(
        "SELECT COUNT(*) AS cnt FROM public_task_signups WHERE task_id = $1 AND status IN ('pending', 'approved')",
        [req.params.id],
      )
      if (Number(taken[0].cnt) >= rows[0].slots_total && req.body?.waitlist !== true) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'Task is full.' })
      }
      const pid = uid('psig')
      await client.query(
        "INSERT INTO public_task_signups (id, task_id, user_id, status, invited_by) VALUES ($1, $2, $3, 'parent_pending', $4)",
        [pid, req.params.id, req.auth.sub, invitedBy],
      )
      await client.query('COMMIT')
      const asked = await requestParentOk(pid)
      return res.json({ ok: true, id: pid, parentPending: true, parentAsked: asked })
    }

    // Rejected and waitlisted signups don't hold a slot: turning three
    // applicants away on a four-slot task used to leave room for one, and
    // then report "full".
    const { rows: signups } = await client.query(
      "SELECT COUNT(*) AS cnt FROM public_task_signups WHERE task_id = $1 AND status IN ('pending', 'approved')",
      [req.params.id],
    )
    if (Number(signups[0].cnt) >= rows[0].slots_total) {
      // Full: join the waitlist only when asked to, so an older client that
      // didn't know a task was full still gets "full" rather than a surprise.
      if (req.body?.waitlist !== true) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'Task is full.' })
      }
      const wid = uid('psig')
      await client.query(
        "INSERT INTO public_task_signups (id, task_id, user_id, status, invited_by) VALUES ($1, $2, $3, 'waitlisted', $4) ON CONFLICT DO NOTHING",
        [wid, req.params.id, req.auth.sub, invitedBy],
      )
      const { rows: pos } = await client.query(`SELECT ${WAITLIST_POSITION_SQL('$1', '$2')} AS position`, [req.params.id, req.auth.sub])
      await client.query('COMMIT')
      if (invitedBy) notifyFriendJoined(invitedBy, req.params.id, req.auth.sub)
      return res.json({ ok: true, id: wid, waitlisted: true, position: Number(pos[0].position) || 1 })
    }

    const sid = uid('psig')
    await client.query(
      'INSERT INTO public_task_signups (id, task_id, user_id, status, invited_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
      [sid, req.params.id, req.auth.sub, 'pending', invitedBy],
    )
    await client.query('COMMIT')
    if (invitedBy) notifyFriendJoined(invitedBy, req.params.id, req.auth.sub)
    return res.json({ ok: true, id: sid })
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { /* connection already broken */ }
    console.error('public task signup failed:', error)
    return res.status(500).json({ error: 'Could not sign up.' })
  } finally {
    client.release()
  }
})

// The inviter's bell: a friend they invited signed up from the link. Fire and
// forget, like notify() itself.
async function notifyFriendJoined(inviterId, taskId, friendId) {
  try {
    const { rows } = await query('SELECT t.title, u.name FROM public_tasks t, users u WHERE t.id = $1 AND u.id = $2', [taskId, friendId])
    if (!rows[0]) return
    notify(inviterId, {
      kind: 'friend_joined',
      title: `${rows[0].name || 'A friend'} is coming to ${rows[0].title}`,
      body: 'They signed up from your invite.',
      link: `/opportunities?task=${encodeURIComponent(taskId)}`,
    })
  } catch (error) {
    console.error('friend joined notification failed:', error)
  }
}

// --- Inviting friends --------------------------------------------------------
//
// A student who is going to a task can email up to INVITES_PER_TASK friends
// about it. Only a one-way hash of each address is stored (task_invites) —
// enough to cap invites and to recognise the friend when they sign up from
// the link, never enough to email them again. The response never says whether
// an address has an account: skipped addresses (the @test.com fixtures,
// under-13 accounts still waiting on a parent, people who blocked the
// organizer) count as invited like any other.

const INVITES_PER_TASK = 5

// SHA-256 with a purpose prefix, so this hash can't be matched against an
// email hash kept for another feature (transcripts hash the bare address).
function inviteEmailHash(email) {
  return createHash('sha256').update(`voluntrack-task-invite:${String(email).trim().toLowerCase()}`).digest('hex')
}

function frontendBase() {
  const first = (process.env.FRONTEND_URL || '').split(',').map((s) => s.trim()).find(Boolean)
  return (first || 'https://volunteer-track-two.vercel.app').replace(/\/$/, '')
}

// The inviter id to store on a new signup, or null. The inviter must have
// invited the caller's address to this task and still hold a live signup.
async function verifiedInviter(client, taskId, userId, invitedBy) {
  if (typeof invitedBy !== 'string' || !invitedBy || invitedBy.length > 100 || invitedBy === userId) return null
  try {
    const { rows: me } = await client.query('SELECT email FROM users WHERE id = $1', [userId])
    if (!me[0]?.email) return null
    const { rows } = await client.query(
      `SELECT 1 FROM task_invites i
         JOIN public_task_signups s ON s.task_id = i.task_id AND s.user_id = i.inviter_id AND s.status IN ('pending', 'approved')
        WHERE i.task_id = $1 AND i.inviter_id = $2 AND i.email_hash = $3`,
      [taskId, invitedBy, inviteEmailHash(me[0].email)],
    )
    return rows.length > 0 ? invitedBy : null
  } catch (error) {
    console.error('invite link check failed:', error)
    return null
  }
}

// Each invite request can fan out to five emails, so it gets its own cap on
// top of the per-task one. Counted per account (the soft global authenticate
// has already read the token), so a school network sharing one address isn't
// limited as a single person; requireAuth still rejects the anonymous.
const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => (req.auth?.sub ? `user:${req.auth.sub}` : `ip:${req.ip}`),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many invites sent. Please try again later.' },
})

router.post('/public-tasks/:id/invite', inviteLimiter, requireDb, requireAuth('student'), async (req, res) => {
  const raw = req.body?.emails
  if (!Array.isArray(raw) || raw.length === 0) {
    return res.status(400).json({ error: 'Enter at least one email address.' })
  }
  if (raw.length > 20) {
    return res.status(400).json({ error: `You can invite up to ${INVITES_PER_TASK} friends.` })
  }
  const client = await getPool().connect()
  let toSend = []
  let context = null
  try {
    await client.query('BEGIN')
    // Locking the inviter's own signup row serializes their invite requests
    // for this task, so two at once can't both pass the per-task cap.
    const { rows } = await client.query(
      `SELECT t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location, t.creator_name, t.created_by,
              t.status AS task_status, t.date < CURRENT_DATE - 1 AS past,
              (SELECT posting_suspended_at IS NOT NULL FROM users WHERE id = t.created_by) AS host_suspended,
              u.email AS my_email, u.name AS my_name
         FROM public_task_signups s
         JOIN public_tasks t ON t.id = s.task_id
         JOIN users u ON u.id = s.user_id
        WHERE s.task_id = $1 AND s.user_id = $2 AND s.status IN ('pending', 'approved')
        FOR UPDATE OF s`,
      [req.params.id, req.auth.sub],
    )
    const task = rows[0]
    if (!task) {
      await client.query('ROLLBACK')
      return res.status(403).json({ error: 'Sign up for this task before inviting friends.' })
    }
    if (task.task_status !== 'open' || task.past || task.host_suspended) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: "This task isn't taking sign-ups, so invites are off." })
    }

    const own = String(task.my_email || '').trim().toLowerCase()
    const emails = [...new Set(
      raw.filter((e) => typeof e === 'string')
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length <= 254 && validator.isEmail(e)),
    )].filter((e) => e !== own)
    if (emails.length === 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: "Enter a friend's email address (not your own)." })
    }
    if (emails.length > INVITES_PER_TASK) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: `You can invite up to ${INVITES_PER_TASK} friends at a time.` })
    }

    const { rows: prior } = await client.query(
      'SELECT email_hash FROM task_invites WHERE task_id = $1 AND inviter_id = $2',
      [req.params.id, req.auth.sub],
    )
    const already = new Set(prior.map((r) => r.email_hash))
    // Someone already invited isn't emailed twice, and doesn't use up another.
    const fresh = emails.filter((e) => !already.has(inviteEmailHash(e)))
    const remainingBefore = Math.max(0, INVITES_PER_TASK - already.size)
    if (fresh.length > remainingBefore) {
      await client.query('ROLLBACK')
      return res.status(400).json({
        error: remainingBefore === 0
          ? `You've already invited ${INVITES_PER_TASK} friends to this task.`
          : `You can invite ${remainingBefore} more ${remainingBefore === 1 ? 'friend' : 'friends'} to this task.`,
        remaining: remainingBefore,
      })
    }
    for (const e of fresh) {
      await client.query(
        'INSERT INTO task_invites (task_id, inviter_id, email_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [req.params.id, req.auth.sub, inviteEmailHash(e)],
      )
    }
    await client.query('COMMIT')
    toSend = fresh
    context = task
    res.json({ invited: emails.length, remaining: remainingBefore - fresh.length })
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { /* connection already broken */ }
    console.error('task invite failed:', error)
    return res.status(500).json({ error: 'Could not send the invites.' })
  } finally {
    client.release()
  }
  // After the response: one message per address, never a shared thread.
  sendTaskInvites(req.params.id, req.auth.sub, context, toSend)
})

async function sendTaskInvites(taskId, inviterId, task, emails) {
  if (!task || emails.length === 0) return
  try {
    // Accounts that must not hear from us here. Matched on the address, and
    // never reported back — the inviter sees every address as invited.
    const { rows: held } = await query(
      `SELECT LOWER(u.email) AS email
         FROM users u
        WHERE LOWER(u.email) = ANY($1::text[])
          AND (u.parental_consent_status = 'pending'
               OR EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = u.id AND b.blocked_id = $2))`,
      [emails, task.created_by],
    )
    const skip = new Set(held.map((r) => r.email))
    const first = String(task.my_name || '').trim().split(/\s+/)[0] || 'A friend'
    const subject = `${first} invited you to volunteer together: ${task.title}`
    const link = `${frontendBase()}/opportunities?task=${encodeURIComponent(taskId)}&from=${encodeURIComponent(inviterId)}`
    for (const email of emails) {
      if (email.endsWith('@test.com')) {
        console.log(`[invite] skipped @test.com fixture ${email}: ${subject}`)
        continue
      }
      if (skip.has(email)) continue
      await sendEmail({
        to: email,
        subject,
        html: taskEmailHtml({
          heading: `${first} invited you to volunteer together`,
          lines: [
            `${first} signed up for this volunteer task on VolunTrack and would like you to come along.`,
            'Open the link to see the details and sign up. You need a VolunTrack account, which is free.',
            "You got this email because a friend entered your address. We don't keep it or email you again unless you sign up.",
          ],
          task,
          link,
          linkLabel: 'See the task and sign up',
        }),
      })
    }
  } catch (error) {
    console.error('task invite emails failed:', error)
  }
}

// --- A parent's OK for an under-13 -------------------------------------------
//
// An under-13 (users.under_13) signing up lands as 'parent_pending': it holds
// no slot, the organizer doesn't see it, and it can't be approved by them.
// Who decides:
//   - the child's linked parent accounts (parent_child_links), on the Family
//     dashboard — bell entry plus an email pointing there;
//   - with none linked, the address the child gave for parental consent at
//     sign-up, by an emailed link to a two-step backend page (GET shows the
//     choice, POST decides, so a mail scanner can't say yes; see parent.js);
//   - with neither, nobody can yet: the sign-up waits, and the student is
//     told to link a parent (Settings → Family). A parent who links later
//     sees it on their dashboard.
// Yes → 'pending' (or 'waitlisted' if the task filled up meanwhile), then
// the organizer's usual approval. No → 'parent_declined': the student sees it
// and may ask again by signing up again.

export const PARENT_HELD = ['parent_pending', 'parent_declined']

const childFirstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'Your child'

/**
 * Tells whoever can decide that a sign-up is waiting. Database work is
 * awaited; emails are sent after it returns.
 * @returns {Promise<'linked'|'email'|'none'>} who was asked.
 */
export async function requestParentOk(signupId) {
  try {
    const { rows } = await query(
      `SELECT s.id, s.user_id, t.id AS task_id, t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location, t.creator_name,
              c.name AS child_name, c.parent_consent_email
         FROM public_task_signups s
         JOIN public_tasks t ON t.id = s.task_id
         JOIN users c ON c.id = s.user_id
        WHERE s.id = $1 AND s.status = 'parent_pending'`,
      [signupId],
    )
    const row = rows[0]
    if (!row) return 'none'
    const child = childFirstName(row.child_name)
    const subject = `${child} wants to volunteer: ${row.title}`
    const when = [row.date, row.time].filter(Boolean).join(' at ')

    const { rows: parents } = await query(
      `SELECT u.id, u.email FROM parent_child_links l JOIN users u ON u.id = l.parent_id
        WHERE l.child_id = $1 AND u.role = 'parent'`,
      [row.user_id],
    )
    if (parents.length > 0) {
      for (const p of parents) {
        notify(p.id, {
          kind: 'parent_ok_request',
          title: `${child} wants to join ${row.title}`,
          body: `${when ? `${when} · ` : ''}Approve or decline on your Family dashboard.`,
          link: '/parent',
        })
      }
      sendParentOkEmails(parents.map((p) => p.email), subject, {
        heading: `${child} needs your OK to volunteer`,
        lines: [
          `${row.child_name || child} signed up for this volunteer task on VolunTrack. Because they are under 13, the organizer won't see the sign-up until you approve it.`,
          'Open your Family dashboard to approve or decline. Nothing is shared with the organizer if you decline.',
        ],
        task: row,
        link: `${frontendBase()}/parent`,
        linkLabel: 'Review on your Family dashboard',
      })
      return 'linked'
    }

    if (row.parent_consent_email) {
      const token = generateToken()
      const { rowCount } = await query(
        "UPDATE public_task_signups SET parent_ok_token = $1 WHERE id = $2 AND status = 'parent_pending'",
        [token, signupId],
      )
      if (rowCount === 0) return 'none'
      sendParentOkEmails([row.parent_consent_email], subject, {
        heading: `${child} needs your OK to volunteer`,
        lines: [
          `${row.child_name || child} signed up for this volunteer task on VolunTrack and gave this address as their parent or guardian. Because they are under 13, the organizer won't see the sign-up until you approve it.`,
          'Open the link to approve or decline. Nothing changes until you press a button on that page, and the link works once.',
          "If you don't know this child, decline or ignore this email.",
        ],
        task: row,
        link: `${backendUrl()}/api/parent/task-ok/${token}`,
        linkLabel: 'Review this sign-up',
      })
      return 'email'
    }
    return 'none'
  } catch (error) {
    console.error('parent OK request failed:', error)
    return 'none'
  }
}

// One message per address, never a shared thread; the @test.com fixtures are
// skipped, as announcements and follower emails do.
async function sendParentOkEmails(addresses, subject, content) {
  const seen = new Set()
  for (const raw of addresses) {
    const email = String(raw || '').trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    if (email.endsWith('@test.com')) {
      console.log(`[parent-ok] skipped @test.com fixture ${email}: ${subject}`)
      continue
    }
    try {
      await sendEmail({ to: email, subject, html: taskEmailHtml(content) })
    } catch (error) {
      console.error('parent OK email failed:', error)
    }
  }
}

/**
 * A parent's decision on a 'parent_pending' sign-up. The caller has already
 * checked the parent may decide (a link, or the emailed token).
 * @returns {Promise<{ ok: true, status: string } | { ok: false, code: number, error: string }>}
 */
export async function decideParentOk(signupId, approve) {
  const client = await getPool().connect()
  let result
  try {
    await client.query('BEGIN')
    // The task row lock first, as sign-up and promotion take it, so a yes
    // can't race them for the last slot.
    const { rows: found } = await client.query('SELECT task_id FROM public_task_signups WHERE id = $1', [signupId])
    if (!found[0]) {
      await client.query('ROLLBACK')
      return { ok: false, code: 404, error: 'This sign-up no longer exists.' }
    }
    const { rows: taskRows } = await client.query(
      `SELECT t.status, t.slots_total, t.created_by, t.date < CURRENT_DATE - 1 AS past,
              (SELECT posting_suspended_at IS NOT NULL FROM users WHERE id = t.created_by) AS host_suspended
         FROM public_tasks t WHERE t.id = $1 FOR UPDATE`,
      [found[0].task_id],
    )
    const { rows: signupRows } = await client.query(
      `SELECT s.status, s.user_id,
              EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = s.user_id AND b.blocked_id = $2) AS host_blocked
         FROM public_task_signups s WHERE s.id = $1 FOR UPDATE`,
      [signupId, taskRows[0]?.created_by || null],
    )
    const task = taskRows[0]
    const signup = signupRows[0]
    if (!task || !signup) {
      await client.query('ROLLBACK')
      return { ok: false, code: 404, error: 'This sign-up no longer exists.' }
    }
    if (signup.status !== 'parent_pending') {
      await client.query('ROLLBACK')
      return { ok: false, code: 409, error: 'This sign-up has already been decided.' }
    }

    if (!approve) {
      await client.query(
        "UPDATE public_task_signups SET status = 'parent_declined', parent_ok_token = NULL, parent_ok_decided_at = now() WHERE id = $1",
        [signupId],
      )
      await client.query('COMMIT')
      result = { ok: true, status: 'parent_declined', userId: signup.user_id, taskId: found[0].task_id }
    } else {
      if (task.status === 'cancelled') {
        await client.query('ROLLBACK')
        return { ok: false, code: 400, error: 'This task was cancelled.' }
      }
      if (task.status !== 'open' || task.past || task.host_suspended || signup.host_blocked) {
        await client.query('ROLLBACK')
        return { ok: false, code: 400, error: "This task isn't taking sign-ups any more." }
      }
      const { rows: taken } = await client.query(
        "SELECT COUNT(*) AS cnt FROM public_task_signups WHERE task_id = $1 AND status IN ('pending', 'approved')",
        [found[0].task_id],
      )
      // Filled up while the parent was deciding: the waitlist, never over
      // capacity. signed_up_at restarts at the OK, so the child joins the
      // line behind people who were already waiting.
      const status = Number(taken[0].cnt) < task.slots_total ? 'pending' : 'waitlisted'
      await client.query(
        `UPDATE public_task_signups SET status = $2, signed_up_at = now(), parent_ok_token = NULL, parent_ok_decided_at = now()
          WHERE id = $1`,
        [signupId, status],
      )
      await client.query('COMMIT')
      result = { ok: true, status, userId: signup.user_id, taskId: found[0].task_id }
    }
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { /* connection already broken */ }
    console.error('parent OK decision failed:', error)
    return { ok: false, code: 500, error: 'Could not save the decision.' }
  } finally {
    client.release()
  }
  notifyParentDecision(result)
  return { ok: true, status: result.status }
}

async function notifyParentDecision({ status, userId, taskId }) {
  try {
    const { rows } = await query('SELECT title FROM public_tasks WHERE id = $1', [taskId])
    const title = rows[0]?.title || 'A volunteer task'
    if (status === 'parent_declined') {
      notify(userId, {
        kind: 'parent_ok_declined',
        title,
        body: 'Your parent said no to this sign-up. Talk with them, and you can ask again by signing up again.',
        link: '/attendance',
      })
    } else {
      notify(userId, {
        kind: 'parent_ok_given',
        title,
        body: status === 'waitlisted'
          ? "Your parent said yes. The task filled up meanwhile, so you're on the waitlist."
          : 'Your parent said yes. Now the organizer will confirm your sign-up.',
        link: '/attendance',
      })
    }
  } catch (error) {
    console.error('parent decision notification failed:', error)
  }
}

// --- Waitlist ---------------------------------------------------------------
//
// A full task takes sign-ups as 'waitlisted', first come first served. They
// hold no slot. Whenever a slot frees up (a volunteer cancels, the organizer
// rejects someone, adds spots or reopens the task) the earliest waiting moves
// to 'pending' (the slot is theirs; the organizer still approves as usual)
// and is emailed.

// A waitlisted user's place in line (1 = next), as an SQL expression.
export const WAITLIST_POSITION_SQL = (taskExpr, userExpr) => `(
  SELECT CASE WHEN me.status = 'waitlisted' THEN (
           SELECT COUNT(*) FROM public_task_signups w
            WHERE w.task_id = me.task_id AND w.status = 'waitlisted'
              AND (w.signed_up_at, w.id) <= (me.signed_up_at, me.id))
         END
    FROM public_task_signups me WHERE me.task_id = ${taskExpr} AND me.user_id = ${userExpr})`

async function promoteFromWaitlist(taskId) {
  const client = await getPool().connect()
  let promoted = []
  try {
    await client.query('BEGIN')
    // The same row lock as sign-up, so a sign-up and a promotion can't both
    // take the last slot.
    const { rows } = await client.query(
      'SELECT status, slots_total, date < CURRENT_DATE - 1 AS past FROM public_tasks WHERE id = $1 FOR UPDATE',
      [taskId],
    )
    const task = rows[0]
    if (task && task.status === 'open' && !task.past) {
      const { rows: taken } = await client.query(
        "SELECT COUNT(*) AS cnt FROM public_task_signups WHERE task_id = $1 AND status IN ('pending', 'approved')",
        [taskId],
      )
      const free = task.slots_total - Number(taken[0].cnt)
      if (free > 0) {
        const { rows: moved } = await client.query(
          `UPDATE public_task_signups SET status = 'pending'
            WHERE id IN (SELECT id FROM public_task_signups WHERE task_id = $1 AND status = 'waitlisted'
                          ORDER BY signed_up_at, id LIMIT $2)
            RETURNING user_id`,
          [taskId, free],
        )
        promoted = moved.map((r) => r.user_id)
      }
    }
    await client.query('COMMIT')
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { /* connection already broken */ }
    console.error('waitlist promotion failed:', error)
  } finally {
    client.release()
  }
  for (const userId of promoted) notifyWaitlistSpot(taskId, userId)
  return promoted
}

async function notifyWaitlistSpot(taskId, userId) {
  try {
    const { rows } = await query(
      `SELECT t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location, t.creator_name, u.email, u.name
         FROM public_tasks t, users u
        WHERE t.id = $1 AND u.id = $2`,
      [taskId, userId],
    )
    const row = rows[0]
    if (!row) return
    notify(userId, {
      kind: 'waitlist_spot',
      title: row.title,
      body: "A spot opened up and it's yours. The organizer will confirm your sign-up.",
      link: '/attendance',
    })
    if (!row.email) return
    await sendEmail({
      to: row.email,
      subject: `A spot opened up: ${row.title}`,
      html: taskEmailHtml({
        heading: "You're off the waitlist",
        lines: [
          `Hi ${row.name || 'there'}, a spot opened up and it's yours. The organizer will confirm your sign-up, and you'll get another email when they do.`,
          "Can't make it any more? Cancel from Attendance in VolunTrack so the next person gets the spot.",
        ],
        task: row,
      }),
    })
  } catch (error) {
    console.error('waitlist notification failed:', error)
  }
}

// DELETE /api/school/public-tasks/:id/signup — a volunteer cancels their own
// sign-up or leaves the waitlist. Not once the day has passed or attendance
// is marked (that's a record now), and not a rejected one: deleting it would
// let them sign up again.
router.delete('/public-tasks/:id/signup', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT s.status, s.attendance_status, t.date < CURRENT_DATE - 1 AS past
         FROM public_task_signups s JOIN public_tasks t ON t.id = s.task_id
        WHERE s.task_id = $1 AND s.user_id = $2`,
      [req.params.id, req.auth.sub],
    )
    if (rows.length === 0) return res.status(404).json({ error: "You aren't signed up for this task." })
    const signup = rows[0]
    if (signup.status === 'rejected') return res.status(400).json({ error: 'The organizer already declined this sign-up.' })
    if (signup.past || signup.attendance_status) {
      return res.status(400).json({ error: 'This task has already happened, so the sign-up stays on your record.' })
    }
    await query('DELETE FROM public_task_signups WHERE task_id = $1 AND user_id = $2', [req.params.id, req.auth.sub])
    // Only pending and approved hold a slot; a sign-up still waiting for (or
    // turned down by) a parent, or on the waitlist, frees nothing.
    if (['pending', 'approved'].includes(signup.status)) await promoteFromWaitlist(req.params.id)
    return res.json({ ok: true })
  } catch (error) {
    console.error('cancel signup failed:', error)
    return res.status(500).json({ error: 'Could not cancel the sign-up.' })
  }
})

// Approve a signup (organizer only) — reveals phone number to volunteer
router.post('/public-tasks/:id/approve/:userId', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows: taskRows } = await query('SELECT created_by FROM public_tasks WHERE id = $1', [req.params.id])
    if (taskRows.length === 0) return res.status(404).json({ error: 'Task not found.' })
    if (taskRows[0].created_by !== req.auth.sub) return res.status(403).json({ error: 'Only the task creator can approve signups.' })

    // Only a real signup gets a decision, and only a change sends the email:
    // otherwise any task creator could email any user ID, as often as they liked.
    const { rows: signupRows } = await query(
      'SELECT status FROM public_task_signups WHERE task_id = $1 AND user_id = $2',
      [req.params.id, req.params.userId],
    )
    // A sign-up still waiting for a parent's OK (or turned down by one) isn't
    // the organizer's to decide, and isn't shown to them.
    if (signupRows.length === 0 || PARENT_HELD.includes(signupRows[0].status)) {
      return res.status(404).json({ error: 'Signup not found.' })
    }
    if (signupRows[0].status === 'approved') return res.json({ ok: true })
    // Approving from the waitlist would put the task over its slots.
    if (signupRows[0].status === 'waitlisted') {
      return res.status(400).json({ error: 'This person is on the waitlist. Add a spot (Edit → volunteers needed) and they move up automatically.' })
    }
    await query(
      "UPDATE public_task_signups SET status = 'approved' WHERE task_id = $1 AND user_id = $2",
      [req.params.id, req.params.userId],
    )
    // Nobody was ever told. A volunteer signed up and then watched a page for
    // a status change that only existed inside the organizer's dashboard.
    notifySignupDecision(req.params.id, req.params.userId, 'approved')
    return res.json({ ok: true })
  } catch (error) {
    console.error('approve signup failed:', error)
    return res.status(500).json({ error: 'Could not approve signup.' })
  }
})

// Reject a signup (organizer only)
router.post('/public-tasks/:id/reject/:userId', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows: taskRows } = await query('SELECT created_by FROM public_tasks WHERE id = $1', [req.params.id])
    if (taskRows.length === 0) return res.status(404).json({ error: 'Task not found.' })
    if (taskRows[0].created_by !== req.auth.sub) return res.status(403).json({ error: 'Only the task creator can reject signups.' })

    // Only a real signup gets a decision, and only a change sends the email:
    // otherwise any task creator could email any user ID, as often as they liked.
    const { rows: signupRows } = await query(
      'SELECT status FROM public_task_signups WHERE task_id = $1 AND user_id = $2',
      [req.params.id, req.params.userId],
    )
    // A sign-up still waiting for a parent's OK (or turned down by one) isn't
    // the organizer's to decide, and isn't shown to them.
    if (signupRows.length === 0 || PARENT_HELD.includes(signupRows[0].status)) {
      return res.status(404).json({ error: 'Signup not found.' })
    }
    if (signupRows[0].status === 'rejected') return res.json({ ok: true })
    await query(
      "UPDATE public_task_signups SET status = 'rejected' WHERE task_id = $1 AND user_id = $2",
      [req.params.id, req.params.userId],
    )
    notifySignupDecision(req.params.id, req.params.userId, 'rejected')
    // Their slot goes to the first person waiting.
    if (signupRows[0].status !== 'waitlisted') await promoteFromWaitlist(req.params.id)
    return res.json({ ok: true })
  } catch (error) {
    console.error('reject signup failed:', error)
    return res.status(500).json({ error: 'Could not reject signup.' })
  }
})

// --- Task notifications ----------------------------------------------------

// Every task email goes to one person at a time. A shared To: line on a
// volunteer roster would publish a list of minors' addresses to each other,
// which is the same reason referral invites are sent separately.
function taskEmailHtml({ heading, lines, task, link, linkLabel }) {
  const when = [task.date, task.time].filter(Boolean).join(' at ')
  const detail = [
    when ? `<p><strong>When:</strong> ${escapeHtml(when)}</p>` : '',
    task.location ? `<p><strong>Where:</strong> ${escapeHtml(task.location)}</p>` : '',
    task.creator_name ? `<p><strong>Organizer:</strong> ${escapeHtml(task.creator_name)}</p>` : '',
  ].join('')
  return `
    <h2>${escapeHtml(heading)}</h2>
    ${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')}
    <h3>${escapeHtml(task.title || 'Volunteer opportunity')}</h3>
    ${detail}
    ${link ? `<p><a href="${escapeHtml(link)}">${escapeHtml(linkLabel || 'Open in VolunTrack')}</a></p>` : ''}
    ${emailFooterHtml()}
  `
}

// Fire-and-forget, like recordAudit: a mail server having a bad day must not
// turn a successful approval into a 500 for the organizer.
async function notifySignupDecision(taskId, userId, decision) {
  try {
    const { rows } = await query(
      `SELECT t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location, t.creator_name, t.important_info, u.email, u.name
         FROM public_tasks t, users u
        WHERE t.id = $1 AND u.id = $2`,
      [taskId, userId],
    )
    const row = rows[0]
    if (!row) return
    const approved = decision === 'approved'
    notify(userId, {
      kind: approved ? 'signup_approved' : 'signup_rejected',
      title: row.title,
      body: approved
        ? [row.date, row.time].filter(Boolean).join(' at ') || 'The organizer approved your sign-up.'
        : 'The organizer could not take your sign-up for this one.',
      link: approved ? '/attendance' : '/opportunities',
    })
    if (!row.email) return
    await sendEmail({
      to: row.email,
      subject: approved ? `You're in: ${row.title}` : `Update on your signup: ${row.title}`,
      html: taskEmailHtml({
        heading: approved ? "You're approved" : 'Your signup was not accepted',
        lines: approved
          ? [
            `Hi ${row.name || 'there'}, the organizer approved your signup.`,
            ...(row.important_info ? [row.important_info] : []),
          ]
          : [`Hi ${row.name || 'there'}, the organizer could not take your signup for this one. Other opportunities are listed in VolunTrack.`],
        task: row,
      }),
    })
  } catch (error) {
    console.error('task signup notification failed:', error)
  }
}

// --- Editing a posted task -------------------------------------------------

// PATCH /api/school/public-tasks/:id — organizer edits their own task.
// Only the fields sent are changed, so a corrected address doesn't have to
// re-send the description. Slots cannot drop below the people already
// approved: the app would have to un-approve somebody to make that true.
router.patch('/public-tasks/:id', limiter, requireDb, requireAuth(), async (req, res) => {
  const editable = ['title', 'description', 'location', 'date', 'time', 'phone', 'importantInfo', 'slotsTotal', 'latitude', 'longitude', 'category']
  const limits = { title: 200, description: 5000, location: 300, phone: 30, importantInfo: 2000 }

  try {
    const { rows } = await query('SELECT created_by, status FROM public_tasks WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'Task not found.' })
    if (rows[0].created_by !== req.auth.sub) return res.status(403).json({ error: 'Only the task creator can edit this task.' })
    if (rows[0].status === 'cancelled') return res.status(400).json({ error: 'A cancelled task cannot be edited.' })
    if (req.body.date !== undefined && !isValidDateString(req.body.date)) {
      return res.status(400).json({ error: 'Enter the date as YYYY-MM-DD.' })
    }

    const sets = []
    const values = []
    for (const field of editable) {
      if (req.body[field] === undefined) continue
      const column = { importantInfo: 'important_info', slotsTotal: 'slots_total' }[field] || field

      if (field === 'slotsTotal') {
        const slots = Number(req.body.slotsTotal)
        if (!Number.isInteger(slots) || slots < 1 || slots > 1000) {
          return res.status(400).json({ error: 'Volunteers needed must be between 1 and 1000.' })
        }
        const { rows: approved } = await query(
          "SELECT COUNT(*) AS cnt FROM public_task_signups WHERE task_id = $1 AND status = 'approved'",
          [req.params.id],
        )
        if (slots < Number(approved[0].cnt)) {
          return res.status(400).json({ error: `You have already approved ${approved[0].cnt} volunteers — reject someone first to go below that.` })
        }
        values.push(slots)
      } else if (field === 'category') {
        const c = taskCategory(req.body.category)
        if (!c.ok) return res.status(400).json({ error: 'Pick a category from the list.' })
        values.push(c.value)
      } else if (field === 'latitude' || field === 'longitude') {
        const c = coordinate(req.body[field], field === 'latitude' ? 90 : 180)
        if (!c.ok) return res.status(400).json({ error: 'Invalid map position.' })
        values.push(c.value)
      } else {
        const text = String(req.body[field] ?? '').trim()
        if (limits[field] && text.length > limits[field]) {
          return res.status(400).json({ error: `${field} is too long.` })
        }
        if (['title', 'description', 'location', 'phone'].includes(field) && !text) {
          return res.status(400).json({ error: `${field} cannot be empty.` })
        }
        if (field === 'date' && text && !validator.isDate(text)) return res.status(400).json({ error: 'Invalid date.' })
        values.push(text)
      }
      sets.push(`${column} = $${values.length}`)
    }

    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to change.' })
    values.push(req.params.id)
    const { rows: updated } = await query(
      `UPDATE public_tasks SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
      values,
    )
    // More spots: the waitlist moves up into them.
    if (req.body.slotsTotal !== undefined) await promoteFromWaitlist(req.params.id)
    return res.json({ task: updated[0] })
  } catch (error) {
    console.error('task edit failed:', error)
    return res.status(500).json({ error: 'Could not update the task.' })
  }
})

// POST /api/school/public-tasks/:id/status { status: 'open' | 'closed' }
// Closing stops new signups without touching anyone already on the list —
// the signup route has always refused a closed task, and until now nothing
// could put a task into that state.
router.post('/public-tasks/:id/status', limiter, requireDb, requireAuth(), async (req, res) => {
  const status = req.body.status
  if (!['open', 'closed'].includes(status)) return res.status(400).json({ error: "Status must be 'open' or 'closed'." })
  try {
    const { rows } = await query('SELECT created_by, status FROM public_tasks WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'Task not found.' })
    if (rows[0].created_by !== req.auth.sub) return res.status(403).json({ error: 'Only the task creator can change this task.' })
    if (rows[0].status === 'cancelled') return res.status(400).json({ error: 'A cancelled task cannot be reopened.' })

    await query('UPDATE public_tasks SET status = $1, updated_at = now() WHERE id = $2', [status, req.params.id])
    if (status === 'open') await promoteFromWaitlist(req.params.id)
    return res.json({ ok: true, status })
  } catch (error) {
    console.error('task status change failed:', error)
    return res.status(500).json({ error: 'Could not change the task status.' })
  }
})

// POST /api/school/public-tasks/:id/cancel { reason }
// Cancelling is the honest end state for an event that will not happen:
// signups and attendance stay, because the record of who turned up to the
// ones that did run must survive. Everyone who signed up is told, since they
// had it in their calendar.
router.post('/public-tasks/:id/cancel', limiter, requireDb, requireAuth(), async (req, res) => {
  const reason = String(req.body.reason || '').trim().slice(0, 500)
  try {
    const { rows } = await query(
      'SELECT created_by, status, title, date, time, location, creator_name FROM public_tasks WHERE id = $1',
      [req.params.id],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Task not found.' })
    if (rows[0].created_by !== req.auth.sub) return res.status(403).json({ error: 'Only the task creator can cancel this task.' })
    if (rows[0].status === 'cancelled') return res.status(400).json({ error: 'This task is already cancelled.' })

    await query(
      "UPDATE public_tasks SET status = 'cancelled', cancelled_reason = $1, cancelled_at = now(), updated_at = now() WHERE id = $2",
      [reason || null, req.params.id],
    )

    const { rows: people } = await query(
      `SELECT u.email, u.name FROM public_task_signups s JOIN users u ON u.id = s.user_id
        WHERE s.task_id = $1 AND s.status NOT IN ('rejected', 'parent_declined')`,
      [req.params.id],
    )
    // Sequential and individual — see taskEmailHtml on why there is no shared
    // recipient line. Failures are logged, never surfaced as a failed cancel:
    // the event is off either way.
    for (const person of people) {
      try {
        await sendEmail({
          to: person.email,
          subject: `Cancelled: ${rows[0].title}`,
          html: taskEmailHtml({
            heading: 'This event has been cancelled',
            lines: [
              `Hi ${person.name || 'there'}, the organizer has cancelled this event.`,
              ...(reason ? [`Reason given: ${reason}`] : []),
            ],
            task: rows[0],
          }),
        })
      } catch (error) { console.error('cancellation email failed:', error) }
    }

    return res.json({ ok: true, notified: people.length })
  } catch (error) {
    console.error('task cancel failed:', error)
    return res.status(500).json({ error: 'Could not cancel the task.' })
  }
})

// POST /api/school/public-tasks/:id/message { message }
// The organizer has everyone's address and, until now, no way to use it —
// "bring gloves, park at the back" had to happen outside the app.
router.post('/public-tasks/:id/message', taskMailLimiter, requireDb, requireAuth(), async (req, res) => {
  const message = String(req.body.message || '').trim()
  if (!message) return res.status(400).json({ error: 'Write a message first.' })
  if (message.length > 2000) return res.status(400).json({ error: 'Message is too long (2000 characters max).' })

  try {
    const { rows } = await query(
      'SELECT created_by, title, date, time, location, creator_name FROM public_tasks WHERE id = $1',
      [req.params.id],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Task not found.' })
    if (rows[0].created_by !== req.auth.sub) return res.status(403).json({ error: 'Only the task creator can message volunteers.' })

    const { rows: people } = await query(
      // Not to anyone who blocked this organizer (server/routes/reports.js).
      `SELECT u.email, u.name FROM public_task_signups s JOIN users u ON u.id = s.user_id
        WHERE s.task_id = $1 AND s.status = 'approved'
          AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = s.user_id AND b.blocked_id = $2)`,
      // Only the task's creator gets this far, so they're the organizer.
      [req.params.id, req.auth.sub],
    )
    if (people.length === 0) return res.status(400).json({ error: 'No approved volunteers to message yet.' })

    let sent = 0
    for (const person of people) {
      try {
        await sendEmail({
          to: person.email,
          subject: `Message from the organizer: ${rows[0].title}`,
          html: taskEmailHtml({
            heading: `A message from ${rows[0].creator_name || 'the organizer'}`,
            lines: [message],
            task: rows[0],
          }),
        })
        sent += 1
      } catch (error) { console.error('organizer message failed:', error) }
    }
    return res.json({ ok: true, sent, recipients: people.length })
  } catch (error) {
    console.error('organizer message failed:', error)
    return res.status(500).json({ error: 'Could not send your message.' })
  }
})

// POST /api/school/public-tasks/internal/run-reminders
// Driven by .github/workflows/task-reminders.yml, because Render's free tier
// has no cron. Mails every approved volunteer on a task happening tomorrow,
// then rings the bell for saved tasks that are close or filling up
// (remindSavedTasks).
// public_task_reminder_sends is the idempotency key, so a workflow that fires
// twice — or replays after a failure — cannot mail a roster again.
router.post('/public-tasks/internal/run-reminders', cronLimiter(), requireCronKey, requireDb, async (req, res) => {
  const dryRun = req.body?.dryRun === true
  try {
    const { rows: tasks } = await query(
      `SELECT t.id, t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location, t.creator_name, t.important_info
         FROM public_tasks t
        WHERE t.status = 'open'
          AND t.date = (current_date + interval '1 day')::date
          AND NOT EXISTS (SELECT 1 FROM public_task_reminder_sends r WHERE r.task_id = t.id)`,
    )

    const results = []
    for (const task of tasks) {
      const { rows: people } = await query(
        `SELECT u.email, u.name FROM public_task_signups s JOIN users u ON u.id = s.user_id
          WHERE s.task_id = $1 AND s.status = 'approved'`,
        [task.id],
      )
      if (people.length === 0) continue
      if (dryRun) { results.push({ task: task.title, recipients: people.length, dryRun: true }); continue }

      let sent = 0
      for (const person of people) {
        try {
          await sendEmail({
            to: person.email,
            subject: `Tomorrow: ${task.title}`,
            html: taskEmailHtml({
              heading: 'Your volunteer event is tomorrow',
              lines: [
                `Hi ${person.name || 'there'}, this is a reminder about tomorrow.`,
                ...(task.important_info ? [task.important_info] : []),
              ],
              task,
            }),
          })
          sent += 1
        } catch (error) { console.error('task reminder email failed:', error) }
      }
      // Recorded even on a partial send: re-running would mail the people who
      // did get it a second time, which is worse than one person missing it.
      await query(
        'INSERT INTO public_task_reminder_sends (task_id, recipients) VALUES ($1, $2) ON CONFLICT (task_id) DO NOTHING',
        [task.id, sent],
      )
      results.push({ task: task.title, recipients: people.length, sent })
    }

    // Saved-for-later nudges ride the same daily run. A failure here is
    // logged, not fatal: the volunteer emails above have already gone out.
    let savedReminders = null
    try {
      savedReminders = await remindSavedTasks({ dryRun })
    } catch (error) { console.error('saved task reminders failed:', error) }

    return res.json({ ok: true, tasks: tasks.length, results, savedReminders, emailConfigured: hasEmail() })
  } catch (error) {
    console.error('task reminders run failed:', error)
    return res.status(500).json({ error: 'Could not run task reminders.' })
  }
})

// GET /api/school/public-tasks/mine/report?from=&to=
// What an organizer needs at grant time. Every figure here was already in
// public_tasks and its signups; nothing could read it back out.
router.get('/public-tasks/mine/report', limiter, requireDb, requireAuth(), async (req, res) => {
  const from = String(req.query.from || '').trim()
  const to = String(req.query.to || '').trim()
  if (from && !validator.isDate(from)) return res.status(400).json({ error: 'Invalid from date.' })
  if (to && !validator.isDate(to)) return res.status(400).json({ error: 'Invalid to date.' })

  try {
    const params = [req.auth.sub]
    let range = ''
    if (from) { params.push(from); range += ` AND t.date >= $${params.length}` }
    if (to) { params.push(to); range += ` AND t.date <= $${params.length}` }

    // Signups and logs are both one-to-many off a task, so joining them in
    // one GROUP BY multiplies each against the other — a task with 3 signups
    // and 2 logs reported 4 approved and 30 hours instead of 2 and 10. Each
    // aggregate gets its own subquery, which is also why there is no GROUP BY
    // here any more.
    const { rows } = await query(
      `SELECT t.id, t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.location, t.status, t.slots_total,
              (SELECT COUNT(*) FROM public_task_signups s
                WHERE s.task_id = t.id AND s.status = 'approved')            AS approved,
              (SELECT COUNT(*) FROM public_task_signups s
                WHERE s.task_id = t.id AND s.status = 'pending')             AS pending,
              (SELECT COUNT(*) FROM public_task_signups s
                WHERE s.task_id = t.id AND s.attendance_status = 'present')  AS present,
              (SELECT COUNT(*) FROM public_task_signups s
                WHERE s.task_id = t.id AND s.attendance_status = 'absent')   AS absent,
              (SELECT COUNT(*) FROM public_task_signups s
                WHERE s.task_id = t.id AND s.attendance_status = 'excused')  AS excused,
              (SELECT COALESCE(SUM(l.hours), 0) FROM logs l
                WHERE l.task_id = t.id)                                      AS hours
         FROM public_tasks t
        WHERE t.created_by = $1${range}
        ORDER BY t.date DESC`,
      params,
    )

    const tasks = rows.map((r) => ({
      id: r.id,
      title: r.title,
      date: r.date,
      location: r.location,
      status: r.status,
      slotsTotal: r.slots_total,
      approved: Number(r.approved),
      pending: Number(r.pending),
      present: Number(r.present),
      absent: Number(r.absent),
      excused: Number(r.excused),
      hours: Number(r.hours),
    }))

    // Distinct people, not signups: one volunteer at six events is one
    // volunteer, which is the number a grant report is asking for.
    const { rows: distinct } = await query(
      `SELECT COUNT(DISTINCT s.user_id) AS people
         FROM public_task_signups s JOIN public_tasks t ON t.id = s.task_id
        WHERE t.created_by = $1 AND s.status = 'approved'${range}`,
      params,
    )

    const marked = tasks.reduce((n, t) => n + t.present + t.absent + t.excused, 0)
    const present = tasks.reduce((n, t) => n + t.present, 0)
    return res.json({
      from: from || null,
      to: to || null,
      tasks,
      totals: {
        events: tasks.length,
        cancelled: tasks.filter((t) => t.status === 'cancelled').length,
        volunteers: Number(distinct[0]?.people || 0),
        hours: tasks.reduce((n, t) => n + t.hours, 0),
        // Null rather than 0% when nobody has been marked — an organizer who
        // never took attendance did not achieve a 0% turnout.
        attendanceRate: marked > 0 ? present / marked : null,
      },
    })
  } catch (error) {
    console.error('organizer report failed:', error)
    return res.status(500).json({ error: 'Could not build your report.' })
  }
})

// --- Organizer endpoints (my tasks + log hours for volunteers) ---

// List tasks I created, with signups (includes phone + signup status).
// important_info is the organizer's own text: Edit and Post again prefill it,
// and without it here saving an edit blanked it.
router.get('/public-tasks/mine', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT t.id, t.title, t.description, t.location, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.slots_total, t.status, t.category, t.phone, t.important_info, t.latitude, t.longitude, t.created_at,
              (SELECT COUNT(*) FROM public_task_signups WHERE task_id = t.id AND status IN ('pending', 'approved')) AS slots_filled,
              (SELECT COALESCE(json_agg(json_build_object(
                'id', u.id, 'name', u.name, 'email', u.email, 'status', s.status, 'signed_up_at', s.signed_up_at,
                'attendance_status', s.attendance_status, 'attendance_marked_at', s.attendance_marked_at,
                'checked_in_at', s.checked_in_at, 'checked_out_at', s.checked_out_at,
                -- Who invited them, when they signed up from a friend's link.
                'came_with', (SELECT iu.name FROM users iu WHERE iu.id = s.invited_by),
                -- Checked in, never out, the day is over and no hours yet.
                'missed_checkout', s.checked_in_at IS NOT NULL AND s.checked_out_at IS NULL AND t.date < CURRENT_DATE - 1
                  AND NOT EXISTS (SELECT 1 FROM logs l WHERE l.task_id = t.id AND l.user_id = u.id)
              ) ORDER BY s.signed_up_at), '[]'::json)
               FROM public_task_signups s JOIN users u ON u.id = s.user_id
              -- Not before a parent's OK (decideParentOk): an under-13's name
              -- and email reach the organizer only once a parent agreed.
              WHERE s.task_id = t.id AND s.status NOT IN ('parent_pending', 'parent_declined')) AS signups,
              -- Ratings (PUT /public-tasks/:id/rating): the average, the count
              -- and the comments with their stars and date — never the
              -- student's name or id, so a comment can't be traced to a row.
              (SELECT ROUND(AVG(r.stars)::numeric, 1)::float8 FROM task_ratings r WHERE r.task_id = t.id) AS rating_avg,
              (SELECT COUNT(*)::int FROM task_ratings r WHERE r.task_id = t.id) AS rating_count,
              (SELECT COALESCE(json_agg(json_build_object(
                'stars', r.stars, 'comment', r.comment, 'date', to_char(r.updated_at, 'YYYY-MM-DD')
              ) ORDER BY r.updated_at DESC), '[]'::json)
               FROM task_ratings r WHERE r.task_id = t.id AND r.comment IS NOT NULL) AS rating_comments
       FROM public_tasks t WHERE t.created_by = $1
       ORDER BY t.date DESC, t.created_at DESC`,
      [req.auth.sub],
    )
    return res.json({ tasks: rows })
  } catch (error) {
    console.error('my tasks failed:', error)
    return res.status(500).json({ error: 'Could not fetch your tasks.' })
  }
})

// --- Rating a task -------------------------------------------------------------
//
// A student who volunteered at a task rates it 1–5 stars with an optional
// comment, once the task's day is over. The comment reaches only the task's
// organizer (GET /public-tasks/mine), without the student's name; Opportunities
// shows the organizer's average once they have 3 or more ratings.
//
// Who may rate, over a signup `s` joined to its task `t`: an approved signup
// that attended — marked present or checked in, and not since marked absent or
// excused — on a task that wasn't cancelled and whose day is over. "Over" has
// the check-in code's day of slack, since the server's date is UTC's, ahead of
// US dates; a volunteer who has already checked out is done, so may rate then.
// COALESCE: a NULL attendance would otherwise make the answer NULL, not false.
const RATING_OPEN_SQL = `COALESCE(s.status = 'approved' AND t.status <> 'cancelled'
  AND (s.attendance_status = 'present' OR (s.checked_in_at IS NOT NULL AND s.attendance_status IS NULL))
  AND (t.date < CURRENT_DATE - 1 OR s.checked_out_at IS NOT NULL), false)`

const RATING_COMMENT_MAX = 500

// PUT { stars, comment? }: add or change the caller's rating of a task.
router.put('/public-tasks/:id/rating', limiter, requireDb, requireAuth('student'), async (req, res) => {
  const { stars } = req.body || {}
  if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) {
    return res.status(400).json({ error: 'Choose from 1 to 5 stars.' })
  }
  const rawComment = req.body?.comment
  if (rawComment != null && typeof rawComment !== 'string') return res.status(400).json({ error: 'The comment must be text.' })
  const comment = (rawComment || '').trim() || null
  if (comment && comment.length > RATING_COMMENT_MAX) {
    return res.status(400).json({ error: `Keep the comment to ${RATING_COMMENT_MAX} characters.` })
  }
  try {
    const { rows } = await query(
      `SELECT ${RATING_OPEN_SQL} AS can_rate
         FROM public_task_signups s JOIN public_tasks t ON t.id = s.task_id
        WHERE s.task_id = $1 AND s.user_id = $2`,
      [req.params.id, req.auth.sub],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'You didn\'t sign up for this task.' })
    if (!rows[0].can_rate) {
      return res.status(403).json({ error: 'You can rate a task once its day is over, if you were there.' })
    }
    const { rows: saved } = await query(
      `INSERT INTO task_ratings (task_id, user_id, stars, comment) VALUES ($1, $2, $3, $4)
       ON CONFLICT (task_id, user_id) DO UPDATE SET stars = EXCLUDED.stars, comment = EXCLUDED.comment, updated_at = now()
       RETURNING stars, comment, updated_at`,
      [req.params.id, req.auth.sub, stars, comment],
    )
    return res.json({ ok: true, rating: saved[0] })
  } catch (error) {
    console.error('rate task failed:', error)
    return res.status(500).json({ error: 'Could not save your rating.' })
  }
})

// List tasks the current user signed up for (as a participant), with their
// signup + attendance status. Unlike GET /public-tasks, this isn't limited to
// status = 'open' — closed/past tasks still show so attendance stays visible.
router.get('/public-tasks/signups/mine', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query(
      // The organizer's email only reaches volunteers they approved — it is who
      // those students ask to sign off their hours on the task.
      `SELECT t.id, t.title, t.location, t.latitude, t.longitude, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.creator_name, t.status AS task_status,
              CASE WHEN s.status = 'approved' THEN t.creator_email END AS creator_email,
              s.status AS signup_status, s.attendance_status, s.attendance_marked_at, s.signed_up_at,
              ${WAITLIST_POSITION_SQL('t.id', 's.user_id')} AS waitlist_position,
              ${RATING_OPEN_SQL} AS can_rate,
              (SELECT json_build_object('stars', r.stars, 'comment', r.comment, 'updated_at', r.updated_at)
                 FROM task_ratings r WHERE r.task_id = t.id AND r.user_id = s.user_id) AS my_rating
       FROM public_task_signups s
       JOIN public_tasks t ON t.id = s.task_id
       WHERE s.user_id = $1
       ORDER BY t.date DESC, s.signed_up_at DESC`,
      [req.auth.sub],
    )
    return res.json({ signups: rows })
  } catch (error) {
    console.error('my signups failed:', error)
    return res.status(500).json({ error: 'Could not fetch your signups.' })
  }
})

// Log hours for a volunteer on a task (task creator only, no approval needed)
// Hours an organizer logs are approved on the spot, so they must be for a day
// that has happened, and a second click mustn't double them. "Today" is UTC's,
// which is never behind a US date, so a same-day entry is never refused.
// Tasks carry no category of their own; this is the app's closest one.
const ORGANIZER_LOG_CATEGORY = 'Community Service'

// A task's DATE column arrives as a Date at local midnight; a request's as text.
function dayString(value) {
  if (!(value instanceof Date)) return String(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

function organizerLogDateError(day) {
  return String(day) > new Date().toISOString().slice(0, 10)
    ? 'These hours are for a day that hasn\'t happened yet. Log them on or after the day of the task.'
    : null
}

async function alreadyLogged(taskId, userId, day) {
  const { rows } = await query(
    "SELECT 1 FROM logs WHERE task_id = $1 AND user_id = $2 AND date = $3::date LIMIT 1",
    [taskId, userId, day],
  )
  return rows.length > 0
}

// --- QR check-in --------------------------------------------------------------
//
// The organizer shows a QR code at the event; a volunteer scans it on arrival
// (checked in, marked present) and again when leaving (checked out, and the
// hours between are logged and approved, signed off by the organizer exactly
// like POST /log-hours below). The QR holds a plain URL to /checkin/<task>,
// so any phone camera can open it.
//
// The code in it changes every minute — HMAC of the task's secret and the
// minute — and is accepted for that minute and the one before, so a photo sent
// to a friend who isn't there stops working within two minutes. Nothing is
// stored per code. Only approved volunteers can check in, and only around the
// task's date (a day either side, since the server's date is UTC's).

const CHECKIN_WINDOW_MS = 60 * 1000
const CHECKOUT_AFTER_MS = 10 * 60 * 1000

function checkinCode(secret, taskId, windowIndex) {
  return createHmac('sha256', secret).update(`${taskId}:${windowIndex}`).digest('base64url').slice(0, 16)
}

function checkinCodeValid(secret, taskId, code) {
  const now = Math.floor(Date.now() / CHECKIN_WINDOW_MS)
  const given = Buffer.from(String(code || ''))
  return [now, now - 1].some((w) => {
    const expected = Buffer.from(checkinCode(secret, taskId, w))
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}

// Quarter hours between the two scans, at least a quarter, at most a day.
function scannedHours(inAt, outAt) {
  const quarters = Math.round((new Date(outAt) - new Date(inAt)) / (15 * 60 * 1000))
  return Math.min(MAX_HOURS_PER_ENTRY, Math.max(1, quarters) / 4)
}

// Logs a checked-out volunteer's hours as approved by the organizer, unless
// they already have an entry for this task that day. Returns whether it logged.
async function logCheckout(task, userId, inAt, outAt, note) {
  const day = dayString(task.date)
  if (await alreadyLogged(task.id, userId, day)) return false
  await query(
    `INSERT INTO logs (id, user_id, date, activity, category, hours, notes, verified_by, task_id, verification_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved')`,
    [uid('log'), userId, day, task.title, ORGANIZER_LOG_CATEGORY, scannedHours(inAt, outAt), note, task.created_by, task.id],
  )
  return true
}

const checkinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many check-in attempts. Please wait a few minutes.' },
})

// GET: the organizer's current code and who has scanned (polled by the QR screen).
router.get('/public-tasks/:id/checkin', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query('SELECT id, created_by, status, checkin_secret FROM public_tasks WHERE id = $1', [req.params.id])
    const task = rows[0]
    if (!task) return res.status(404).json({ error: 'Task not found.' })
    if (task.created_by !== req.auth.sub) return res.status(403).json({ error: 'Only the task creator can show the check-in code.' })
    if (task.status === 'cancelled') return res.status(400).json({ error: 'This task was cancelled.' })
    let secret = task.checkin_secret
    if (!secret) {
      secret = generateToken()
      await query('UPDATE public_tasks SET checkin_secret = $1 WHERE id = $2 AND checkin_secret IS NULL', [secret, task.id])
      secret = (await query('SELECT checkin_secret FROM public_tasks WHERE id = $1', [task.id])).rows[0].checkin_secret
    }
    const windowIndex = Math.floor(Date.now() / CHECKIN_WINDOW_MS)
    const { rows: people } = await query(
      `SELECT u.name, s.checked_in_at, s.checked_out_at FROM public_task_signups s JOIN users u ON u.id = s.user_id
        WHERE s.task_id = $1 AND s.status = 'approved' ORDER BY u.name`,
      [task.id],
    )
    return res.json({
      code: checkinCode(secret, task.id, windowIndex),
      // Seconds until the code changes, so the screen refreshes on time.
      refreshIn: Math.ceil(((windowIndex + 1) * CHECKIN_WINDOW_MS - Date.now()) / 1000),
      people: people.map((p) => ({ name: p.name, checkedInAt: p.checked_in_at, checkedOutAt: p.checked_out_at })),
    })
  } catch (error) {
    console.error('checkin code failed:', error)
    return res.status(500).json({ error: 'Could not prepare the check-in code.' })
  }
})

// POST { code }: the volunteer's scan — checks in, or out on the second scan.
router.post('/public-tasks/:id/checkin', checkinLimiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, title, created_by, status, checkin_secret, date,
              date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 1 AS today
         FROM public_tasks WHERE id = $1`,
      [req.params.id],
    )
    const task = rows[0]
    if (!task) return res.status(404).json({ error: 'Task not found.' })
    if (task.status === 'cancelled') return res.status(400).json({ error: 'This task was cancelled.' })
    if (!task.checkin_secret || !checkinCodeValid(task.checkin_secret, task.id, req.body?.code)) {
      return res.status(400).json({ error: 'This check-in code has expired. Scan the QR code on the organizer\'s screen again.' })
    }
    if (!task.today) return res.status(400).json({ error: 'Check-in only works on the day of the task.' })
    const { rows: signupRows } = await query(
      "SELECT id, checked_in_at, checked_out_at FROM public_task_signups WHERE task_id = $1 AND user_id = $2 AND status = 'approved'",
      [task.id, req.auth.sub],
    )
    const signup = signupRows[0]
    if (!signup) return res.status(403).json({ error: "You aren't an approved volunteer for this task. Ask the organizer." })

    if (!signup.checked_in_at) {
      const { rows: done } = await query(
        `UPDATE public_task_signups SET checked_in_at = now(), attendance_status = 'present', attendance_marked_at = now()
          WHERE id = $1 AND checked_in_at IS NULL RETURNING checked_in_at`,
        [signup.id],
      )
      return res.json({ state: 'checked_in', title: task.title, checkedInAt: done[0]?.checked_in_at || signup.checked_in_at })
    }
    if (signup.checked_out_at) {
      return res.json({ state: 'done', title: task.title, checkedInAt: signup.checked_in_at, checkedOutAt: signup.checked_out_at, hours: scannedHours(signup.checked_in_at, signup.checked_out_at) })
    }
    if (Date.now() - new Date(signup.checked_in_at).getTime() < CHECKOUT_AFTER_MS) {
      return res.json({ state: 'checked_in', title: task.title, checkedInAt: signup.checked_in_at, tooSoon: true })
    }
    // The UPDATE is the atomic step: two scans racing can't both log hours.
    const { rows: out } = await query(
      'UPDATE public_task_signups SET checked_out_at = now() WHERE id = $1 AND checked_out_at IS NULL RETURNING checked_in_at, checked_out_at',
      [signup.id],
    )
    if (out.length === 0) return res.json({ state: 'done', title: task.title })
    const hours = scannedHours(out[0].checked_in_at, out[0].checked_out_at)
    const logged = await logCheckout(task, req.auth.sub, out[0].checked_in_at, out[0].checked_out_at, 'Checked in and out with the task\'s QR code')
    return res.json({ state: 'checked_out', title: task.title, checkedInAt: out[0].checked_in_at, checkedOutAt: out[0].checked_out_at, hours, logged })
  } catch (error) {
    console.error('checkin failed:', error)
    return res.status(500).json({ error: 'Could not check you in.' })
  }
})

// POST: the organizer checks out everyone still checked in (volunteers who
// left without scanning). Only on the task's day — afterwards nobody knows
// when they left, so My Tasks flags them for Log hours instead (missed_checkout).
router.post('/public-tasks/:id/checkin/close', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, title, created_by, status, date, date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 1 AS today
         FROM public_tasks WHERE id = $1`,
      [req.params.id],
    )
    const task = rows[0]
    if (!task) return res.status(404).json({ error: 'Task not found.' })
    if (task.created_by !== req.auth.sub) return res.status(403).json({ error: 'Only the task creator can check volunteers out.' })
    if (!task.today) return res.status(400).json({ error: 'Check-out only works on the day of the task. Use Log hours in My Tasks instead.' })
    const { rows: out } = await query(
      `UPDATE public_task_signups SET checked_out_at = now()
        WHERE task_id = $1 AND status = 'approved' AND checked_in_at IS NOT NULL AND checked_out_at IS NULL
        RETURNING user_id, checked_in_at, checked_out_at`,
      [task.id],
    )
    let logged = 0
    for (const r of out) {
      if (await logCheckout(task, r.user_id, r.checked_in_at, r.checked_out_at, 'Checked in with the task\'s QR code; checked out by the organizer')) logged++
    }
    return res.json({ checkedOut: out.length, logged })
  } catch (error) {
    console.error('checkin close failed:', error)
    return res.status(500).json({ error: 'Could not check volunteers out.' })
  }
})

router.post('/public-tasks/:id/log-hours', limiter, requireDb, requireAuth(), async (req, res) => {
  const { volunteerId, hours, date } = req.body
  const hoursNum = Number(hours)
  if (!volunteerId || !Number.isFinite(hoursNum) || hoursNum <= 0) {
    return res.status(400).json({ error: 'volunteerId and positive hours are required.' })
  }
  if (hoursNum > MAX_HOURS_PER_ENTRY) {
    return res.status(400).json({ error: `One entry can be at most ${MAX_HOURS_PER_ENTRY} hours.` })
  }
  if (date != null && date !== '' && !isValidDateString(date)) {
    return res.status(400).json({ error: 'Enter the date as YYYY-MM-DD.' })
  }

  try {
    const { rows: taskRows } = await query('SELECT * FROM public_tasks WHERE id = $1', [req.params.id])
    if (taskRows.length === 0) return res.status(404).json({ error: 'Task not found.' })
    if (taskRows[0].created_by !== req.auth.sub) return res.status(403).json({ error: 'Only the task creator can log hours.' })

    // Only approved signups may have hours logged — mirrors the WHERE clause of
    // the log-hours-batch sibling below. Without the status check a task creator
    // could log (and thereby verify) hours for a pending or rejected volunteer.
    const { rows: signupRows } = await query(
      "SELECT attendance_status FROM public_task_signups WHERE task_id = $1 AND user_id = $2 AND status = 'approved'",
      [req.params.id, volunteerId],
    )
    if (signupRows.length === 0) return res.status(400).json({ error: 'Volunteer is not an approved signup for this task.' })
    if (signupRows[0].attendance_status === 'absent') return res.status(400).json({ error: 'Cannot log hours for a volunteer marked absent.' })

    const day = dayString(date || taskRows[0].date)
    const dateError = organizerLogDateError(day)
    if (dateError) return res.status(400).json({ error: dateError })
    if (await alreadyLogged(req.params.id, volunteerId, day)) {
      return res.status(409).json({ error: 'This volunteer already has hours logged for this task on that day.' })
    }

    const lid = uid('log')
    await query(
      // verification_status is set explicitly: the task organizer entering these
      // hours *is* the verifying authority, so leaving it at the 'none' default
      // made trusted entries look unverified everywhere the app distinguishes
      // the two — the parent digest's approved-hours total, PDF exports, school
      // reporting, and the Approve/Reject buttons in MyTasks.
      `INSERT INTO logs (id, user_id, date, activity, category, hours, notes, verified_by, task_id, verification_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved')`,
      [
        lid,
        volunteerId,
        day,
        taskRows[0].title,
        ORGANIZER_LOG_CATEGORY,
        hoursNum,
        `Logged by task organizer (${taskRows[0].title})`,
        req.auth.sub,
        req.params.id,
      ],
    )
    return res.status(201).json({ ok: true, id: lid })
  } catch (error) {
    console.error('log hours failed:', error)
    return res.status(500).json({ error: 'Could not log hours.' })
  }
})

// Batch log hours for multiple approved volunteers at once
router.post('/public-tasks/:id/log-hours-batch', limiter, requireDb, requireAuth(), async (req, res) => {
  const { entries, date } = req.body
  if (!Array.isArray(entries) || entries.length === 0) return res.status(400).json({ error: 'entries array required.' })
  if (date != null && date !== '' && !isValidDateString(date)) {
    return res.status(400).json({ error: 'Enter the date as YYYY-MM-DD.' })
  }
  if (entries.some((e) => Number(e?.hours) > MAX_HOURS_PER_ENTRY)) {
    return res.status(400).json({ error: `One entry can be at most ${MAX_HOURS_PER_ENTRY} hours.` })
  }

  try {
    const { rows: taskRows } = await query('SELECT * FROM public_tasks WHERE id = $1', [req.params.id])
    if (taskRows.length === 0) return res.status(404).json({ error: 'Task not found.' })
    if (taskRows[0].created_by !== req.auth.sub) return res.status(403).json({ error: 'Only the task creator can log hours.' })

    const { rows: approvedRows } = await query(
      'SELECT user_id FROM public_task_signups WHERE task_id = $1 AND status = \'approved\' AND attendance_status IS DISTINCT FROM \'absent\'',
      [req.params.id],
    )
    const approvedIds = new Set(approvedRows.map((r) => r.user_id))
    const day = dayString(date || taskRows[0].date)
    const dateError = organizerLogDateError(day)
    if (dateError) return res.status(400).json({ error: dateError })

    let logged = 0
    let skipped = 0
    for (const entry of entries) {
      const entryHours = Number(entry.hours)
      if (!entry.volunteerId || !Number.isFinite(entryHours) || entryHours <= 0) continue
      if (!approvedIds.has(entry.volunteerId)) continue
      if (await alreadyLogged(req.params.id, entry.volunteerId, day)) { skipped++; continue }

      const lid = uid('log')
      await query(
        // verification_status is set explicitly: the task organizer entering these
        // hours *is* the verifying authority, so leaving it at the 'none' default
        // made trusted entries look unverified everywhere the app distinguishes
        // the two — the parent digest's approved-hours total, PDF exports, school
        // reporting, and the Approve/Reject buttons in MyTasks.
        `INSERT INTO logs (id, user_id, date, activity, category, hours, notes, verified_by, task_id, verification_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved')`,
        [
          lid,
          entry.volunteerId,
          day,
          taskRows[0].title,
          ORGANIZER_LOG_CATEGORY,
          entryHours,
          `Logged by task organizer (${taskRows[0].title})`,
          req.auth.sub,
          req.params.id,
        ],
      )
      logged++
    }
    return res.status(201).json({ ok: true, logged, skipped })
  } catch (error) {
    console.error('batch log hours failed:', error)
    return res.status(500).json({ error: 'Could not log hours.' })
  }
})

// Get logs for a volunteer on a specific task (so the organizer can see what was already logged)
router.get('/public-tasks/:id/logs', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows: taskRows } = await query('SELECT created_by FROM public_tasks WHERE id = $1', [req.params.id])
    if (taskRows.length === 0) return res.status(404).json({ error: 'Task not found.' })
    if (taskRows[0].created_by !== req.auth.sub) return res.status(403).json({ error: 'Only the task creator can view logs.' })

    const { rows } = await query(
      `SELECT id, user_id, hours, date, notes, created_at
       FROM logs WHERE task_id = $1
       ORDER BY created_at DESC`,
      [req.params.id],
    )
    return res.json({ logs: rows })
  } catch (error) {
    console.error('task logs failed:', error)
    return res.status(500).json({ error: 'Could not fetch logs.' })
  }
})

// List every student approved on a task I created, with their recent logs —
// lets a volunteer review and approve/reject hours a student logged themselves,
// not just log hours on the student's behalf (see log-hours/log-hours-batch above).
router.get('/my-students', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows: signups } = await query(
      `SELECT DISTINCT u.id, u.name, u.email
       FROM public_task_signups s
       JOIN public_tasks t ON t.id = s.task_id
       JOIN users u ON u.id = s.user_id
       WHERE t.created_by = $1 AND s.status = 'approved'
       ORDER BY u.name`,
      [req.auth.sub],
    )
    if (signups.length === 0) return res.json({ students: [] })

    const students = {}
    for (const row of signups) {
      students[row.id] = { id: row.id, name: row.name, email: row.email }
    }

    const studentIds = Object.keys(students)
    // Scoped to logs whose task_id belongs to a task this host created —
    // real ownership via the task/signup relationship, not a title-text guess.
    const { rows: logs } = await query(
      `SELECT l.id, l.user_id, l.date, l.activity, l.category, l.hours, l.notes, l.verification_status, l.created_at
       FROM logs l
       JOIN public_tasks t ON t.id = l.task_id
       WHERE l.user_id = ANY($1::text[]) AND t.created_by = $2
       ORDER BY l.created_at DESC`,
      [studentIds, req.auth.sub],
    )
    const logsByStudent = {}
    for (const log of logs) {
      if (!logsByStudent[log.user_id]) logsByStudent[log.user_id] = []
      logsByStudent[log.user_id].push(log)
    }

    return res.json({
      students: studentIds.map((id) => ({ ...students[id], logs: logsByStudent[id] || [] })),
    })
  } catch (error) {
    console.error('my students failed:', error)
    return res.status(500).json({ error: 'Could not fetch students.' })
  }
})

// Approve or reject a specific log entry for a student approved on one of my tasks.
router.post('/students/:studentId/logs/:logId/verify', limiter, requireDb, requireAuth(), async (req, res) => {
  const { status, signature } = req.body
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'status must be approved or rejected.' })
  // An approval is a sign-off, so it carries the organizer's signature — the
  // same rule as the supervisor's emailed link. A rejection needs none.
  if (status === 'approved' && !isSignatureImage(signature)) {
    return res.status(400).json({ error: 'Sign to approve these hours.' })
  }

  try {
    const { rows: relRows } = await query(
      `SELECT 1 FROM public_task_signups s JOIN public_tasks t ON t.id = s.task_id
       WHERE t.created_by = $1 AND s.user_id = $2 AND s.status = 'approved'`,
      [req.auth.sub, req.params.studentId],
    )
    if (relRows.length === 0) return res.status(403).json({ error: 'This student is not approved on any of your tasks.' })

    const { rows: logRows } = await query('SELECT task_id FROM logs WHERE id = $1 AND user_id = $2', [req.params.logId, req.params.studentId])
    if (logRows.length === 0) return res.status(404).json({ error: 'Log not found.' })
    const { rows: ownsTask } = await query(
      'SELECT 1 FROM public_tasks WHERE id = $1 AND created_by = $2',
      [logRows[0].task_id, req.auth.sub],
    )
    if (ownsTask.length === 0) return res.status(403).json({ error: 'This log is not for one of your tasks.' })

    // What (if anything) had already been recorded, so the caller can tell
    // this was a change rather than a first decision.
    const { rows: beforeRows } = await query(
      'SELECT verification_status, verification_token FROM logs WHERE id = $1',
      [req.params.logId],
    )
    const previousStatus = beforeRows[0]?.verification_status ?? 'none'

    // A supervisor who rejected these hours is the person who was there to
    // witness the work (or didn't see it happen), so that decision is final:
    // an organizer cannot flip it to approved. Checked before the write, so a
    // refused request changes nothing.
    //
    // Still allowed, deliberately: agreeing with the rejection (status
    // 'rejected'), and acting on a log whose supervisor link is absent,
    // 'pending' or 'superseded'.
    const { rows: rejectedBySupervisor } = await query(
      `SELECT supervisor_name, responded_at
         FROM supervisor_verifications
        WHERE status = 'rejected'
          AND (log_id = $1 OR ($2::text IS NOT NULL AND token = $2))
        LIMIT 1`,
      [req.params.logId, beforeRows[0]?.verification_token ?? null],
    )
    if (rejectedBySupervisor[0] && status === 'approved') {
      const who = rejectedBySupervisor[0].supervisor_name || 'The supervisor'
      const when = rejectedBySupervisor[0].responded_at
        ? new Date(rejectedBySupervisor[0].responded_at).toISOString().slice(0, 10)
        : null
      return res.status(409).json({
        error: `${who} rejected these hours${when ? ` on ${when}` : ''}. A supervisor's rejection is final, so these hours cannot be approved here.`,
        supervisorStatus: 'rejected',
      })
    }

    await query(
      'UPDATE logs SET verification_status = $1, verified_by = $2, organizer_signature = $4 WHERE id = $3',
      [status, req.auth.sub, req.params.logId, status === 'approved' ? signature : null],
    )
    if (status !== previousStatus) notifyHoursDecision(req.params.studentId, req.params.logId, status)

    // Spend any still-pending supervisor link for this log. Without this the
    // emailed link stays 'pending', so a supervisor clicking it days later
    // passes the token route's idempotency check and overwrites the decision
    // just made here — with nobody on either side told it happened.
    //
    // Only 'pending' rows are touched: a supervisor who already answered keeps
    // their recorded outcome and signature.
    const { rows: superseded } = await query(
      `UPDATE supervisor_verifications
          SET status = 'superseded', responded_at = now()
        WHERE status = 'pending'
          AND (log_id = $1 OR ($2::text IS NOT NULL AND token = $2))
        RETURNING id`,
      [req.params.logId, beforeRows[0]?.verification_token ?? null],
    )

    return res.json({
      ok: true,
      previousStatus,
      supersededSupervisorLinks: superseded.length,
    })
  } catch (error) {
    console.error('verify student log failed:', error)
    return res.status(500).json({ error: 'Could not update log.' })
  }
})

// The student hears about an organizer's decision on their hours in the bell.
// Fire-and-forget: never awaited, and notify() itself never throws.
async function notifyHoursDecision(studentId, logId, status) {
  try {
    const { rows } = await query(
      `SELECT l.hours, to_char(l.date, 'YYYY-MM-DD') AS date, COALESCE(t.title, l.activity) AS title
         FROM logs l LEFT JOIN public_tasks t ON t.id = l.task_id
        WHERE l.id = $1 AND l.user_id = $2`,
      [logId, studentId],
    )
    const row = rows[0]
    if (!row) return
    const approved = status === 'approved'
    notify(studentId, {
      kind: approved ? 'hours_approved' : 'hours_rejected',
      title: row.title || 'Volunteer hours',
      body: `${Number(row.hours) || 0} hours${row.date ? ` on ${row.date}` : ''} ${approved ? 'were approved by the organizer.' : 'were not approved by the organizer.'}`,
      link: '/reports',
    })
  } catch (error) {
    console.error('hours decision notification failed:', error)
  }
}

// Mark attendance for a signed-up student on one of my tasks.
router.post('/public-tasks/:id/attendance/:userId', limiter, requireDb, requireAuth(), async (req, res) => {
  const { status } = req.body
  if (!['present', 'absent', 'excused'].includes(status)) return res.status(400).json({ error: 'status must be present, absent, or excused.' })

  try {
    const { rows: taskRows } = await query('SELECT created_by FROM public_tasks WHERE id = $1', [req.params.id])
    if (taskRows.length === 0) return res.status(404).json({ error: 'Task not found.' })
    if (taskRows[0].created_by !== req.auth.sub) return res.status(403).json({ error: 'Only the task creator can mark attendance.' })

    const { rows: signupRows } = await query(
      "SELECT 1 FROM public_task_signups WHERE task_id = $1 AND user_id = $2 AND status = 'approved'",
      [req.params.id, req.params.userId],
    )
    if (signupRows.length === 0) return res.status(400).json({ error: 'Student is not an approved signup for this task.' })

    await query(
      'UPDATE public_task_signups SET attendance_status = $1, attendance_marked_at = now() WHERE task_id = $2 AND user_id = $3',
      [status, req.params.id, req.params.userId],
    )
    return res.json({ ok: true })
  } catch (error) {
    console.error('mark attendance failed:', error)
    return res.status(500).json({ error: 'Could not mark attendance.' })
  }
})

// School admin submits their bank payment confirmation number after paying.
// Puts the school into 'pending' until an admin verifies it against the
// actual bank deposit — this does not unlock the school by itself.
router.post('/submit-payment-confirmation', limiter, requireDb, requireAuth('school'), async (req, res) => {
  const reference = String(req.body.reference || '').trim()
  if (!reference || reference.length > 200) return res.status(400).json({ error: 'Bank confirmation number is required.' })

  try {
    const { rows: userRows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    if (!userRows[0]?.school_id) return res.status(400).json({ error: 'No school linked to your account.' })

    await query(
      `UPDATE schools SET payment_status = 'pending', payment_confirmation_ref = $1, payment_notes = NULL WHERE id = $2`,
      [reference, userRows[0].school_id],
    )
    return res.json({ ok: true })
  } catch (error) {
    console.error('submit payment confirmation failed:', error)
    return res.status(500).json({ error: 'Could not submit payment confirmation.' })
  }
})

// --- Admin endpoints ---

// List all schools (admin only)
router.get('/admin/list', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.name, s.pin, s.account_code, s.contact_email, s.payment_status, s.payment_notes, s.admin_notes, s.paid_at, s.payment_due_date, s.payment_confirmation_ref, s.price_amount, s.price_period, s.created_at,
        (SELECT COUNT(*) FROM users WHERE school_id = s.id AND role = 'student') AS student_count
       FROM schools s ORDER BY s.created_at DESC`,
    )
    return res.json({ schools: rows })
  } catch (error) {
    console.error('admin schools list failed:', error)
    return res.status(500).json({ error: 'Could not fetch schools.' })
  }
})

// List organizations with an aggregate school count (admin only). The admin
// doesn't manage an org's schools directly (each org adds its own via
// POST /organization/invite-school) but does set the org's own price and
// payment due date — see PATCH /organization/admin/:id/price and /due-date.
router.get('/admin/organizations', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT o.id, o.name, o.account_code, o.contact_email, o.created_at, o.price_amount, o.price_period, o.payment_due_date,
        o.admin_notes, o.payment_status, o.payment_notes, o.paid_at,
        COUNT(s.id) AS school_count
       FROM organizations o
       LEFT JOIN schools s ON s.organization_id = o.id
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
    )
    return res.json({ organizations: rows })
  } catch (error) {
    console.error('admin organizations list failed:', error)
    return res.status(500).json({ error: 'Could not fetch organizations.' })
  }
})

// Set an internal admin-only note on a school. Never returned to the school
// (see /info and the school-facing endpoints, which whitelist columns and
// omit admin_notes).
router.patch('/admin/:id/notes', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const note = String(req.body.note ?? '').trim()
  try {
    await query('UPDATE schools SET admin_notes = $1 WHERE id = $2', [note || null, req.params.id])
    return res.json({ ok: true })
  } catch (error) {
    console.error('admin note update failed:', error)
    return res.status(500).json({ error: 'Could not save note.' })
  }
})

// Set a school's custom price (e.g. amount "$200" billed "monthly" or
// "yearly"). Used as the default when sending that school a payment notice.
router.patch('/admin/:id/price', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const amount = String(req.body.amount ?? '').trim().replace(/^\$/, '').replace(/,/g, '')
  // Shown to the customer and used to pre-fill their invoices, so a typo is
  // refused here rather than billed: a plain amount, up to two decimals.
  if (amount && !/^\d{1,7}(\.\d{1,2})?$/.test(amount)) {
    return res.status(400).json({ error: 'Enter the price as an amount, like 499 or 499.00.' })
  }
  const period = req.body.period ? String(req.body.period).trim() : null
  if (period && !['monthly', 'yearly', 'one_time'].includes(period)) {
    return res.status(400).json({ error: 'Invalid billing period.' })
  }
  try {
    await query('UPDATE schools SET price_amount = $1, price_period = $2 WHERE id = $3', [amount || null, amount ? period : null, req.params.id])
    return res.json({ ok: true })
  } catch (error) {
    console.error('admin price update failed:', error)
    return res.status(500).json({ error: 'Could not save price.' })
  }
})

// ---------------------------------------------------------------------------
// Draining pdf_uploads.file_data (#143 step 6)
//
// Documents uploaded before tenant storage existed — or by a school that has
// since connected a bucket — still sit in our database as base64. These two
// routes move them out, school by school, so the column can eventually be
// dropped. Only rows belonging to a school with an *active* config can move;
// for a school with no bucket there is nowhere to move them to, and they stay.
//
// This is the one path where the bytes pass through our server, which is the
// thing #143 exists to avoid. It is a deliberate one-time transfer, admin-only,
// and every move is audited.
// ---------------------------------------------------------------------------

// GET /api/school/admin/pdf-drain-status — what is left to move.
router.get('/admin/pdf-drain-status', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT s.id AS school_id, s.name AS school_name,
              count(p.id)::int AS undrained,
              COALESCE(sum(length(p.file_data)), 0)::bigint AS approx_bytes,
              (ts.id IS NOT NULL) AS has_storage
         FROM pdf_uploads p
         JOIN schools s ON s.id = p.school_id
         LEFT JOIN tenant_storage ts
           ON ts.status = 'active'
          AND (ts.school_id = s.id OR (s.organization_id IS NOT NULL AND ts.organization_id = s.organization_id))
        WHERE p.file_data IS NOT NULL
        GROUP BY s.id, s.name, (ts.id IS NOT NULL)
        ORDER BY undrained DESC`,
    )
    const movable = rows.filter((r) => r.has_storage)
    return res.json({
      schools: rows,
      totals: {
        undrained: rows.reduce((n, r) => n + r.undrained, 0),
        movableNow: movable.reduce((n, r) => n + r.undrained, 0),
        blockedNoStorage: rows.filter((r) => !r.has_storage).reduce((n, r) => n + r.undrained, 0),
      },
    })
  } catch (error) {
    console.error('pdf drain status failed:', error)
    return res.status(500).json({ error: 'Could not read drain status.' })
  }
})

// POST /api/school/admin/drain-pdf-uploads { schoolId?, limit?, dryRun? }
// Moves a batch into the owning school's bucket. Deliberately batched and
// manually triggered rather than run on boot: it is a one-off migration of
// minors' documents, not something that should happen unattended.
router.post('/admin/drain-pdf-uploads', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const limit = Math.min(Math.max(Number(req.body?.limit) || 25, 1), 100)
  const dryRun = req.body?.dryRun === true
  const onlySchool = req.body?.schoolId ? String(req.body.schoolId) : null

  try {
    const { rows } = await query(
      `SELECT id, user_id, school_id, filename, file_type, length(file_data) AS chars
         FROM pdf_uploads
        WHERE file_data IS NOT NULL
          AND ($1::text IS NULL OR school_id = $1)
        ORDER BY created_at
        LIMIT $2`,
      [onlySchool, limit],
    )

    const result = { examined: rows.length, moved: 0, skippedNoStorage: 0, failed: 0, dryRun, errors: [] }
    const configs = new Map()

    for (const row of rows) {
      if (!configs.has(row.school_id)) configs.set(row.school_id, await activeStorageForSchool(row.school_id))
      const cfgRow = configs.get(row.school_id)
      if (!cfgRow) { result.skippedNoStorage += 1; continue }
      if (dryRun) { result.moved += 1; continue }

      try {
        // Re-read the bytes only now, one row at a time — loading every
        // document in the batch into memory at once is how a free-tier dyno
        // dies.
        const { rows: dataRows } = await query('SELECT file_data FROM pdf_uploads WHERE id = $1', [row.id])
        const base64 = dataRows[0]?.file_data
        if (!base64) { result.skippedNoStorage += 1; continue }
        const body = Buffer.from(base64, 'base64')

        const config = usableStorage(cfgRow)
        const ext = (row.file_type || '').includes('pdf') ? 'pdf' : 'bin'
        // Same namespace the browser would have used, so keyBelongsTo() keeps
        // holding for these rows afterwards.
        const key = withPrefix(config.prefix, `students/${row.user_id}/${uid('doc')}.${ext}`)
        const url = presign(config, {
          method: 'PUT',
          key,
          expiresIn: 300,
          headers: { 'content-length': String(body.length) },
        })

        const put = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': row.file_type || 'application/pdf', 'Content-Length': String(body.length) },
          body,
        })
        if (!put.ok) throw new Error(`bucket returned ${put.status}`)

        // Pointer written and bytes dropped in one statement, so a crash
        // between the two can't leave a row claiming a key it never got.
        await query(
          `UPDATE pdf_uploads
              SET storage_id = $1, object_key = $2, file_bytes = $3, file_data = NULL
            WHERE id = $4`,
          [cfgRow.id, key, body.length, row.id],
        )

        recordAudit(req, {
          action: AUDIT.PDF_MIGRATED,
          subjectUserId: row.user_id,
          schoolId: row.school_id,
          objectType: 'pdf_upload',
          objectId: row.id,
          meta: { key, bytes: body.length, storageId: cfgRow.id },
        })
        result.moved += 1
      } catch (error) {
        result.failed += 1
        // The row keeps its bytes — a failed move must never lose a document.
        result.errors.push({ id: row.id, error: String(error.message).slice(0, 200) })
      }
    }

    const { rows: left } = await query(
      `SELECT count(*)::int AS remaining FROM pdf_uploads WHERE file_data IS NOT NULL`,
    )
    result.remaining = left[0]?.remaining ?? null
    return res.json(result)
  } catch (error) {
    console.error('pdf drain failed:', error)
    return res.status(500).json({ error: 'Could not drain documents.' })
  }
})

// All submissions across all schools (admin only)
router.get('/admin/submissions', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT p.id, p.filename, p.file_type, p.status, p.notes, p.created_at,
              u.name AS user_name, u.email AS user_email,
              s.name AS school_name, s.pin AS school_pin
       FROM pdf_uploads p
       JOIN users u ON p.user_id = u.id
       JOIN schools s ON p.school_id = s.id
       ORDER BY p.created_at DESC`,
    )
    return res.json({ submissions: rows })
  } catch (error) {
    console.error('admin submissions failed:', error)
    return res.status(500).json({ error: 'Could not fetch submissions.' })
  }
})

// Update payment status for a school (admin only)
router.patch('/admin/:id/payment', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const { status, notes } = req.body
  if (!status || !['paid', 'unpaid', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be paid, unpaid, or rejected.' })
  }
  if (status === 'rejected' && (!notes || !notes.trim())) {
    return res.status(400).json({ error: 'A reason is required when rejecting a payment.' })
  }

  try {
    // A double-click or retried request must not email the school twice or log
    // a second payment event, so each branch only goes on when its UPDATE
    // actually changed the row. Approval compares status alone (re-approving
    // shouldn't re-confirm); unpaid/rejected also compare notes, since a new
    // rejection reason is worth sending.
    let school
    if (status === 'paid') {
      const { rows } = await query(
        `UPDATE schools SET payment_status = $1, payment_notes = $2, paid_at = now()
         WHERE id = $3 AND payment_status IS DISTINCT FROM $1
         RETURNING contact_email`,
        [status, notes || null, req.params.id],
      )
      school = rows[0]
      if (!school) return res.json({ ok: true, emailSent: null, unchanged: true })
      await query(
        `INSERT INTO payment_events (id, entity_type, entity_id, event_type, notes) VALUES ($1, 'school', $2, 'status_paid', $3)`,
        [uid('pev'), req.params.id, notes || null],
      )
      await settleSingleOpenInvoice('school', req.params.id).catch((e) => console.error('invoice settle failed:', e.message))

      if (school.contact_email) {
        await sendEmail({
          to: school.contact_email,
          subject: 'Payment confirmed — VolunTrack',
          html: `<p>Your payment confirmation has been verified. Your school's account is now unlocked — student uploads and management are available.</p>${emailFooterHtml()}`,
        })
      }
    } else {
      const { rows } = await query(
        `UPDATE schools SET payment_status = $1, payment_notes = $2::text, paid_at = NULL
         WHERE id = $3 AND (payment_status, COALESCE(payment_notes, '')) IS DISTINCT FROM ($1, COALESCE($2::text, ''))
         RETURNING contact_email`,
        [status, notes || null, req.params.id],
      )
      school = rows[0]
      if (!school) return res.json({ ok: true, emailSent: null, unchanged: true })
      await query(
        `INSERT INTO payment_events (id, entity_type, entity_id, event_type, notes) VALUES ($1, 'school', $2, $3, $4)`,
        [uid('pev'), req.params.id, status === 'unpaid' ? 'status_unpaid' : 'status_rejected', notes || null],
      )
    }

    // Rejected payments notify the school so they know to resubmit.
    let emailSent = null
    if (status === 'rejected') {
      const id = uid('anot')
      // Trim trailing periods without a regex — `/\.+$/` on caller-supplied
      // text backtracks quadratically (ReDoS).
      let reason = notes.trim()
      let reasonEnd = reason.length
      while (reasonEnd > 0 && reason[reasonEnd - 1] === '.') reasonEnd--
      reason = reason.slice(0, reasonEnd)
      const rejectMsg = `Your payment confirmation could not be verified: ${reason}. Please resubmit a valid bank confirmation number.`
      await query(
        'INSERT INTO admin_notifications (id, school_id, message) VALUES ($1, $2, $3)',
        [id, req.params.id, rejectMsg],
      )

      emailSent = false
      if (school.contact_email) {
        const result = await sendEmail({
          to: school.contact_email,
          subject: 'Payment confirmation rejected — VolunTrack',
          html: `<p>${escapeHtml(rejectMsg)}</p>${emailFooterHtml()}`,
        })
        emailSent = result.sent
      }
    }

    return res.json({ ok: true, emailSent })
  } catch (error) {
    console.error('update payment failed:', error)
    return res.status(500).json({ error: 'Could not update payment.' })
  }
})

const INVITE_TTL_DAYS = 3

// Invite a school (admin only). Sends a signup link pre-filled with the
// given name/email; the school sets their own password/code via
// /school/register?token=... within INVITE_TTL_DAYS.
router.post('/admin/invite', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const name = String(req.body.name || '').trim()
  const email = String(req.body.email || '').trim().toLowerCase()

  if (!name || name.length > 100) return res.status(400).json({ error: 'School name is required.' })
  if (!email || !validator.isEmail(email) || email.length > 254) return res.status(400).json({ error: 'Valid email required.' })

  try {
    const id = uid('inv')
    const token = generateToken()
    await query(
      `INSERT INTO school_invites (id, name, email, token, status, expires_at)
       VALUES ($1, $2, $3, $4, 'pending', now() + interval '${INVITE_TTL_DAYS} days')`,
      [id, name, email, token],
    )

    const link = `${process.env.FRONTEND_URL || ''}/school/register?token=${token}`
    const { sent: emailSent } = await sendEmail({
      to: email,
      subject: 'You’re invited to set up your school on VolunTrack',
      html: `<p>${escapeHtml(name)} has been invited to join VolunTrack. Click the link below to finish setting up your school account — choose your password and school code.</p><p><a href="${link}">${link}</a></p><p>This link expires in ${INVITE_TTL_DAYS} days.</p>${emailFooterHtml()}`,
    })

    return res.status(201).json({ ok: true, id, emailSent })
  } catch (error) {
    console.error('school invite failed:', error)
    return res.status(500).json({ error: 'Could not send invite.' })
  }
})

// List invites (admin only) — expired-but-unmarked rows are reported as
// 'expired' without a write, since a background sweep isn't worth it here.
router.get('/admin/invites', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, name, email, status, expires_at, created_at,
         CASE WHEN status = 'pending' AND expires_at < now() THEN 'expired' ELSE status END AS effective_status
       FROM school_invites ORDER BY created_at DESC`,
    )
    return res.json({ invites: rows })
  } catch (error) {
    console.error('list invites failed:', error)
    return res.status(500).json({ error: 'Could not fetch invites.' })
  }
})

// Resend an invite (admin only) — issues a fresh token/expiry so an old,
// possibly-leaked link stops working.
router.post('/admin/invite/:id/resend', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM school_invites WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'Invite not found.' })
    const invite = rows[0]
    if (invite.status === 'completed') return res.status(409).json({ error: 'This invite has already been used.' })

    const token = generateToken()
    await query(
      `UPDATE school_invites SET token = $1, status = 'pending', expires_at = now() + interval '${INVITE_TTL_DAYS} days' WHERE id = $2`,
      [token, req.params.id],
    )

    const link = `${process.env.FRONTEND_URL || ''}/school/register?token=${token}`
    const { sent: emailSent } = await sendEmail({
      to: invite.email,
      subject: 'You’re invited to set up your school on VolunTrack',
      html: `<p>${escapeHtml(invite.name)} has been invited to join VolunTrack. Click the link below to finish setting up your school account — choose your password and school code.</p><p><a href="${link}">${link}</a></p><p>This link expires in ${INVITE_TTL_DAYS} days.</p>${emailFooterHtml()}`,
    })

    return res.json({ ok: true, emailSent })
  } catch (error) {
    console.error('resend invite failed:', error)
    return res.status(500).json({ error: 'Could not resend invite.' })
  }
})

// Delete an invite (admin only)
router.delete('/admin/invite/:id', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    await query('DELETE FROM school_invites WHERE id = $1', [req.params.id])
    return res.json({ ok: true })
  } catch (error) {
    console.error('delete invite failed:', error)
    return res.status(500).json({ error: 'Could not delete invite.' })
  }
})

// Delete a school and unlink its students (admin only)
router.delete('/admin/:id', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    // The school's own logins go with it: an admin or co-admin account linked
    // to no school can still sign in but has nothing to manage. Students keep
    // their accounts and hours and are only unlinked.
    await query(`DELETE FROM users WHERE school_id = $1 AND role IN ('school', 'school_staff')`, [req.params.id])
    await query('UPDATE users SET school_id = NULL WHERE school_id = $1', [req.params.id])
    await query('DELETE FROM schools WHERE id = $1', [req.params.id])
    return res.json({ ok: true })
  } catch (error) {
    console.error('admin delete school failed:', error)
    return res.status(500).json({ error: 'Could not delete school.' })
  }
})

// Set a single school's payment due date (admin only)
router.patch('/admin/:id/due-date', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const dueDate = req.body.dueDate ? String(req.body.dueDate).trim() : null
  if (dueDate && !isValidDateString(dueDate)) return res.status(400).json({ error: 'Enter the due date as YYYY-MM-DD.' })
  try {
    await query('UPDATE schools SET payment_due_date = $1 WHERE id = $2', [dueDate || null, req.params.id])
    return res.json({ ok: true })
  } catch (error) {
    console.error('set payment due date failed:', error)
    return res.status(500).json({ error: 'Could not set due date.' })
  }
})

// Send payment notification to all schools (admin only)
router.post('/admin/notify-payment', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const { message, amount, billingPeriod } = req.body
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Message is required.' })
  }
  try {
    const id = uid('anot')
    await query(
      'INSERT INTO admin_notifications (id, message) VALUES ($1, $2)',
      [id, message.trim()],
    )

    const paymentInstructions = await getPaymentInstructions()
    const { rows: schools } = await query('SELECT id, name, account_code, contact_email, payment_due_date, price_amount, price_period FROM schools WHERE contact_email IS NOT NULL')
    const results = await Promise.all(schools.map((s) => sendEmail({
      to: s.contact_email,
      subject: 'Payment notice from VolunTrack',
      html: paymentNoticeHtml({
        recipientName: s.name,
        accountCode: s.account_code,
        paymentInstructions,
        amount: amount || s.price_amount,
        billingPeriod: amount ? billingPeriod : s.price_period,
        dueDate: s.payment_due_date,
        message: message.trim(),
      }),
    })))
    const emailsSent = results.filter((r) => r.sent).length

    return res.status(201).json({ ok: true, id, emailsSent, emailsTotal: schools.length })
  } catch (error) {
    console.error('notify payment failed:', error)
    return res.status(500).json({ error: 'Could not send notification.' })
  }
})

// Send notification to a specific school (admin only)
router.post('/admin/notify-school/:schoolId', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const { message, amount, billingPeriod } = req.body
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Message is required.' })
  }
  try {
    const id = uid('anot')
    await query(
      'INSERT INTO admin_notifications (id, school_id, message) VALUES ($1, $2, $3)',
      [id, req.params.schoolId, message.trim()],
    )

    const { rows } = await query('SELECT name, account_code, contact_email, payment_due_date, price_amount, price_period FROM schools WHERE id = $1', [req.params.schoolId])
    const hasContactEmail = Boolean(rows[0]?.contact_email)
    let emailSent = false
    if (hasContactEmail) {
      const result = await sendEmail({
        to: rows[0].contact_email,
        subject: 'Payment notice from VolunTrack',
        html: paymentNoticeHtml({
          recipientName: rows[0].name,
          accountCode: rows[0].account_code,
          paymentInstructions: await getPaymentInstructions(),
          amount: amount || rows[0].price_amount,
          billingPeriod: amount ? billingPeriod : rows[0].price_period,
          dueDate: rows[0].payment_due_date,
          message: message.trim(),
        }),
      })
      emailSent = result.sent
    }

    return res.status(201).json({ ok: true, id, emailSent, hasContactEmail })
  } catch (error) {
    console.error('notify school failed:', error)
    return res.status(500).json({ error: 'Could not send notification.' })
  }
})

// Get admin notifications for the caller's own school plus broadcast ones
// (school_id IS NULL). The school is derived from the authenticated user —
// a client-supplied schoolId is ignored so one tenant can't read another's
// notifications (see /messages below for the same pattern).
router.get('/admin/notifications', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows: userRows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    const schoolId = userRows[0]?.school_id || null
    const { rows } = await query(
      'SELECT id, message, created_at FROM admin_notifications WHERE school_id IS NULL OR school_id = $1 ORDER BY created_at DESC LIMIT 50',
      [schoolId],
    )
    return res.json({ notifications: rows })
  } catch (error) {
    console.error('get notifications failed:', error)
    return res.status(500).json({ error: 'Could not fetch notifications.' })
  }
})

// --- School chat (school admin → students) ---

// Send a message (school admin only)
router.post('/messages', limiter, requireDb, requireAuth('school', 'school_staff'), requirePaidSchool, async (req, res) => {
  const { message } = req.body
  if (!message || typeof message !== 'string' || message.trim().length === 0 || message.length > 2000) {
    return res.status(400).json({ error: 'Message is required (max 2000 chars).' })
  }
  try {
    const { rows: userRows } = await query('SELECT name, school_id FROM users WHERE id = $1', [req.auth.sub])
    if (!userRows[0]?.school_id) return res.status(400).json({ error: 'No school linked to your account.' })
    const id = uid('msg')
    await query(
      'INSERT INTO school_messages (id, school_id, sender_id, sender_name, message) VALUES ($1, $2, $3, $4, $5)',
      [id, userRows[0].school_id, req.auth.sub, userRows[0].name, message.trim()],
    )
    return res.status(201).json({ ok: true, id })
  } catch (error) {
    console.error('send message failed:', error)
    return res.status(500).json({ error: 'Could not send message.' })
  }
})

// Get messages for this school (school admin or student)
router.get('/messages', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows: userRows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    if (!userRows[0]?.school_id) return res.json({ messages: [] })
    const { rows } = await query(
      `SELECT id, sender_id, sender_name, message, created_at
       FROM school_messages WHERE school_id = $1
       ORDER BY created_at DESC LIMIT 100`,
      [userRows[0].school_id],
    )
    return res.json({ messages: rows })
  } catch (error) {
    console.error('get messages failed:', error)
    return res.status(500).json({ error: 'Could not fetch messages.' })
  }
})


// ---------------------------------------------------------------------------
// Bulk hour reports (#142)
// ---------------------------------------------------------------------------

// One request must not be able to pull an unbounded number of rows. Callers
// are told when they hit this so they can narrow the range rather than
// silently getting a partial export.
const REPORT_ROW_CAP = 20000

// How an entry was signed off, as a code the export turns into a label
// (src/lib/export.js). In order of strength: the organizer signed in their own
// account; the supervisor signed on the student's device; or a link — which
// the student may also have held — was signed. Needs `l` = logs.
const SIGNED_HOW_SQL = `CASE
  WHEN l.organizer_signature IS NOT NULL THEN 'organizer'
  WHEN l.supervisor_signed_in_person THEN 'in_person'
  ELSE (SELECT CASE sv.delivery WHEN 'student' THEN 'student_link' ELSE 'emailed' END
          FROM supervisor_verifications sv WHERE sv.token = l.verification_token)
END`

function validDate(value) {
  const s = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null
}

// Which schools the caller may report on. Returns null when the caller has no
// valid scope, so the handler can 403 without leaking whether ids exist.
async function reportScope(auth, body) {
  if (auth.role === 'school' || auth.role === 'school_staff') {
    const { rows } = await query('SELECT school_id FROM users WHERE id = $1', [auth.sub])
    const schoolId = rows[0]?.school_id
    if (!schoolId) return null
    // Mirrors requirePaidSchool, which can't be used as middleware here
    // because org/admin callers have no school of their own.
    const { rows: paid } = await query('SELECT payment_status FROM schools WHERE id = $1', [schoolId])
    if (paid[0]?.payment_status !== 'paid') return { unpaid: true }
    return { schoolIds: [schoolId] }
  }

  if (auth.role === 'org') {
    const { rows } = await query('SELECT organization_id FROM users WHERE id = $1', [auth.sub])
    const orgId = rows[0]?.organization_id
    if (!orgId) return null
    const { rows: schools } = await query('SELECT id FROM schools WHERE organization_id = $1', [orgId])
    return { schoolIds: schools.map((s) => s.id) }
  }

  if (auth.role === 'admin') {
    if (body.schoolId) return { schoolIds: [String(body.schoolId)] }
    if (body.organizationId) {
      const { rows: schools } = await query('SELECT id FROM schools WHERE organization_id = $1', [String(body.organizationId)])
      return { schoolIds: schools.map((s) => s.id) }
    }
    return null
  }

  return null
}

// GET /api/school/reports/hours?from=&to=&approvedOnly=
// Every student in scope with their logs in the range. Students with no logs
// are included deliberately — "who has logged nothing yet" is one of the
// questions this report exists to answer.
router.get('/reports/hours', limiter, requireDb, requireAuth('school', 'school_staff', 'org', 'admin'), async (req, res) => {
  const from = validDate(req.query.from)
  const to = validDate(req.query.to)
  if (!from || !to) return res.status(400).json({ error: 'from and to are required, as YYYY-MM-DD.' })
  if (from > to) return res.status(400).json({ error: 'from must be on or before to.' })

  const approvedOnly = req.query.approvedOnly === 'true'

  try {
    const scope = await reportScope(req.auth, req.query)
    if (!scope) return res.status(403).json({ error: 'Your account is not linked to a school or organization.' })
    if (scope.unpaid) {
      return res.status(403).json({ error: 'This school has not completed payment yet. Reports are paused until payment is verified.' })
    }
    if (scope.schoolIds.length === 0) return res.json({ students: [], logs: [], totals: emptyTotals(), truncated: false, range: { from, to } })

    const { rows } = await query(
      `SELECT u.id  AS student_id, u.name AS student_name, u.email AS student_email,
              u.grade, u.school_id, sc.name AS school_name,
              l.id   AS log_id, to_char(l.date, 'YYYY-MM-DD') AS date, l.activity, l.category, l.hours,
              l.verification_status, l.org_name, l.supervisor_name, l.location, l.notes,
              ${SIGNED_HOW_SQL} AS signed_how
         FROM users u
         JOIN schools sc ON sc.id = u.school_id
         LEFT JOIN logs l
           ON l.user_id = u.id
          AND l.date BETWEEN $2 AND $3
          AND ($4::bool = false OR l.verification_status = 'approved')
        WHERE u.role = 'student' AND u.school_id = ANY($1)
        ORDER BY sc.name, u.name, l.date
        LIMIT $5`,
      [scope.schoolIds, from, to, approvedOnly, REPORT_ROW_CAP + 1],
    )

    const truncated = rows.length > REPORT_ROW_CAP
    const kept = truncated ? rows.slice(0, REPORT_ROW_CAP) : rows

    // Roll up per student. The LEFT JOIN yields one row per student even when
    // they have no logs, so guard on log_id rather than assuming a log exists.
    const byStudent = new Map()
    const logs = []
    for (const r of kept) {
      let s = byStudent.get(r.student_id)
      if (!s) {
        s = {
          studentId: r.student_id,
          name: r.student_name,
          email: r.student_email,
          grade: r.grade || null,
          schoolId: r.school_id,
          schoolName: r.school_name,
          logCount: 0,
          totalHours: 0,
          approvedHours: 0,
          pendingHours: 0,
          rejectedHours: 0,
        }
        byStudent.set(r.student_id, s)
      }
      if (!r.log_id) continue

      const hours = Number(r.hours) || 0
      s.logCount += 1
      // Keep approved and pending distinct — #128 and #136 exist because
      // collapsing them misreports a school's real verified total. Rejected
      // hours are tracked separately and deliberately excluded from the
      // total, so approved + pending == total and the columns an
      // administrator reads actually reconcile.
      if (r.verification_status === 'approved') {
        s.approvedHours += hours
        s.totalHours += hours
      } else if (r.verification_status === 'rejected') {
        s.rejectedHours += hours
      } else {
        s.pendingHours += hours
        s.totalHours += hours
      }

      logs.push({
        logId: r.log_id,
        studentId: r.student_id,
        studentName: r.student_name,
        studentEmail: r.student_email,
        grade: r.grade || '',
        schoolName: r.school_name,
        date: r.date,
        activity: r.activity || '',
        category: r.category || '',
        hours,
        verificationStatus: r.verification_status,
        signedHow: r.signed_how,
        orgName: r.org_name || '',
        supervisorName: r.supervisor_name || '',
        location: r.location || '',
        notes: r.notes || '',
      })
    }

    const students = [...byStudent.values()].map(round2)
    const totals = students.reduce((acc, s) => ({
      students: acc.students + 1,
      logs: acc.logs + s.logCount,
      totalHours: acc.totalHours + s.totalHours,
      approvedHours: acc.approvedHours + s.approvedHours,
      pendingHours: acc.pendingHours + s.pendingHours,
      rejectedHours: acc.rejectedHours + s.rejectedHours,
    }), emptyTotals())

    return res.json({
      range: { from, to, approvedOnly },
      students,
      logs,
      totals: round2(totals),
      truncated,
      rowCap: REPORT_ROW_CAP,
    })
  } catch (error) {
    console.error('hours report failed:', error)
    return res.status(500).json({ error: 'Could not build the report.' })
  }
})

function emptyTotals() {
  return { students: 0, logs: 0, totalHours: 0, approvedHours: 0, pendingHours: 0, rejectedHours: 0 }
}

// Hours are NUMERIC and summed in JS, so trim float drift before display.
function round2(o) {
  for (const k of ['totalHours', 'approvedHours', 'pendingHours', 'rejectedHours']) {
    if (typeof o[k] === 'number') o[k] = Math.round(o[k] * 100) / 100
  }
  return o
}

export default router
