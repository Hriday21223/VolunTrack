import express from 'express'
import rateLimit from 'express-rate-limit'
import validator from 'validator'
import { query, hasDatabase, getPool, nextAccountCode, assignReferralCode, settleSingleOpenInvoice } from '../db.js'
import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { uid, generateToken } from '../ids.js'
import { impactFor, PERIODS } from '../impact.js'
import { activeOrgChallenge, scoreboard as orgScoreboard } from '../orgChallenge.js'
import { listRecipients, addRecipient, removeRecipient, RecipientError } from '../impactEmail.js'
import { createHandoverInvite, confirmPassword, sendHandoverError } from '../handover.js'
import { signupPlatform } from '../platform.js'
import { hashPassword, verifyPassword, signToken, requireAuth, authenticate } from '../auth.js'
import { isWeakPassword, WEAK_PASSWORD_MESSAGE, isValidDateString, MAX_HOURS_PER_ENTRY } from '../validate.js'
import { verifyTurnstile } from '../turnstile.js'
import { sendEmail, sendWelcomeEmail, emailFooterHtml, paymentNoticeHtml, hasEmail, emailApiBase } from '../email.js'
import { getPaymentInstructions } from './settings.js'
import { escapeHtml } from '../html.js'
import { friendlyWhen } from '../when.js'
import { ensureDigestUnsubToken } from '../digest.js'
import { emailLang, et, emailDate } from '../emailStrings.js'
import { recordAudit, AUDIT } from '../audit.js'
import { policyForSchool } from '../policy.js'
import { emailAllowedBySignIn, goalHoursFor, gradeKey, gradeLabel, awardFor, requirementShortfall, schoolGrades, gradeAllowed } from '../requirements.js'
import { decryptSecret, hasEncryptionKey } from '../secrets.js'
import { keyBelongsTo, presign, withPrefix } from '../storage/s3.js'
import { recordReferral } from './referral.js'
import { requireCronKey, cronLimiter } from '../cronAuth.js'
import { claimCode, releaseCode, markCodeUser, CODE_REQUIRED_MESSAGE, CODE_REJECTED_MESSAGE } from '../registrationCodes.js'
import { isSignatureImage } from '../signature.js'
import { icsCalendar, icsEvent } from '../ics.js'
import { notify } from '../notifications.js'
import { displayName } from './portfolio.js'
import { canManageTask, refuseTaskAccess, MANAGED_BY_SQL, COHOST_MAX, COHOST_ROLES, COHOST_GENERIC_REFUSAL } from '../taskCohosts.js'
import { schoolIsActive, clubSeatProblem, clubStudentCount, joinWithSeat, CLUB_STUDENT_LIMIT, CLUB_MAX_CO_ADMINS, PLANS } from '../plans.js'
import { SPOTS_USED_SQL, SIGNUP_SPOTS_SQL, spotsUsed, readGuests, groupTooBigMessage } from '../spots.js'

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

    const { rows: schoolRows } = await query('SELECT payment_status, plan FROM schools WHERE id = $1', [schoolId])
    if (schoolRows.length === 0) return res.status(404).json({ error: 'School not found.' })
    // A free club (#506) is never payment-locked.
    if (!schoolIsActive(schoolRows[0])) {
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
  // A free club (#506) needs no code. An invite link always makes a school.
  const plan = !inviteToken && req.body.plan === 'club' ? 'club' : 'school'
  // Otherwise a one-time code from us is required (#287), so a paying school
  // can't become a customer without having contacted us.
  const registrationCode = plan === 'school' && !inviteToken && req.body.registrationCode ? String(req.body.registrationCode) : null
  // Optional. A bad or expired code must never block a registration — the
  // school still gets its account, the admin just sees no referral attached.
  const referralCode = req.body.referralCode ? String(req.body.referralCode).trim().toUpperCase() : null

  if (!name || name.length > 100) return res.status(400).json({ error: 'School name is required.' })
  if (!email || !validator.isEmail(email) || email.length > 254) return res.status(400).json({ error: 'Valid email required.' })
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' })
  if (isWeakPassword(password)) return res.status(400).json({ error: WEAK_PASSWORD_MESSAGE })
  if (!pin || !/^[a-z]+-?\d{3,5}$/.test(pin)) return res.status(400).json({ error: 'School code must be letters followed by digits (e.g. cisd-12345).' })
  if (plan === 'school' && !inviteToken && !registrationCode) return res.status(403).json({ error: CODE_REQUIRED_MESSAGE.school })

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
      'INSERT INTO schools (id, name, pin, contact_email, organization_id, account_code, plan) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [schoolId, name, pin, email, invite?.organization_id || null, await nextAccountCode('schools'), plan],
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
    await sendWelcomeEmail({ to: user.email, name: user.name, role: 'school', schoolPin: pin, plan })
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

    const { rows: meRows } = await query('SELECT school_id, email, grade FROM users WHERE id = $1', [req.auth.sub])
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

    // A school that set its grades (#581) needs one of them from every student
    // who joins: the one they already have if it fits, else the one they pick
    // now. The client shows a picker when it gets needsGrade back.
    if (targetPolicy && !gradeAllowed(targetPolicy.policy, meRows[0]?.grade)) {
      const picked = req.body?.grade ? gradeKey(String(req.body.grade)) : null
      const grades = schoolGrades(targetPolicy.policy)
      if (!picked || !grades.includes(picked)) {
        return res.status(400).json({ error: `Pick your grade at ${target.name}.`, needsGrade: true, grades, schoolName: target.name })
      }
      await query('UPDATE users SET grade = $1 WHERE id = $2', [picked, req.auth.sub])
    }

    // First join links immediately — that is the documented flow, and there is
    // no existing school whose roster the student is leaving.
    // A free club has a student limit (#506). Checked for a transfer request
    // too, so a student isn't left waiting on a club that can't take them.
    const seatProblem = await clubSeatProblem(target.id)
    if (seatProblem) return res.status(409).json({ error: seatProblem })

    if (!currentSchoolId) {
      const joined = await joinWithSeat(target.id, (client) => client.query('UPDATE users SET school_id = $1 WHERE id = $2', [target.id, req.auth.sub]))
      if (joined.error) return res.status(409).json({ error: joined.error })
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

    if (decision === 'accept') {
      const seatProblem = await clubSeatProblem(schoolId)
      if (seatProblem) return res.status(409).json({ error: seatProblem })
    }

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
      const moved = await joinWithSeat(transfer.to_school_id, (client) => client.query('UPDATE users SET school_id = $1 WHERE id = $2', [transfer.to_school_id, transfer.user_id]))
      if (moved.error) {
        // The last seat went between the check above and now: leave the
        // request open rather than mark it accepted with nobody moved.
        await query(`UPDATE school_transfers SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = $1`, [req.params.id])
        return res.status(409).json({ error: moved.error })
      }
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

export async function schoolProgress(schoolId) {
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
  // Minimum hours by type (#561) need each student's hours per category.
  const byCategory = {}
  if (Object.keys(policy?.goals?.byCategory || {}).length > 0) {
    const { rows: cats } = await query(
      `SELECT l.user_id, COALESCE(l.category, '') AS category, SUM(l.hours)::float AS hours
         FROM logs l JOIN users u ON u.id = l.user_id
        WHERE u.school_id = $1 AND u.role = 'student' AND l.verification_status IS DISTINCT FROM 'rejected'
        GROUP BY l.user_id, COALESCE(l.category, '')`,
      [schoolId],
    )
    for (const c of cats) (byCategory[c.user_id] ||= {})[c.category] = c.hours
  }
  const students = rows.map((r) => {
    const hours = Math.round(r.hours * 100) / 100
    // `remaining` counts any type still short, so everything built on it
    // (behind, certificates, reminders, digests) treats that student as not done.
    const { target, remaining, categories } = requirementShortfall(policy, r.grade, hours, byCategory[r.id])
    return {
      id: r.id, name: r.name, email: r.email, grade: r.grade,
      hours, target, remaining,
      categoryShort: categories.filter((c) => c.remaining > 0).map((c) => ({ category: c.category, remaining: c.remaining })),
      lastLogDate: r.last_log_date, remindedAt: r.hours_reminded_at,
      // An under-13 account still waiting for a parent can't sign in yet.
      consentPending: r.parental_consent_status === 'pending',
      // The highest award level reached (#559), or null.
      award: awardFor(policy, hours).current?.name || null,
    }
  })
  return { schoolName: resolved?.schoolName || '', deadline: policy?.goals?.deadline || null, certificate: policy?.certificates || null, students }
}

// GET /api/school/impact?period=year|all — the school's impact report
// (#563): counts only, so it reads no one student's records.
router.get('/impact', limiter, requireDb, requireAuth('school', 'school_staff'), requirePaidSchool, async (req, res) => {
  const period = PERIODS.includes(req.query.period) ? req.query.period : 'year'
  try {
    const { rows } = await query('SELECT u.school_id, s.name FROM users u JOIN schools s ON s.id = u.school_id WHERE u.id = $1', [req.auth.sub])
    if (!rows[0]) return res.status(404).json({ error: 'School not found.' })
    const [impact, progress] = await Promise.all([impactFor([rows[0].school_id], period), schoolProgress(rows[0].school_id)])
    const withGoal = progress.students.filter((s) => s.target)
    return res.json({
      name: rows[0].name,
      ...impact,
      requirement: withGoal.length ? { students: withGoal.length, met: withGoal.filter((s) => s.remaining <= 0).length } : null,
    })
  } catch (error) {
    console.error('school impact failed:', error)
    return res.status(500).json({ error: 'Could not build the impact report.' })
  }
})

// GET /api/school/org-challenge — the school vs school challenge run by the
// organization this account's school belongs to (#575), for its students and
// advisers. School names and numbers only.
router.get('/org-challenge', limiter, requireDb, requireAuth('school', 'school_staff', 'student'), async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT s.id, s.organization_id, o.name AS org_name FROM users u JOIN schools s ON s.id = u.school_id LEFT JOIN organizations o ON o.id = s.organization_id WHERE u.id = $1',
      [req.auth.sub],
    )
    const me = rows[0]
    if (!me?.organization_id) return res.json({ challenge: null })
    const challenge = await activeOrgChallenge(me.organization_id)
    if (!challenge) return res.json({ challenge: null })
    return res.json({ challenge, organizationName: me.org_name, mySchoolId: me.id, scoreboard: await orgScoreboard(me.organization_id, challenge) })
  } catch (error) {
    console.error('org challenge (school view) failed:', error)
    return res.status(500).json({ error: 'Could not load the challenge.' })
  }
})
// Who gets the monthly impact email (#573). The school's main admin chooses.
async function impactRecipientsHandler(req, res, action) {
  try {
    const { rows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    const schoolId = rows[0]?.school_id
    if (!schoolId) return res.status(404).json({ error: 'School not found.' })
    const recipients = action === 'add' ? await addRecipient('school', schoolId, req.body?.email, req.auth.sub)
      : action === 'remove' ? await removeRecipient('school', schoolId, req.params.id)
        : await listRecipients('school', schoolId)
    return res.json({ recipients })
  } catch (error) {
    if (error instanceof RecipientError) return res.status(error.status).json({ error: error.message })
    console.error('impact recipients failed:', error)
    return res.status(500).json({ error: 'Could not update the list.' })
  }
}
router.get('/impact-recipients', limiter, requireDb, requireAuth('school'), (req, res) => impactRecipientsHandler(req, res, 'list'))
router.post('/impact-recipients', limiter, requireDb, requireAuth('school'), (req, res) => impactRecipientsHandler(req, res, 'add'))
router.delete('/impact-recipients/:id', limiter, requireDb, requireAuth('school'), (req, res) => impactRecipientsHandler(req, res, 'remove'))

router.get('/students/progress', limiter, requireDb, requireAuth('school', 'school_staff'), requirePaidSchool, async (req, res) => {
  try {
    const { rows: userRows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    const schoolId = userRows[0]?.school_id
    if (!schoolId) return res.status(404).json({ error: 'School not found.' })
    const progress = await schoolProgress(schoolId)
    recordAudit(req, { action: AUDIT.STUDENT_LIST_READ, schoolId, objectType: 'student_progress', meta: { count: progress.students.length } })
    return res.json({ schoolName: progress.schoolName, deadline: progress.deadline, certificate: progress.certificate, reminderGapDays: REMINDER_GAP_DAYS, students: progress.students })
  } catch (error) {
    console.error('student progress failed:', error)
    return res.status(500).json({ error: 'Could not load student progress.' })
  }
})

// --- School leaderboard (#485) ----------------------------------------------
//
// Friendly competition inside one school: top volunteers by APPROVED hours
// (so logging made-up hours can't climb it) this month or this school year.
// Privacy, because most students are minors:
//   - only students at the same school ever see it;
//   - a student appears only after opting in (users.leaderboard_opt_in);
//   - only a first name and last initial leave the server, never ids, emails
//     or full names;
//   - under-13s and accounts waiting on parental consent never appear or see it;
//   - a school can switch it off (schools.leaderboard_enabled).

const LEADERBOARD_SIZE = 10

// "Maya Patel" → "Maya P."; one-word names stay as they are.
function leaderboardName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'Student'
  const first = parts[0].slice(0, 30)
  return parts.length > 1 ? `${first} ${parts[parts.length - 1][0].toUpperCase()}.` : first
}

// Aug 1 starts a US school year; before August, it's last year's.
function leaderboardStart(period) {
  const now = new Date()
  if (period === 'month') return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const y = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1
  return `${y}-08-01`
}

const LEADERBOARD_ELIGIBLE_SQL = `u.role = 'student' AND u.under_13 IS NOT TRUE
  AND (u.parental_consent_status IS NULL OR u.parental_consent_status <> 'pending')`

async function leaderboardViewer(userId) {
  const { rows } = await query(
    `SELECT u.id, u.school_id, u.leaderboard_opt_in, u.under_13, u.parental_consent_status,
            s.name AS school_name, s.leaderboard_enabled
       FROM users u LEFT JOIN schools s ON s.id = u.school_id
      WHERE u.id = $1`,
    [userId],
  )
  return rows[0] || null
}

// GET /api/school/leaderboard?period=month|year
// --- Group challenge (#531) ---------------------------------------------------
// One shared hour goal for a whole school ("500 hours together by Dec 1").
// Everyone at the school sees one progress bar: hours from the school's
// students dated inside the challenge (rejected entries left out). Only counts
// leave the server — never who logged what — plus the viewer's own share.

async function challengeProgress(challenge, viewerId = null) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(l.hours), 0)::float AS hours,
            COUNT(DISTINCT l.user_id)::int AS participants,
            COALESCE(SUM(l.hours) FILTER (WHERE l.user_id = $4), 0)::float AS mine
       FROM logs l JOIN users u ON u.id = l.user_id
      WHERE u.school_id = $1 AND u.role = 'student'
        AND COALESCE(l.verification_status, 'none') <> 'rejected'
        AND l.date BETWEEN $2 AND $3`,
    [challenge.school_id, challenge.starts_on, challenge.ends_on, viewerId],
  )
  const r = rows[0]
  return {
    id: challenge.id,
    title: challenge.title,
    goalHours: Number(challenge.goal_hours),
    startsOn: challenge.starts_on,
    endsOn: challenge.ends_on,
    hours: Math.round(r.hours * 10) / 10,
    participants: r.participants,
    myHours: viewerId ? Math.round(r.mine * 10) / 10 : null,
  }
}

const CHALLENGE_COLS = `id, school_id, title, goal_hours, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on`

// The running challenge for the caller's school, or null.
router.get('/challenge', limiter, requireDb, requireAuth('student', 'school', 'school_staff'), async (req, res) => {
  try {
    const { rows: me } = await query(
      `SELECT u.school_id, s.plan, s.payment_status FROM users u LEFT JOIN schools s ON s.id = u.school_id WHERE u.id = $1`,
      [req.auth.sub],
    )
    if (!me[0]?.school_id || !schoolIsActive(me[0])) return res.json({ challenge: null })
    const { rows } = await query(`SELECT ${CHALLENGE_COLS} FROM school_challenges WHERE school_id = $1 AND ended_at IS NULL`, [me[0].school_id])
    if (!rows[0]) return res.json({ challenge: null })
    return res.json({ challenge: await challengeProgress(rows[0], req.auth.role === 'student' ? req.auth.sub : null) })
  } catch (error) {
    console.error('challenge read failed:', error)
    return res.status(500).json({ error: 'Could not load the challenge.' })
  }
})

router.post('/challenge', limiter, requireDb, requireAuth('school', 'school_staff'), requirePaidSchool, async (req, res) => {
  const title = String(req.body?.title || '').trim()
  const goalHours = Number(req.body?.goalHours)
  const today = new Date().toISOString().slice(0, 10)
  const startsOn = req.body?.startsOn ? String(req.body.startsOn) : today
  const endsOn = String(req.body?.endsOn || '')
  if (!title || title.length > 120) return res.status(400).json({ error: 'Give the challenge a name (up to 120 characters).' })
  if (!Number.isFinite(goalHours) || goalHours <= 0 || goalHours > 1000000) return res.status(400).json({ error: 'Enter the goal in hours.' })
  if (!isValidDateString(startsOn) || !isValidDateString(endsOn)) return res.status(400).json({ error: 'Enter the dates as YYYY-MM-DD.' })
  if (endsOn < startsOn || endsOn < today) return res.status(400).json({ error: 'The end date must be after the start date and not in the past.' })
  try {
    const { rows: me } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    const schoolId = me[0]?.school_id
    if (!schoolId) return res.status(404).json({ error: 'School not found.' })
    const { rows } = await query(
      `INSERT INTO school_challenges (id, school_id, title, goal_hours, starts_on, ends_on, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (school_id) WHERE ended_at IS NULL DO NOTHING
       RETURNING ${CHALLENGE_COLS}`,
      [uid('chl'), schoolId, title, goalHours, startsOn, endsOn, req.auth.sub],
    )
    if (!rows[0]) return res.status(409).json({ error: 'A challenge is already running. End it first.' })
    return res.status(201).json({ challenge: await challengeProgress(rows[0]) })
  } catch (error) {
    console.error('challenge create failed:', error)
    return res.status(500).json({ error: 'Could not start the challenge.' })
  }
})

router.delete('/challenge/:id', limiter, requireDb, requireAuth('school', 'school_staff'), requirePaidSchool, async (req, res) => {
  try {
    const { rowCount } = await query(
      `UPDATE school_challenges SET ended_at = now()
        WHERE id = $1 AND ended_at IS NULL AND school_id = (SELECT school_id FROM users WHERE id = $2)`,
      [req.params.id, req.auth.sub],
    )
    if (!rowCount) return res.status(404).json({ error: 'That challenge is not running.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('challenge end failed:', error)
    return res.status(500).json({ error: 'Could not end the challenge.' })
  }
})

// POST /api/school/group-hours (#539): after a club meeting or event, the
// adviser adds the same hours for every student who was there, already
// approved — the adviser is the verifying authority, as a task organizer is.
// Only students at the adviser's own school; one entry per student per
// date+activity, so a double click doesn't double the hours.
const GROUP_HOURS_MAX = 200
router.post('/group-hours', limiter, requireDb, requireAuth('school', 'school_staff'), requirePaidSchool, async (req, res) => {
  const ids = Array.isArray(req.body?.studentIds) ? [...new Set(req.body.studentIds.map(String))] : []
  const date = String(req.body?.date || '')
  const activity = String(req.body?.activity || '').trim()
  const category = String(req.body?.category || '').trim().slice(0, 100) || 'Community Service'
  const hours = Number(req.body?.hours)
  const notes = String(req.body?.notes || '').trim().slice(0, 500)
  if (ids.length === 0) return res.status(400).json({ error: 'Pick at least one student.' })
  if (ids.length > GROUP_HOURS_MAX) return res.status(400).json({ error: `Up to ${GROUP_HOURS_MAX} students at a time.` })
  if (!isValidDateString(date) || date > new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: 'Enter a date that isn’t in the future.' })
  if (!activity || activity.length > 200) return res.status(400).json({ error: 'Say what the students did (up to 200 characters).' })
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS_PER_ENTRY) return res.status(400).json({ error: `Hours must be more than 0 and at most ${MAX_HOURS_PER_ENTRY}.` })
  try {
    const { rows: me } = await query(
      `SELECT u.school_id, u.name, s.name AS school_name FROM users u JOIN schools s ON s.id = u.school_id WHERE u.id = $1`,
      [req.auth.sub],
    )
    const school = me[0]
    if (!school) return res.status(404).json({ error: 'School not found.' })
    const { rows: students } = await query(
      `SELECT id FROM users WHERE id = ANY($1) AND school_id = $2 AND role = 'student'`,
      [ids, school.school_id],
    )
    let added = 0
    let skipped = 0
    const note = notes || `Added by ${school.name || 'your adviser'} (${school.school_name})`
    for (const { id } of students) {
      const { rowCount } = await query(
        `INSERT INTO logs (id, user_id, date, activity, category, hours, notes, verified_by, verification_status)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, 'approved'
          WHERE NOT EXISTS (SELECT 1 FROM logs WHERE user_id = $2 AND date = $3 AND LOWER(activity) = LOWER($4))`,
        [uid('log'), id, date, activity, category, hours, note, req.auth.sub],
      )
      if (rowCount) {
        added += 1
        notify(id, { kind: 'hours_approved', title: `${hours} hours added: ${activity}`, body: `${school.school_name} added these for you.`, link: '/' })
      } else {
        skipped += 1
      }
    }
    recordAudit(req, { action: AUDIT.HOURS_ADDED_FOR_GROUP, schoolId: school.school_id, objectType: 'logs', meta: { students: added, hours } })
    return res.json({ ok: true, added, skipped, notAtSchool: ids.length - students.length })
  } catch (error) {
    console.error('group hours failed:', error)
    return res.status(500).json({ error: 'Could not add the hours.' })
  }
})

router.get('/leaderboard', limiter, requireDb, requireAuth('student'), async (req, res) => {
  const period = req.query.period === 'year' ? 'year' : 'month'
  try {
    const me = await leaderboardViewer(req.auth.sub)
    if (!me) return res.status(404).json({ error: 'Account not found.' })
    if (!me.school_id) return res.json({ available: false, reason: 'no_school' })
    if (me.leaderboard_enabled === false) return res.json({ available: false, reason: 'disabled' })
    if (me.under_13 === true || me.parental_consent_status === 'pending') return res.json({ available: false, reason: 'age' })

    const { rows } = await query(
      `WITH totals AS (
         SELECT u.id, u.name, SUM(l.hours) AS hours
           FROM users u
           JOIN logs l ON l.user_id = u.id AND l.verification_status = 'approved'
                      AND l.date >= $2 AND l.date <= current_date
          WHERE u.school_id = $1 AND u.leaderboard_opt_in AND ${LEADERBOARD_ELIGIBLE_SQL}
          GROUP BY u.id
         HAVING SUM(l.hours) > 0
       ), ranked AS (
         SELECT id, name, hours, RANK() OVER (ORDER BY hours DESC) AS rank,
                ROW_NUMBER() OVER (ORDER BY hours DESC, id) AS position
           FROM totals
       )
       SELECT id, name, hours, rank::int, position::int, (SELECT COUNT(*)::int FROM totals) AS participants
         FROM ranked
        WHERE position <= $3 OR id = $4
        ORDER BY position`,
      [me.school_id, leaderboardStart(period), LEADERBOARD_SIZE, me.id],
    )
    const round = (n) => Math.round(Number(n) * 10) / 10
    const top = rows.filter((r) => r.position <= LEADERBOARD_SIZE)
      .map((r) => ({ rank: r.rank, name: leaderboardName(r.name), hours: round(r.hours), isMe: r.id === me.id }))
    const mine = rows.find((r) => r.id === me.id)
    return res.json({
      available: true,
      period,
      schoolName: me.school_name || null,
      optedIn: Boolean(me.leaderboard_opt_in),
      participants: rows[0]?.participants || 0,
      top,
      me: mine ? { rank: mine.rank, hours: round(mine.hours) } : null,
    })
  } catch (error) {
    console.error('leaderboard failed:', error)
    return res.status(500).json({ error: 'Could not load the leaderboard.' })
  }
})

// PUT /api/school/leaderboard/opt-in { optIn }
router.put('/leaderboard/opt-in', limiter, requireDb, requireAuth('student'), async (req, res) => {
  if (typeof req.body?.optIn !== 'boolean') return res.status(400).json({ error: 'optIn must be true or false.' })
  try {
    const me = await leaderboardViewer(req.auth.sub)
    if (!me) return res.status(404).json({ error: 'Account not found.' })
    if (req.body.optIn && (me.under_13 === true || me.parental_consent_status === 'pending')) {
      return res.status(403).json({ error: 'The leaderboard is for students 13 and older.' })
    }
    await query('UPDATE users SET leaderboard_opt_in = $1 WHERE id = $2', [req.body.optIn, me.id])
    return res.json({ optedIn: req.body.optIn })
  } catch (error) {
    console.error('leaderboard opt-in failed:', error)
    return res.status(500).json({ error: 'Could not save that.' })
  }
})

// GET / PATCH /api/school/leaderboard/settings { enabled } — the school's switch.
router.get('/leaderboard/settings', limiter, requireDb, requireAuth('school', 'school_staff'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT s.leaderboard_enabled,
              (SELECT COUNT(*)::int FROM users u WHERE u.school_id = s.id AND u.leaderboard_opt_in AND ${LEADERBOARD_ELIGIBLE_SQL}) AS joined
         FROM users me JOIN schools s ON s.id = me.school_id WHERE me.id = $1`,
      [req.auth.sub],
    )
    if (!rows[0]) return res.status(404).json({ error: 'School not found.' })
    return res.json({ enabled: rows[0].leaderboard_enabled, joined: rows[0].joined })
  } catch (error) {
    console.error('leaderboard settings read failed:', error)
    return res.status(500).json({ error: 'Could not load the setting.' })
  }
})

router.patch('/leaderboard/settings', limiter, requireDb, requireAuth('school'), async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false.' })
  try {
    const schoolId = await callerSchoolId(req.auth.sub)
    if (!schoolId) return res.status(404).json({ error: 'School not found.' })
    await query('UPDATE schools SET leaderboard_enabled = $1 WHERE id = $2', [req.body.enabled, schoolId])
    return res.json({ enabled: req.body.enabled })
  } catch (error) {
    console.error('leaderboard settings update failed:', error)
    return res.status(500).json({ error: 'Could not save the setting.' })
  }
})

// --- New school year: move everyone up a grade (#481) -----------------------
//
// Grades are typed once and go stale every August. A school admin moves the
// whole roster up one grade: K → 1 … 11 → 12, and 12 → "Graduated". Anything
// else (College, Graduated, a school's own label like "Year 12", no grade) is
// left as it is and counted as skipped. The run is kept with every change so
// it can be undone for UNDO_DAYS, and a second run within REPEAT_GUARD_DAYS
// needs `force`, so a double click can't move a class two grades.

const GRADUATED = 'Graduated'
const GRADE_UNDO_DAYS = 14
const GRADE_REPEAT_GUARD_DAYS = 180

// The grade a student moves to, or null when theirs isn't a K–12 grade.
// "Year 12"-style labels are left alone: gradeKey() reads them as 12, but a
// school counting in years (where Year 12 isn't the last) doesn't line up
// with US grades, and moving them on a guess could graduate a whole class.
// A school that set its grades (#581) sends its top grade on: "Moved on" when
// it isn't 12th (a 9th-grade-only school), "Graduated" when it is.
const MOVED_ON = 'Moved on'

function nextGrade(grade, offered = []) {
  if (/\b(year|yr)\b/i.test(String(grade ?? ''))) return null
  const key = gradeKey(grade)
  if (offered.length && key === offered[offered.length - 1]) return key === '12' ? GRADUATED : MOVED_ON
  if (key === 'K') return '1'
  if (key && /^\d{1,2}$/.test(key)) {
    const n = Number(key)
    if (n >= 1 && n <= 11) return String(n + 1)
    if (n === 12) return GRADUATED
  }
  return null
}

async function gradeRolloverPlan(schoolId) {
  const offered = (await policyForSchool(schoolId))?.policy?.goals?.grades || []
  const { rows } = await query(
    "SELECT id, grade FROM users WHERE school_id = $1 AND role = 'student' ORDER BY id",
    [schoolId],
  )
  const changes = []
  let skipped = 0
  for (const r of rows) {
    const to = nextGrade(r.grade, offered)
    if (to) changes.push({ userId: r.id, from: r.grade, to })
    else skipped++
  }
  // Grouped for the preview: "11th Grade → 12th Grade: 48".
  const groups = new Map()
  for (const c of changes) {
    const fromKey = gradeKey(c.from)
    const k = `${fromKey}|${c.to}`
    const g = groups.get(k) || { from: gradeLabel(fromKey) || c.from, to: c.to === GRADUATED ? GRADUATED : gradeLabel(c.to), count: 0, sort: gradeSortValue(fromKey) }
    g.count++
    groups.set(k, g)
  }
  const moves = [...groups.values()].sort((a, b) => a.sort - b.sort).map(({ sort, ...g }) => g)
  return { changes, moves, skipped, students: rows.length }
}

async function callerSchoolId(userId) {
  const { rows } = await query('SELECT school_id FROM users WHERE id = $1', [userId])
  return rows[0]?.school_id || null
}

async function lastGradeRollover(schoolId) {
  const { rows } = await query(
    `SELECT id, run_at, undone_at, jsonb_array_length(changes) AS moved,
            (undone_at IS NULL AND run_at > now() - interval '${GRADE_UNDO_DAYS} days') AS can_undo
       FROM school_grade_rollovers WHERE school_id = $1 ORDER BY run_at DESC LIMIT 1`,
    [schoolId],
  )
  return rows[0] || null
}

// GET /api/school/grade-rollover — the preview, plus the last run.
router.get('/grade-rollover', limiter, requireDb, requireAuth('school'), requirePaidSchool, async (req, res) => {
  try {
    const schoolId = await callerSchoolId(req.auth.sub)
    if (!schoolId) return res.status(404).json({ error: 'School not found.' })
    const plan = await gradeRolloverPlan(schoolId)
    const last = await lastGradeRollover(schoolId)
    return res.json({
      students: plan.students,
      moving: plan.changes.length,
      skipped: plan.skipped,
      moves: plan.moves,
      lastRun: last && { id: last.id, runAt: last.run_at, undoneAt: last.undone_at, moved: last.moved, canUndo: last.can_undo },
      undoDays: GRADE_UNDO_DAYS,
    })
  } catch (error) {
    console.error('grade rollover preview failed:', error)
    return res.status(500).json({ error: 'Could not load the preview.' })
  }
})

// POST /api/school/grade-rollover { force? } — moves everyone up a grade.
router.post('/grade-rollover', limiter, requireDb, requireAuth('school'), requirePaidSchool, async (req, res) => {
  const force = req.body?.force === true
  const client = await getPool().connect()
  try {
    const { rows: me } = await client.query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    const schoolId = me[0]?.school_id
    if (!schoolId) return res.status(404).json({ error: 'School not found.' })

    await client.query('BEGIN')
    // One run at a time per school: the school row is the lock.
    await client.query('SELECT id FROM schools WHERE id = $1 FOR UPDATE', [schoolId])
    const { rows: recent } = await client.query(
      `SELECT run_at FROM school_grade_rollovers
        WHERE school_id = $1 AND undone_at IS NULL AND run_at > now() - interval '${GRADE_REPEAT_GUARD_DAYS} days'
        ORDER BY run_at DESC LIMIT 1`,
      [schoolId],
    )
    if (recent[0] && !force) {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'Grades were already moved up this school year.', lastRunAt: recent[0].run_at })
    }
    const { rows } = await client.query(
      "SELECT id, grade FROM users WHERE school_id = $1 AND role = 'student' ORDER BY id FOR UPDATE",
      [schoolId],
    )
    const changes = []
    for (const r of rows) {
      const to = nextGrade(r.grade)
      if (!to) continue
      await client.query('UPDATE users SET grade = $1 WHERE id = $2', [to, r.id])
      changes.push({ userId: r.id, from: r.grade, to })
    }
    const id = uid('grr')
    await client.query(
      'INSERT INTO school_grade_rollovers (id, school_id, run_by, changes) VALUES ($1, $2, $3, $4)',
      [id, schoolId, req.auth.sub, JSON.stringify(changes)],
    )
    await client.query('COMMIT')
    recordAudit(req, {
      action: AUDIT.GRADES_ADVANCED,
      schoolId,
      objectType: 'school_grade_rollover',
      objectId: id,
      meta: { moved: changes.length, skipped: rows.length - changes.length, forced: force },
    })
    return res.json({ ok: true, id, moved: changes.length, skipped: rows.length - changes.length })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('grade rollover failed:', error)
    return res.status(500).json({ error: 'Could not move grades up.' })
  } finally {
    client.release()
  }
})

// POST /api/school/grade-rollover/:id/undo — puts grades back, but only for
// students whose grade is still what the run set: anyone who has changed
// their grade since keeps their own choice.
router.post('/grade-rollover/:id/undo', limiter, requireDb, requireAuth('school'), requirePaidSchool, async (req, res) => {
  const client = await getPool().connect()
  try {
    const { rows: me } = await client.query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    const schoolId = me[0]?.school_id
    if (!schoolId) return res.status(404).json({ error: 'School not found.' })
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT id, changes, undone_at, run_at > now() - interval '${GRADE_UNDO_DAYS} days' AS recent
         FROM school_grade_rollovers WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [req.params.id, schoolId],
    )
    const run = rows[0]
    if (!run) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'That grade move was not found.' }) }
    if (run.undone_at) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'That grade move was already undone.' }) }
    if (!run.recent) { await client.query('ROLLBACK'); return res.status(410).json({ error: `A grade move can only be undone within ${GRADE_UNDO_DAYS} days.` }) }
    let restored = 0
    for (const c of run.changes) {
      const r = await client.query(
        "UPDATE users SET grade = $1 WHERE id = $2 AND school_id = $3 AND role = 'student' AND grade IS NOT DISTINCT FROM $4",
        [c.from, c.userId, schoolId, c.to],
      )
      restored += r.rowCount
    }
    await client.query('UPDATE school_grade_rollovers SET undone_at = now() WHERE id = $1', [run.id])
    await client.query('COMMIT')
    recordAudit(req, {
      action: AUDIT.GRADES_ADVANCE_UNDONE,
      schoolId,
      objectType: 'school_grade_rollover',
      objectId: run.id,
      meta: { restored, keptOwnChange: run.changes.length - restored },
    })
    return res.json({ ok: true, restored, kept: run.changes.length - restored })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('grade rollover undo failed:', error)
    return res.status(500).json({ error: 'Could not undo the grade move.' })
  } finally {
    client.release()
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

// POST /api/school/invite-class { emails: string[] } (#532). One paste of a
// class list: a student who already has an account gets the normal in-app
// invite (they accept in Settings); anyone else is emailed the school's join
// link. Nobody is linked without accepting, and an address is emailed at
// most once a week per school. Capped per request and per school per day.
const CLASS_INVITE_MAX = 200
const CLASS_INVITE_DAILY = 500
const classInviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many class invites. Please try again later.' },
})

router.post('/invite-class', limiter, classInviteLimiter, requireDb, requireAuth('school', 'school_staff'), requirePaidSchool, async (req, res) => {
  const raw = Array.isArray(req.body?.emails) ? req.body.emails : []
  const emails = [...new Set(raw.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))]
  if (emails.length === 0) return res.status(400).json({ error: 'Add at least one email address.' })
  if (emails.length > CLASS_INVITE_MAX) return res.status(400).json({ error: `Up to ${CLASS_INVITE_MAX} addresses at a time.` })
  const valid = emails.filter((e) => e.length <= 254 && validator.isEmail(e))
  const result = { invited: 0, emailed: 0, alreadyHere: 0, atAnotherSchool: 0, notStudent: 0, recentlyEmailed: 0, invalid: emails.length - valid.length }
  try {
    const { rows: me } = await query(
      `SELECT u.school_id, s.name, s.pin FROM users u JOIN schools s ON s.id = u.school_id WHERE u.id = $1`,
      [req.auth.sub],
    )
    const school = me[0]
    if (!school) return res.status(404).json({ error: 'School not found.' })
    const { rows: today } = await query(
      `SELECT COUNT(*)::int AS n FROM school_email_invites WHERE school_id = $1 AND sent_at > now() - interval '1 day'`,
      [school.school_id],
    )
    let budget = Math.max(0, CLASS_INVITE_DAILY - today[0].n)

    const { rows: accounts } = await query(
      'SELECT id, email, role, school_id FROM users WHERE email = ANY($1)',
      [valid],
    )
    const byEmail = new Map(accounts.map((a) => [a.email.toLowerCase(), a]))
    const site = String(process.env.FRONTEND_URL || 'https://volunteer-track-two.vercel.app').split(',')[0].trim().replace(/\/$/, '')
    const joinLink = `${site}/join/${encodeURIComponent(school.pin)}`

    for (const email of valid) {
      const account = byEmail.get(email)
      if (account) {
        if (account.role !== 'student') { result.notStudent += 1; continue }
        if (account.school_id === school.school_id) { result.alreadyHere += 1; continue }
        if (account.school_id) { result.atAnotherSchool += 1; continue }
        const { rows: invited } = await query(
          `INSERT INTO school_student_invites (id, school_id, user_id, invited_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (school_id, user_id) WHERE status = 'pending' DO NOTHING
           RETURNING id`,
          [uid('sinv'), school.school_id, account.id, req.auth.sub],
        )
        if (invited.length > 0) notifyStudentInvite(school.school_id, account.id)
        result.invited += 1
        continue
      }
      if (budget <= 0) { result.recentlyEmailed += 1; continue }
      // Claimed before sending, and only if not emailed in the last week.
      const { rowCount } = await query(
        `INSERT INTO school_email_invites (school_id, email, invited_by) VALUES ($1, $2, $3)
         ON CONFLICT (school_id, email) DO UPDATE SET sent_at = now(), invited_by = EXCLUDED.invited_by
           WHERE school_email_invites.sent_at < now() - interval '7 days'`,
        [school.school_id, email, req.auth.sub],
      )
      if (rowCount === 0) { result.recentlyEmailed += 1; continue }
      budget -= 1
      result.emailed += 1
      if (/@test\.com$/i.test(email)) continue
      sendEmail({
        to: email,
        subject: `${school.name} invited you to VolunTrack`,
        html: `<p>Hi,</p><p>${escapeHtml(school.name)} uses VolunTrack to keep track of volunteer and service hours, and your adviser invited you to join.</p><p><a href="${joinLink}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#2e7d32;color:#ffffff;text-decoration:none;font-weight:600">Join ${escapeHtml(school.name)}</a></p><p>It's free for students. If the button doesn't work, sign up and enter the school code <strong>${escapeHtml(school.pin)}</strong>. If you weren't expecting this, you can ignore it.</p>${emailFooterHtml()}`,
      }).catch((e) => console.error('class invite email failed:', e.message))
    }
    return res.json({ ok: true, ...result })
  } catch (error) {
    console.error('invite-class failed:', error)
    return res.status(500).json({ error: 'Could not send the invites.' })
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
      const joined = await joinWithSeat(rows[0].school_id, (client) => client.query('UPDATE users SET school_id = $1 WHERE id = $2', [rows[0].school_id, req.auth.sub]))
      if (joined.error) return res.status(409).json({ error: joined.error })
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
    // A free club is for one adviser (#506): one co-adviser at most.
    const { rows: planRows } = await query('SELECT plan FROM schools WHERE id = $1', [schoolId])
    if (planRows[0]?.plan === 'club' && Number(countRows[0].count) >= CLUB_MAX_CO_ADMINS) {
      return res.status(409).json({ error: `A free club can have ${CLUB_MAX_CO_ADMINS} co-adviser. Upgrade to a school plan to add more.` })
    }
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

// Hand the school's main account to a new principal (#550), or promote a
// co-admin to it ({ staffId }). The main admin confirms their password; the new
// person accepts from the emailed link (server/handover.js).
router.post('/handover', limiter, requireDb, requireAuth('school'), async (req, res) => {
  try {
    const { rows: me } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    const schoolId = me[0]?.school_id
    if (!schoolId) return res.status(404).json({ error: 'School not found.' })
    await confirmPassword(req.auth.sub, req.body?.password)
    let { name, email } = req.body || {}
    if (req.body?.staffId) {
      const { rows } = await query(
        `SELECT name, email FROM users WHERE id = $1 AND school_id = $2 AND role = 'school_staff'`,
        [String(req.body.staffId), schoolId],
      )
      if (!rows[0]) return res.status(404).json({ error: 'Co-admin not found.' })
      ;({ name, email } = rows[0])
    }
    return res.json(await createHandoverInvite(req, { kind: 'school', targetId: schoolId, name, email }))
  } catch (error) {
    return sendHandoverError(res, error, 'Could not send the handover invite.')
  }
})

// ---------------------------------------------------------------------------
// Private adviser notes on a student (#567): school admins and co-admins only,
// for students at their own school, never shown to the student, a parent or
// another school. Reading them is audited like any student record.
// ---------------------------------------------------------------------------

const NOTE_MAX = 1000

async function noteAuthor(req) {
  const { rows } = await query('SELECT school_id, name FROM users WHERE id = $1', [req.auth.sub])
  return rows[0] || null
}

router.get('/student-notes/counts', limiter, requireDb, requireAuth('school', 'school_staff'), async (req, res) => {
  try {
    const me = await noteAuthor(req)
    if (!me?.school_id) return res.status(404).json({ error: 'School not found.' })
    const { rows } = await query(
      'SELECT student_id, COUNT(*)::int AS n FROM student_notes WHERE school_id = $1 GROUP BY student_id',
      [me.school_id],
    )
    return res.json({ counts: Object.fromEntries(rows.map((r) => [r.student_id, r.n])) })
  } catch (error) {
    console.error('student note counts failed:', error)
    return res.status(500).json({ error: 'Could not load notes.' })
  }
})

router.get('/students/:id/notes', limiter, requireDb, requireAuth('school', 'school_staff'), async (req, res) => {
  try {
    const me = await noteAuthor(req)
    if (!me?.school_id) return res.status(404).json({ error: 'School not found.' })
    const { rows: st } = await query(`SELECT 1 FROM users WHERE id = $1 AND school_id = $2 AND role = 'student'`, [req.params.id, me.school_id])
    if (!st[0]) return res.status(404).json({ error: 'Student not found.' })
    const { rows } = await query(
      `SELECT id, author_id, author_name, body, created_at FROM student_notes
        WHERE school_id = $1 AND student_id = $2 ORDER BY created_at DESC LIMIT 200`,
      [me.school_id, req.params.id],
    )
    recordAudit(req, { action: AUDIT.STUDENT_NOTES_READ, subjectUserId: req.params.id, schoolId: me.school_id, objectType: 'student_notes', meta: { count: rows.length } })
    return res.json({
      notes: rows.map((n) => ({
        id: n.id, body: n.body, authorName: n.author_name || 'An adviser', createdAt: n.created_at,
        mine: n.author_id === req.auth.sub,
      })),
    })
  } catch (error) {
    console.error('student notes read failed:', error)
    return res.status(500).json({ error: 'Could not load notes.' })
  }
})

router.post('/students/:id/notes', limiter, requireDb, requireAuth('school', 'school_staff'), async (req, res) => {
  const body = String(req.body?.body || '').trim()
  if (!body) return res.status(400).json({ error: 'Write a note first.' })
  if (body.length > NOTE_MAX) return res.status(400).json({ error: `Notes can be up to ${NOTE_MAX} characters.` })
  try {
    const me = await noteAuthor(req)
    if (!me?.school_id) return res.status(404).json({ error: 'School not found.' })
    const { rows: st } = await query(`SELECT 1 FROM users WHERE id = $1 AND school_id = $2 AND role = 'student'`, [req.params.id, me.school_id])
    if (!st[0]) return res.status(404).json({ error: 'Student not found.' })
    const id = uid('note')
    const { rows } = await query(
      `INSERT INTO student_notes (id, school_id, student_id, author_id, author_name, body)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING created_at`,
      [id, me.school_id, req.params.id, req.auth.sub, me.name, body],
    )
    recordAudit(req, { action: AUDIT.STUDENT_NOTE_ADDED, subjectUserId: req.params.id, schoolId: me.school_id, objectType: 'student_note', objectId: id })
    return res.status(201).json({ note: { id, body, authorName: me.name, createdAt: rows[0].created_at, mine: true } })
  } catch (error) {
    console.error('student note add failed:', error)
    return res.status(500).json({ error: 'Could not save the note.' })
  }
})

// The note's author can delete it, and so can the school's main admin.
router.delete('/student-notes/:noteId', limiter, requireDb, requireAuth('school', 'school_staff'), async (req, res) => {
  try {
    const me = await noteAuthor(req)
    if (!me?.school_id) return res.status(404).json({ error: 'School not found.' })
    const { rows } = await query(
      `DELETE FROM student_notes WHERE id = $1 AND school_id = $2 AND (author_id = $3 OR $4)
       RETURNING student_id`,
      [req.params.noteId, me.school_id, req.auth.sub, req.auth.role === 'school'],
    )
    if (!rows[0]) return res.status(404).json({ error: 'Note not found.' })
    recordAudit(req, { action: AUDIT.STUDENT_NOTE_DELETED, subjectUserId: rows[0].student_id, schoolId: me.school_id, objectType: 'student_note', objectId: req.params.noteId })
    return res.json({ ok: true })
  } catch (error) {
    console.error('student note delete failed:', error)
    return res.status(500).json({ error: 'Could not delete the note.' })
  }
})

// PATCH /api/school/students/:id/grade { grade | null } — an adviser sets or
// corrects a student's grade (#581), from the school's own grades if it set any.
router.patch('/students/:id/grade', limiter, requireDb, requireAuth('school', 'school_staff'), async (req, res) => {
  try {
    const { rows: me } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    const schoolId = me[0]?.school_id
    if (!schoolId) return res.status(404).json({ error: 'School not found.' })
    const raw = req.body?.grade
    const grade = raw === null || raw === '' ? null : gradeKey(String(raw).slice(0, 20))
    const resolved = await policyForSchool(schoolId)
    if (grade && !schoolGrades(resolved?.policy).includes(grade)) {
      return res.status(400).json({ error: 'Pick one of your school’s grades.' })
    }
    const { rowCount } = await query(
      `UPDATE users SET grade = $1 WHERE id = $2 AND school_id = $3 AND role = 'student'`,
      [grade, req.params.id, schoolId],
    )
    if (rowCount === 0) return res.status(404).json({ error: 'Student not found.' })
    recordAudit(req, { action: AUDIT.STUDENT_GRADE_SET, subjectUserId: req.params.id, schoolId, objectType: 'user', objectId: req.params.id, meta: { grade } })
    return res.json({ ok: true, grade })
  } catch (error) {
    console.error('student grade set failed:', error)
    return res.status(500).json({ error: 'Could not save the grade.' })
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
const REVIEW_NOTE_MAX = 500

// The student hears back on a report they sent (#583): a bell notice, and an
// email unless the address is a test one. Fire-and-forget, like notify(): a
// mail server having a bad day must not fail the school's review.
async function tellStudentReportReviewed({ userId, schoolId, status, notes, sentAt }) {
  try {
    const { rows } = await query(
      'SELECT u.email, u.name, u.language, s.name AS school_name FROM users u JOIN schools s ON s.id = $2 WHERE u.id = $1',
      [userId, schoolId],
    )
    const r = rows[0]
    if (!r) return
    const lang = emailLang(r.language)
    const approved = status === 'approved'
    const when = sentAt ? emailDate(lang, new Date(sentAt)) : ''
    const title = approved
      ? et(lang, '{school} approved your report', { school: r.school_name })
      : et(lang, '{school} sent back your report', { school: r.school_name })
    const body = notes
      ? (approved ? notes : et(lang, 'Reason: {reason}', { reason: notes }))
      : et(lang, 'The report you sent on {date}.', { date: when })
    await notify(userId, { kind: approved ? 'report_approved' : 'report_rejected', title, body, link: '/reports' })
    if (!r.email || /@test\.com$/i.test(r.email)) return
    const site = frontendBase()
    await sendEmail({
      to: r.email,
      subject: title,
      html: `
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(emailHi(lang, r.name))}</p>
        <p>${escapeHtml(et(lang, 'The report you sent on {date}.', { date: when }))}</p>
        ${notes ? `<p><strong>${escapeHtml(et(lang, approved ? 'Note from your school:' : 'Why:'))}</strong> ${escapeHtml(notes)}</p>` : ''}
        ${approved ? '' : `<p>${escapeHtml(et(lang, 'Fix what they asked for, then send a new report from Reports.'))}</p>`}
        <p><a href="${escapeHtml(site)}/reports">${escapeHtml(et(lang, 'Open Reports'))}</a></p>
        ${emailFooterHtml()}
      `,
    })
  } catch (error) {
    console.error('report review notice failed:', error.message)
  }
}

router.patch('/pdf/:id/review', limiter, requireDb, requireAuth('school', 'school_staff'), requirePaidSchool, async (req, res) => {
  const { status } = req.body
  if (!status || !['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Status must be approved or rejected.' })
  if (req.body.notes != null && typeof req.body.notes !== 'string') return res.status(400).json({ error: 'The note must be text.' })
  const notes = String(req.body.notes || '').trim().slice(0, REVIEW_NOTE_MAX) || null
  // A rejection the student can't act on helps no one (#583).
  if (status === 'rejected' && !notes) return res.status(400).json({ error: 'Say why, so the student can fix it.' })

  try {
    const { rows: userRows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    const { rows } = await query('SELECT * FROM pdf_uploads WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'PDF not found.' })
    if (rows[0].school_id !== userRows[0]?.school_id) return res.status(403).json({ error: 'Not your school.' })
    const { rows: studentRows } = await query('SELECT school_id FROM users WHERE id = $1', [rows[0].user_id])
    if (studentRows[0]?.school_id !== rows[0].school_id) return res.status(403).json({ error: 'This student is no longer at your school.' })

    await query(
      'UPDATE pdf_uploads SET status = $1, notes = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $4',
      [status, notes, req.auth.sub, req.params.id],
    )
    // Only a change tells the student anything: re-saving the same decision
    // (a double click) must not ring the bell twice.
    if (rows[0].status !== status || (rows[0].notes || null) !== notes) {
      tellStudentReportReviewed({ userId: rows[0].user_id, schoolId: rows[0].school_id, status, notes, sentAt: rows[0].created_at })
    }
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
    const cols = 'id, name, pin, plan, payment_status, payment_notes, paid_at, payment_due_date'
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
    // The grades a school has (#581) are public: sign-up pages show them.
    const ownGrades = (await policyForSchool(school.id))?.policy?.goals?.grades || []
    if (!privileged) return res.json({ school: { id: school.id, name: school.name, grades: ownGrades } })

    let studentCount = null
    if (school.plan === 'club') {
      studentCount = await clubStudentCount(school.id)
    }
    return res.json({ school: { id: school.id, name: school.name, grades: ownGrades, pin: school.pin, plan: school.plan, studentCount, studentLimit: school.plan === 'club' ? CLUB_STUDENT_LIMIT : null, paymentStatus: school.payment_status, paymentNotes: school.payment_notes, paidAt: school.paid_at, paymentDueDate: school.payment_due_date } })
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
export const TASK_CATEGORIES = [
  'Community Service', 'Environmental', 'Education & Tutoring', 'Health & Wellness', 'Animal Welfare',
  'Arts & Culture', 'Sports & Coaching', 'Religious & Faith', 'Political & Advocacy', 'Disaster Relief', 'Other',
]
const taskCategory = (v) => (v == null || v === '' ? { ok: true, value: null }
  : TASK_CATEGORIES.includes(v) ? { ok: true, value: v } : { ok: false })

// Task details (#426). Each reader takes the raw body value and answers
// { ok, value } or { ok: false, error }; `undefined` means "not sent", which
// create treats as the default and PATCH leaves alone.
//
// Minimum age: a whole number 5–21, or none. VolunTrack keeps no date of
// birth (ageRules.js), so sign-up asks the student to confirm it — see
// POST /public-tasks/:id/signup.
const taskMinAge = (v) => {
  if (v == null || v === '') return { ok: true, value: null }
  const n = Number(v)
  return (typeof v === 'number' || typeof v === 'string') && Number.isInteger(n) && n >= 5 && n <= 21
    ? { ok: true, value: n } : { ok: false, error: 'Minimum age must be a whole number from 5 to 21.' }
}
const taskOnline = (v) => (v == null ? { ok: true, value: false }
  : typeof v === 'boolean' ? { ok: true, value: v } : { ok: false, error: 'Online must be true or false.' })
// Outdoor (#435): shows a forecast chip on the task card.
const taskOutdoor = (v) => (v == null ? { ok: true, value: false }
  : typeof v === 'boolean' ? { ok: true, value: v } : { ok: false, error: 'Outdoor must be true or false.' })
const WHEELCHAIR = ['yes', 'no', 'unknown']
const taskWheelchair = (v) => (v == null || v === '' ? { ok: true, value: 'unknown' }
  : WHEELCHAIR.includes(v) ? { ok: true, value: v } : { ok: false, error: 'Wheelchair accessible must be yes, no or unknown.' })
const taskAccessNote = (v) => {
  if (v == null) return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false, error: 'Accessibility note must be text.' }
  const text = v.trim()
  return text.length > 200 ? { ok: false, error: 'Accessibility note must be at most 200 characters.' } : { ok: true, value: text || null }
}
// Day-of details (#438): where to meet and who to call on the day. Both are
// optional and only ever reach the organizer and approved volunteers — never
// the public list for anyone else. The contact is one line ("Sam, 555-0100"),
// so the light check is just that it holds a phone-length run of digits.
const MEETING_POINT_MAX = 200
const DAY_OF_CONTACT_MAX = 100
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const taskMeetingPoint = (v) => {
  if (v == null) return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false, error: 'Meeting point must be text.' }
  const text = v.trim()
  if (text.length > MEETING_POINT_MAX) return { ok: false, error: `Meeting point must be at most ${MEETING_POINT_MAX} characters.` }
  if (CONTROL_CHARS.test(text)) return { ok: false, error: 'Meeting point must be one line of text.' }
  return { ok: true, value: text || null }
}
const taskDayOfContact = (v) => {
  if (v == null) return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false, error: 'Day-of contact must be text.' }
  const text = v.trim()
  if (!text) return { ok: true, value: null }
  if (text.length > DAY_OF_CONTACT_MAX) return { ok: false, error: `Day-of contact must be at most ${DAY_OF_CONTACT_MAX} characters.` }
  if (CONTROL_CHARS.test(text)) return { ok: false, error: 'Day-of contact must be one line of text.' }
  if ((text.match(/\d/g) || []).length < 7) return { ok: false, error: 'Add a phone number to the day-of contact, like "Sam, 555-010-0100".' }
  return { ok: true, value: text }
}

// An online task with no address is stored as "Online", so every place that
// prints a location (emails, Attendance, reports, the sign-in sheet) still
// reads sensibly without knowing about online tasks.
const ONLINE_LOCATION = 'Online'

// A student who registered as under 13 (users.under_13) was younger than 13
// on users.created_at, so today they are younger than 13 + the years since.
// When that can't yet reach the task's minimum age, they are certainly too
// young: refused at sign-up and flagged in the list. Everyone else confirms.
const PROVABLY_TOO_YOUNG_SQL = (taskAlias, userIdParam) => `(${taskAlias}.min_age IS NOT NULL AND EXISTS (
  SELECT 1 FROM users ay WHERE ay.id = ${userIdParam} AND ay.under_13 IS TRUE
     AND ay.created_at > now() - make_interval(years => ${taskAlias}.min_age - 13)))`

router.post('/public-tasks', limiter, requireDb, requireAuth(), async (req, res) => {
  const { title, description, date, time, slotsTotal, phone, latitude, longitude, importantInfo } = req.body
  let { location } = req.body
  const category = taskCategory(req.body.category)
  if (!category.ok) return res.status(400).json({ error: 'Pick a category from the list.' })
  const lat = coordinate(latitude, 90)
  const lng = coordinate(longitude, 180)
  if (!lat.ok || !lng.ok) return res.status(400).json({ error: 'Invalid map position.' })
  const details = [taskMinAge(req.body.minAge), taskOnline(req.body.isOnline), taskWheelchair(req.body.wheelchairAccessible), taskAccessNote(req.body.accessibilityNote), taskOutdoor(req.body.isOutdoor),
    taskMeetingPoint(req.body.meetingPoint), taskDayOfContact(req.body.dayOfContact)]
  const badDetail = details.find((d) => !d.ok)
  if (badDetail) return res.status(400).json({ error: badDetail.error })
  const [minAge, isOnline, wheelchair, accessNote, isOutdoor, meetingPoint, dayOfContact] = details.map((d) => d.value)
  // Group sign-ups (#439): off unless the organizer ticks it.
  if (req.body.allowGuests != null && typeof req.body.allowGuests !== 'boolean') {
    return res.status(400).json({ error: 'Allow guests must be true or false.' })
  }
  const allowGuests = req.body.allowGuests === true
  // Online: the address is optional and there is no map pin.
  if (isOnline) {
    if (location != null && typeof location !== 'string') return res.status(400).json({ error: 'Location must be text.' })
    location = String(location || '').trim() || ONLINE_LOCATION
    lat.value = null
    lng.value = null
  }
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
    const { rows } = await query(
      `SELECT u.name, u.email, u.posting_suspended_at, o.id AS org_id, o.name AS org_name
         FROM users u LEFT JOIN organizations o ON o.id = u.organization_id AND u.role = 'org'
        WHERE u.id = $1`,
      [req.auth.sub],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' })
    // Suspended by the admin after a report (server/routes/reports.js).
    if (rows[0].posting_suspended_at) {
      return res.status(403).json({ error: "Your account can't post volunteer tasks right now. Contact us if you think this is a mistake." })
    }
    // An organization posts for its schools (#565), under its own name.
    const orgId = rows[0].org_id || null
    const creatorName = rows[0].org_name || rows[0].name

    // Every week of a repeat goes in together or not at all, so a failure
    // can't leave the organizer with half a series to find and fix.
    const created = []
    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      for (const day of dates) {
        const id = uid('ptask')
        await client.query(
          `INSERT INTO public_tasks (id, title, description, location, date, time, slots_total, created_by, creator_name, creator_email, phone, latitude, longitude, important_info, category,
                                    min_age, is_online, wheelchair_accessible, accessibility_note, is_outdoor, meeting_point, day_of_contact, allow_guests, organization_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
          [id, title, description, location, day, time || null, Number(slotsTotal) || 1, req.auth.sub, creatorName, rows[0].email, phone, lat.value, lng.value, importantInfo || null, category.value,
            minAge, isOnline, wheelchair, accessNote, isOutdoor, meetingPoint, dayOfContact, allowGuests, orgId],
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
    if (orgId) notifyOrgSchools(orgId, created[0].id)
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
      ? `CASE WHEN NOT t.is_online AND t.latitude IS NOT NULL AND t.longitude IS NOT NULL THEN
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
    // excluded from a radius-filtered result — except online tasks, which
    // have no place and are near everyone.
    const filterByRadius = useDist && maxDistance && !isNaN(maxDistance)
    const where = []
    if (filterByRadius) where.push(`(sub.is_online OR (sub.distance IS NOT NULL AND sub.distance <= $${selectParams.length + 1}))`)
    // Optional detail filters (#426): ?online=1, ?wheelchair=1.
    if (req.query.online === '1') where.push('sub.is_online')
    if (req.query.wheelchair === '1') where.push(`sub.wheelchair_accessible = 'yes'`)
    const filterClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const filterParams = filterByRadius ? [maxDistance] : []

    const { rows } = await query(
      `SELECT * FROM (
        SELECT t.id, t.title, t.description, t.location, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.slots_total, t.status, t.category,
               t.creator_name, t.latitude, t.longitude, ${distExpr}, t.created_at,
               t.min_age, t.is_online, t.wheelchair_accessible, t.accessibility_note, t.is_outdoor, t.cover_photo_id,
               ${userId ? PROVABLY_TOO_YOUNG_SQL('t', '$1') : 'false'} AS my_too_young,
               ${userId ? `COALESCE(t.organization_id IS NOT NULL AND t.organization_id = (SELECT s.organization_id FROM users mu JOIN schools s ON s.id = mu.school_id WHERE mu.id = $1), false)` : 'false'} AS for_my_schools,
               ${SPOTS_USED_SQL('t.id')} AS slots_filled,
               (SELECT COUNT(*) FROM public_task_signups WHERE task_id = t.id AND status = 'waitlisted') AS waitlist_count,
               ${userId ? `(SELECT status FROM public_task_signups WHERE task_id = t.id AND user_id = $1) AS my_signup_status` : 'NULL AS my_signup_status'},
               ${userId ? `${WAITLIST_POSITION_SQL('t.id', '$1')} AS my_waitlist_position` : 'NULL AS my_waitlist_position'},
               t.allow_guests,
               ${userId ? `(SELECT guest_count FROM public_task_signups WHERE task_id = t.id AND user_id = $1) AS my_guest_count` : 'NULL AS my_guest_count'},
               ${userId ? `(SELECT guest_names FROM public_task_signups WHERE task_id = t.id AND user_id = $1) AS my_guest_names` : 'NULL AS my_guest_names'},
               ${userId ? `CASE WHEN (SELECT status FROM public_task_signups WHERE task_id = t.id AND user_id = $1) = 'approved' THEN t.phone ELSE NULL END AS phone` : 'NULL AS phone'},
               ${userId ? `CASE WHEN (SELECT status FROM public_task_signups WHERE task_id = t.id AND user_id = $1) = 'approved' THEN t.important_info ELSE NULL END AS important_info` : 'NULL AS important_info'},
               -- Day-of details (#438): approved volunteers and the organizer only.
               ${userId ? `CASE WHEN t.created_by = $1 OR (SELECT status FROM public_task_signups WHERE task_id = t.id AND user_id = $1) = 'approved' THEN t.meeting_point END AS meeting_point` : 'NULL AS meeting_point'},
               ${userId ? `CASE WHEN t.created_by = $1 OR (SELECT status FROM public_task_signups WHERE task_id = t.id AND user_id = $1) = 'approved' THEN t.day_of_contact END AS day_of_contact` : 'NULL AS day_of_contact'},
               t.created_by AS organizer_id,
               -- Ask the organizer: what this viewer would see under "Questions".
               (SELECT COUNT(*)::int FROM task_questions q WHERE q.task_id = t.id AND NOT q.hidden
                  AND (q.answer IS NOT NULL ${userId ? 'OR q.asker_id = $1' : ''})) AS question_count,
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

// Unfollow from a "new task" email without signing in. The token is the
// account's digest_unsub_token (see ensureDigestUnsubToken). GET only asks:
// mail scanners open links, and an unfollow must take a click. POST unfollows,
// which is also what Gmail's one-click "Unsubscribe" sends (RFC 8058).
function followUnsubPage(bodyHtml) {
  const style = 'font-family:system-ui,-apple-system,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5'
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>VolunTrack</title><body style="${style}">${bodyHtml}</body></html>`
}

async function followUnsubLookup(token, organizerId) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null
  const { rows } = await query(
    `SELECT u.id AS user_id, o.name AS organizer_name,
            EXISTS (SELECT 1 FROM organizer_follows f WHERE f.user_id = u.id AND f.organizer_id = o.id) AS following
       FROM users u, users o
      WHERE u.digest_unsub_token = $1 AND o.id = $2`,
    [token, organizerId],
  )
  return rows[0] || null
}

router.get('/follows/unsubscribe/:token/:organizerId', limiter, requireDb, async (req, res) => {
  try {
    const row = await followUnsubLookup(req.params.token, String(req.params.organizerId))
    res.type('html')
    if (!row) return res.status(400).send(followUnsubPage('<p>This link is not valid.</p>'))
    const who = escapeHtml(row.organizer_name || 'this organizer')
    if (!row.following) return res.send(followUnsubPage(`<p>You're not following ${who}, so you won't get emails about their new tasks.</p>`))
    return res.send(followUnsubPage(`<p>Stop emails about new tasks from ${who}? This unfollows them on VolunTrack.</p><form method="post"><button type="submit" style="font-size:1rem;padding:0.5rem 1rem">Stop these emails</button></form><p style="font-size:0.875rem;color:#666">You can follow them again from Opportunities.</p>`))
  } catch (error) {
    console.error('follow unsubscribe page failed:', error)
    return res.status(500).type('html').send(followUnsubPage('<p>Something went wrong. Please try again.</p>'))
  }
})

router.post('/follows/unsubscribe/:token/:organizerId', limiter, requireDb, async (req, res) => {
  try {
    const row = await followUnsubLookup(req.params.token, String(req.params.organizerId))
    res.type('html')
    if (!row) return res.status(400).send(followUnsubPage('<p>This link is not valid.</p>'))
    await query('DELETE FROM organizer_follows WHERE user_id = $1 AND organizer_id = $2', [row.user_id, String(req.params.organizerId)])
    return res.send(followUnsubPage(`<p>Done. You won't get emails about new tasks from ${escapeHtml(row.organizer_name || 'this organizer')}.</p><p style="font-size:0.875rem;color:#666">You can follow them again from Opportunities.</p>`))
  } catch (error) {
    console.error('follow unsubscribe failed:', error)
    return res.status(500).type('html').send(followUnsubPage('<p>Something went wrong. Please try again.</p>'))
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

// --- After-event nudges (#474) ----------------------------------------------
// Hours from a task land in the volunteer's log only when the organizer logs
// them (My Tasks) or the volunteer checks out by QR. Nothing reminded anyone
// otherwise, so volunteers quietly lost credit. Daily, from
// .github/workflows/attendance-nudges.yml:
//   - 1–3 days after an event, the organizer is asked once to mark who came;
//   - 3–7 days after, each volunteer still without hours for it is told once
//     they can log the hours themselves (the organizer can still confirm).
// The windows are ranges so a missed cron day still catches up;
// public_task_attendance_nudges keeps each send to once per task.

// An approved volunteer with no hours logged for the task and not marked
// absent or excused: someone the event may still owe credit to.
const AWAITING_HOURS_SQL = `s.status = 'approved'
  AND COALESCE(s.attendance_status, '') NOT IN ('absent', 'excused')
  AND NOT EXISTS (SELECT 1 FROM logs l WHERE l.user_id = s.user_id AND l.task_id = s.task_id)`

router.post('/public-tasks/internal/run-attendance-nudges', cronLimiter(), requireCronKey, requireDb, async (req, res) => {
  const dryRun = req.body?.dryRun === true
  const results = { organizers: [], volunteers: [], dryRun, emailConfigured: hasEmail() }
  try {
    // 1. Organizers, the day after (up to 3 days, to survive a missed run).
    const { rows: forOrganizers } = await query(
      `SELECT t.id, t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location, t.creator_name,
              u.id AS organizer_id, u.email AS organizer_email, u.name AS organizer_name, u.language AS organizer_language,
              (SELECT COUNT(*)::int FROM public_task_signups s WHERE s.task_id = t.id AND ${AWAITING_HOURS_SQL}) AS awaiting
         FROM public_tasks t JOIN users u ON u.id = t.created_by
        WHERE t.status <> 'cancelled'
          AND t.date BETWEEN current_date - 3 AND current_date - 1
          AND NOT EXISTS (SELECT 1 FROM public_task_attendance_nudges n WHERE n.task_id = t.id AND n.organizer_sent_at IS NOT NULL)`,
    )
    for (const t of forOrganizers) {
      if (t.awaiting === 0) continue
      results.organizers.push({ task: t.title, awaiting: t.awaiting })
      if (dryRun) continue
      // Claimed before sending: two overlapping runs can't both mail it.
      const claim = await query(
        `INSERT INTO public_task_attendance_nudges (task_id, organizer_sent_at) VALUES ($1, now())
         ON CONFLICT (task_id) DO UPDATE SET organizer_sent_at = now()
           WHERE public_task_attendance_nudges.organizer_sent_at IS NULL`,
        [t.id],
      )
      if (claim.rowCount === 0) continue
      const lang = emailLang(t.organizer_language)
      notify(t.organizer_id, {
        kind: 'attendance_nudge',
        title: t.title,
        body: et(lang, t.awaiting === 1 ? '1 volunteer has no hours logged yet. Mark who came.' : '{n} volunteers have no hours logged yet. Mark who came.', { n: t.awaiting }),
        link: '/my-tasks',
      })
      if (!t.organizer_email || t.organizer_email.endsWith('@test.com')) continue
      await sendEmail({
        to: t.organizer_email,
        subject: et(lang, 'Who came to {title}?', { title: t.title }),
        html: taskEmailHtml({
          lang,
          heading: et(lang, 'Who came to {title}?', { title: t.title }),
          lines: [
            emailHi(lang, t.organizer_name),
            et(lang, t.awaiting === 1
              ? '1 volunteer who signed up has no hours logged for this event yet.'
              : '{n} volunteers who signed up have no hours logged for this event yet.', { n: t.awaiting }),
            et(lang, 'Mark who came and log their hours on My Tasks, so their time counts toward their goals.'),
          ],
          task: t,
          link: `${frontendBase()}/my-tasks`,
          linkLabel: et(lang, 'Mark attendance'),
        }),
      }).catch((error) => console.error('attendance nudge email failed:', error))
    }

    // 2. Volunteers, 3 days after (up to 7), if still nothing was logged.
    const { rows: forVolunteers } = await query(
      `SELECT t.id, t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location, t.creator_name
         FROM public_tasks t
        WHERE t.status <> 'cancelled'
          AND t.date BETWEEN current_date - 7 AND current_date - 3
          AND NOT EXISTS (SELECT 1 FROM public_task_attendance_nudges n WHERE n.task_id = t.id AND n.volunteers_sent_at IS NOT NULL)`,
    )
    for (const t of forVolunteers) {
      const { rows: people } = await query(
        `SELECT u.id, u.email, u.name, u.language FROM public_task_signups s JOIN users u ON u.id = s.user_id
          WHERE s.task_id = $1 AND ${AWAITING_HOURS_SQL}
            AND (u.parental_consent_status IS NULL OR u.parental_consent_status <> 'pending')`,
        [t.id],
      )
      if (people.length > 0) results.volunteers.push({ task: t.title, recipients: people.length })
      if (dryRun) continue
      const claim = await query(
        `INSERT INTO public_task_attendance_nudges (task_id, volunteers_sent_at) VALUES ($1, now())
         ON CONFLICT (task_id) DO UPDATE SET volunteers_sent_at = now()
           WHERE public_task_attendance_nudges.volunteers_sent_at IS NULL`,
        [t.id],
      )
      if (claim.rowCount === 0) continue
      for (const p of people) {
        const lang = emailLang(p.language)
        notify(p.id, {
          kind: 'log_hours_nudge',
          title: t.title,
          body: et(lang, 'No hours are logged for this yet. If you went, log them so they count.'),
          link: `/log?task=${encodeURIComponent(t.id)}`,
        })
        if (!p.email || p.email.endsWith('@test.com')) continue
        await sendEmail({
          to: p.email,
          subject: et(lang, 'Did you volunteer at {title}?', { title: t.title }),
          html: taskEmailHtml({
            lang,
            heading: et(lang, 'Did you volunteer at {title}?', { title: t.title }),
            lines: [
              emailHi(lang, p.name),
              et(lang, 'No hours are logged for this event on your account yet.'),
              et(lang, "If you were there, log your hours so they count. The organizer can still confirm them. If you didn't go, you can ignore this."),
            ],
            task: t,
            link: `${frontendBase()}/log?task=${encodeURIComponent(t.id)}`,
            linkLabel: et(lang, 'Log my hours'),
          }),
        }).catch((error) => console.error('log hours nudge email failed:', error))
      }
    }
    return res.json({ ok: true, ...results })
  } catch (error) {
    console.error('attendance nudges failed:', error)
    return res.status(500).json({ error: 'Attendance nudges failed.' })
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
              t.min_age, t.is_online, t.wheelchair_accessible, t.accessibility_note, t.is_outdoor, t.cover_photo_id,
              ${PROVABLY_TOO_YOUNG_SQL('t', '$1')} AS my_too_young,
              ${SPOTS_USED_SQL('t.id')} AS slots_filled,
              (SELECT COUNT(*) FROM public_task_signups WHERE task_id = t.id AND status = 'waitlisted') AS waitlist_count,
              my.status AS my_signup_status,
              ${WAITLIST_POSITION_SQL('t.id', '$1')} AS my_waitlist_position,
              t.allow_guests, my.guest_count AS my_guest_count, my.guest_names AS my_guest_names,
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
          OR (t.slots_total > 0 AND ${SPOTS_USED_SQL('t.id')} >= 0.8 * t.slots_total))`
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
            ${SPOTS_USED_SQL('t.id')} AS filled`,
  )
  for (const r of rows) {
    const when = friendlyWhen(r.date, r.time)
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
// Every student at an organization's schools hears about an event it posted
// for them (#565): a bell entry each, no email, so a district-wide post can't
// flood inboxes. Same skips as the follower bell.
async function notifyOrgSchools(orgId, taskId) {
  try {
    const { rows: taskRows } = await query(
      `SELECT title, to_char(date, 'YYYY-MM-DD') AS date, time, creator_name FROM public_tasks WHERE id = $1 AND status = 'open'`,
      [taskId],
    )
    const task = taskRows[0]
    if (!task) return
    const { rows: students } = await query(
      `SELECT u.id FROM users u JOIN schools s ON s.id = u.school_id
        WHERE s.organization_id = $1 AND u.role = 'student'
          AND (u.parental_consent_status IS NULL OR u.parental_consent_status <> 'pending')
        LIMIT 20000`,
      [orgId],
    )
    const when = friendlyWhen(task.date, task.time)
    for (const st of students) {
      await notify(st.id, {
        kind: 'new_task',
        title: task.title,
        body: `${task.creator_name || 'Your organization'} posted this for your school${when ? ` · ${when}` : ''}`,
        link: `/opportunities?task=${encodeURIComponent(taskId)}`,
      })
    }
  } catch (error) {
    console.error('org event notification failed:', error.message)
  }
}

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
    const when = friendlyWhen(task.date, task.time)
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
        RETURNING u.id, u.email, u.name, u.language`,
      [organizerId],
    )
    const seen = new Set()
    for (const r of rows) {
      const email = String(r.email).trim().toLowerCase()
      if (!email || seen.has(email)) continue
      seen.add(email)
      const lang = emailLang(r.language)
      const subject = et(lang, 'New task from {name}: {title}', { name: task.creator_name || et(lang, 'an organizer'), title: task.title })
      if (email.endsWith('@test.com')) {
        console.log(`[follow] skipped @test.com fixture ${email}: ${subject}`)
        continue
      }
      // One token per account (shared with the digest and comeback emails);
      // the organizer goes in the path, so this link stops only this organizer.
      const unsubscribeUrl = `${emailApiBase()}/api/school/follows/unsubscribe/${await ensureDigestUnsubToken(r.id)}/${encodeURIComponent(organizerId)}`
      await sendEmail({
        to: email,
        subject,
        unsubscribeUrl,
        html: taskEmailHtml({
          lang,
          heading: et(lang, 'A new volunteer task'),
          lines: [
            emailHi(lang, r.name),
            et(lang, '{name} just posted a new task.', { name: task.creator_name || et(lang, 'An organizer you follow') }),
            et(lang, 'You get these because you follow this organizer.'),
          ],
          task,
          link: taskPageLink(taskId),
          linkLabel: et(lang, 'View task and sign up'),
          unsubscribe: { href: unsubscribeUrl, label: et(lang, 'Stop emails from {name}', { name: task.creator_name || et(lang, 'this organizer') }) },
        }),
      })
    }
  } catch (error) {
    console.error('follower notification failed:', error)
  }
}

// Shown when a calendar link points at a task that was cancelled or removed.
function taskGonePage() {
  const style = 'font-family:system-ui,-apple-system,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5'
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>VolunTrack</title><body style="${style}"><h1 style="font-size:1.4rem">This task is no longer available</h1><p>The organizer may have cancelled or removed it, so there is nothing to add to your calendar.</p><p><a href="${escapeHtml(frontendBase())}/opportunities">Find another task on VolunTrack</a></p></body></html>`
}

// Add to calendar: a task as an .ics file, which phones and calendar apps
// open as "add this event". Public, like the task list: no sign-in, and only
// for a task the list would show. The event rules (two hours, or all day
// without a time; floating times) live in ../ics.js, shared with the feed.
router.get('/public-tasks/:id/calendar.ics', limiter, requireDb, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT t.id, t.title, t.description, t.location, to_char(t.date, 'YYYY-MM-DD') AS date, t.time,
              t.creator_name, t.latitude, t.longitude, t.is_online
         FROM public_tasks t
        WHERE t.id = $1 AND t.status <> 'cancelled'
          AND NOT EXISTS (SELECT 1 FROM users cu WHERE cu.id = t.created_by AND cu.posting_suspended_at IS NOT NULL)`,
      [req.params.id],
    )
    const t = rows[0]
    // People reach this from an email link, so a gone task gets a page, not JSON.
    if (!t) return res.status(404).type('html').send(taskGonePage())
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
const dayOfLines = (t) => [t.meeting_point && `Meeting point: ${t.meeting_point}`, t.day_of_contact && `Day-of contact: ${t.day_of_contact}`].filter(Boolean)
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
                  t.creator_name, t.latitude, t.longitude, t.is_online, t.meeting_point, t.day_of_contact`
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
          WHERE ${MANAGED_BY_SQL('t', '$1')} AND t.status <> 'cancelled' AND t.date >= CURRENT_DATE - 30
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
      // Day-of details (#438) only in an approved volunteer's own feed.
      const dayOf = t.signup_status === 'approved' ? dayOfLines(t) : []
      events.push(icsEvent(t, { link: site && `${site}/attendance`, summaryPrefix, now, details: dayOf }))
    }
    for (const t of posted.rows) {
      if (seen.has(t.id)) continue
      events.push(icsEvent(t, { link: site && `${site}/my-tasks`, now, details: dayOfLines(t) }))
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
  //
  // Group sign-ups (#439): { guestCount, guestNames } brings up to 3 guests on
  // a task that allows them, and the group takes 1 + guestCount spots. A group
  // that doesn't fit in the spots left joins the waitlist together (with
  // { waitlist: true }) or is refused with how many spots are left — never
  // split, since the guests come with the student.
  const guests = readGuests(req.body)
  if (!guests.ok) return res.status(400).json({ error: guests.error })
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT t.status, t.slots_total, t.created_by, t.date < CURRENT_DATE - 1 AS past, t.min_age, t.allow_guests,
              ${PROVABLY_TOO_YOUNG_SQL('t', '$2')} AS too_young,
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
    const { rows: cohosting } = await client.query('SELECT 1 FROM task_cohosts WHERE task_id = $1 AND user_id = $2', [req.params.id, req.auth.sub])
    if (cohosting.length > 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'You are co-hosting this task, so you cannot sign up for it.' })
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
    // Minimum age (#426). No date of birth is kept, so the student confirms
    // their age; an account the app knows is too young is refused outright.
    if (rows[0].min_age != null) {
      if (rows[0].too_young) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: `This task is for volunteers ${rows[0].min_age} or older.`, tooYoung: true, minAge: rows[0].min_age })
      }
      if (req.body?.ageConfirmed !== true) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: `This task is for volunteers ${rows[0].min_age} or older. Confirm you are ${rows[0].min_age} or older to sign up.`, ageConfirmRequired: true, minAge: rows[0].min_age })
      }
    }

    if (guests.count > 0 && !rows[0].allow_guests) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: "This task doesn't take guests. Sign up on your own, or ask the organizer." })
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
      // Kept simple and safe: an under-13 can't bring guests.
      if (guests.count > 0) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: "Students under 13 can't bring guests. Sign up on your own." })
      }
      const taken = await spotsUsed(client, req.params.id)
      if (taken >= rows[0].slots_total && req.body?.waitlist !== true) {
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
    const taken = await spotsUsed(client, req.params.id)
    const groupSize = 1 + guests.count
    if (taken + groupSize > rows[0].slots_total) {
      // Full: join the waitlist only when asked to, so an older client that
      // didn't know a task was full still gets "full" rather than a surprise.
      if (req.body?.waitlist !== true) {
        await client.query('ROLLBACK')
        const left = Math.max(0, rows[0].slots_total - taken)
        return res.status(400).json(left === 0
          ? { error: 'Task is full.' }
          : { error: groupTooBigMessage(left, groupSize), spotsLeft: left, groupTooBig: true })
      }
      const wid = uid('psig')
      await client.query(
        `INSERT INTO public_task_signups (id, task_id, user_id, status, invited_by, guest_count, guest_names)
         VALUES ($1, $2, $3, 'waitlisted', $4, $5, $6) ON CONFLICT DO NOTHING`,
        [wid, req.params.id, req.auth.sub, invitedBy, guests.count, guests.names.length ? guests.names : null],
      )
      const { rows: pos } = await client.query(`SELECT ${WAITLIST_POSITION_SQL('$1', '$2')} AS position`, [req.params.id, req.auth.sub])
      await client.query('COMMIT')
      if (invitedBy) notifyFriendJoined(invitedBy, req.params.id, req.auth.sub)
      return res.json({ ok: true, id: wid, waitlisted: true, position: Number(pos[0].position) || 1 })
    }

    const sid = uid('psig')
    await client.query(
      `INSERT INTO public_task_signups (id, task_id, user_id, status, invited_by, guest_count, guest_names)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
      [sid, req.params.id, req.auth.sub, 'pending', invitedBy, guests.count, guests.names.length ? guests.names : null],
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

// The task's own spot on Opportunities, which scrolls to and highlights it.
// Signed-out readers go through sign-in and land back here.
function taskPageLink(taskId) {
  return `${frontendBase()}/opportunities?task=${encodeURIComponent(taskId)}`
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
    // The invitee's language if they have an account, else the inviter's:
    // friends who invite each other usually share one.
    const { rows: langRows } = await query(
      `SELECT LOWER(email) AS email, language, id FROM users WHERE LOWER(email) = ANY($1::text[]) OR id = $2`,
      [emails, inviterId],
    )
    const inviterLang = langRows.find((r) => r.id === inviterId)?.language
    const langOf = new Map(langRows.filter((r) => r.language).map((r) => [r.email, r.language]))
    const link = `${frontendBase()}/opportunities?task=${encodeURIComponent(taskId)}&from=${encodeURIComponent(inviterId)}`
    for (const email of emails) {
      const lang = emailLang(langOf.get(email) || inviterLang)
      const first = String(task.my_name || '').trim().split(/\s+/)[0] || et(lang, 'A friend')
      const subject = et(lang, '{first} invited you to volunteer together: {title}', { first, title: task.title })
      if (email.endsWith('@test.com')) {
        console.log(`[invite] skipped @test.com fixture ${email}: ${subject}`)
        continue
      }
      if (skip.has(email)) continue
      await sendEmail({
        to: email,
        subject,
        html: taskEmailHtml({
          lang,
          heading: et(lang, '{first} invited you to volunteer together', { first }),
          lines: [
            et(lang, '{first} signed up for this volunteer task on VolunTrack and would like you to come along.', { first }),
            et(lang, 'Open the link to see the details and sign up. You need a VolunTrack account, which is free.'),
            et(lang, "You got this email because a friend entered your address. We don't keep it or email you again unless you sign up."),
          ],
          task,
          link,
          linkLabel: et(lang, 'See the task and sign up'),
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
              c.name AS child_name, c.parent_consent_email, c.language AS child_language
         FROM public_task_signups s
         JOIN public_tasks t ON t.id = s.task_id
         JOIN users c ON c.id = s.user_id
        WHERE s.id = $1 AND s.status = 'parent_pending'`,
      [signupId],
    )
    const row = rows[0]
    if (!row) return 'none'
    const child = childFirstName(row.child_name)
    const subjectFor = (lang) => et(lang, '{child} wants to volunteer: {title}', { child, title: row.title })
    const when = friendlyWhen(row.date, row.time)

    const { rows: parents } = await query(
      `SELECT u.id, u.email, u.language FROM parent_child_links l JOIN users u ON u.id = l.parent_id
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
      sendParentOkEmails(parents.map((p) => ({ email: p.email, lang: p.language })), subjectFor, (lang) => ({
        lang,
        heading: et(lang, '{child} needs your OK to volunteer', { child }),
        lines: [
          et(lang, "{name} signed up for this volunteer task on VolunTrack. Because they are under 13, the organizer won't see the sign-up until you approve it.", { name: row.child_name || child }),
          et(lang, 'Open your Family dashboard to approve or decline. Nothing is shared with the organizer if you decline.'),
        ],
        task: row,
        link: `${frontendBase()}/parent`,
        linkLabel: et(lang, 'Review on your Family dashboard'),
      }))
      return 'linked'
    }

    if (row.parent_consent_email) {
      const token = generateToken()
      const { rowCount } = await query(
        "UPDATE public_task_signups SET parent_ok_token = $1 WHERE id = $2 AND status = 'parent_pending'",
        [token, signupId],
      )
      if (rowCount === 0) return 'none'
      // No parent account, so no saved language: the child's is the best guess.
      sendParentOkEmails([{ email: row.parent_consent_email, lang: row.child_language }], subjectFor, (lang) => ({
        lang,
        heading: et(lang, '{child} needs your OK to volunteer', { child }),
        lines: [
          et(lang, "{name} signed up for this volunteer task on VolunTrack and gave this address as their parent or guardian. Because they are under 13, the organizer won't see the sign-up until you approve it.", { name: row.child_name || child }),
          et(lang, 'Open the link to approve or decline. Nothing changes until you press a button on that page, and the link works once.'),
          et(lang, "If you don't know this child, decline or ignore this email."),
        ],
        task: row,
        link: `${emailApiBase()}/api/parent/task-ok/${token}`,
        linkLabel: et(lang, 'Review this sign-up'),
      }))
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
// `recipients` are { email, lang }; subject and content are built per language.
async function sendParentOkEmails(recipients, subjectFor, contentFor) {
  const seen = new Set()
  for (const r of recipients) {
    const email = String(r.email || '').trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    const lang = emailLang(r.lang)
    const subject = subjectFor(lang)
    if (email.endsWith('@test.com')) {
      console.log(`[parent-ok] skipped @test.com fixture ${email}: ${subject}`)
      continue
    }
    try {
      await sendEmail({ to: email, subject, html: taskEmailHtml(contentFor(lang)) })
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
      `SELECT s.status, s.user_id, s.guest_count,
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
      const taken = await spotsUsed(client, found[0].task_id)
      // Filled up while the parent was deciding: the waitlist, never over
      // capacity. signed_up_at restarts at the OK, so the child joins the
      // line behind people who were already waiting.
      const status = taken + 1 + (Number(signup.guest_count) || 0) <= task.slots_total ? 'pending' : 'waitlisted'
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
//
// Group sign-ups (#439): a waiting student with guests moves up only when the
// whole group fits. A group that doesn't fit keeps its place in line, and a
// smaller sign-up behind it may take the spots that are left — otherwise one
// group of four would hold a single free spot empty until the event.

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
      let free = task.slots_total - await spotsUsed(client, taskId)
      if (free > 0) {
        const { rows: waiting } = await client.query(
          `SELECT id, user_id, ${SIGNUP_SPOTS_SQL('w')} AS size FROM public_task_signups w
            WHERE w.task_id = $1 AND w.status = 'waitlisted' ORDER BY w.signed_up_at, w.id`,
          [taskId],
        )
        const ids = []
        for (const w of waiting) {
          if (free <= 0) break
          if (w.size > free) continue
          ids.push(w.id)
          promoted.push(w.user_id)
          free -= w.size
        }
        if (ids.length) {
          await client.query("UPDATE public_task_signups SET status = 'pending' WHERE id = ANY($1::text[])", [ids])
        }
      }
    }
    await client.query('COMMIT')
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { /* connection already broken */ }
    promoted = []
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
      `SELECT t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location, t.creator_name, u.email, u.name, u.language
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
    const lang = emailLang(row.language)
    await sendEmail({
      to: row.email,
      subject: et(lang, 'A spot opened up: {title}', { title: row.title }),
      html: taskEmailHtml({
        lang,
        heading: et(lang, "You're off the waitlist"),
        lines: [
          emailHi(lang, row.name),
          et(lang, "A spot opened up and it's yours. The organizer will confirm your sign-up, and you'll get another email when they do."),
          et(lang, "Can't make it any more? Cancel from Attendance in VolunTrack so the next person gets the spot."),
        ],
        task: row,
        link: taskPageLink(taskId),
        linkLabel: et(lang, 'View task'),
      }),
    })
  } catch (error) {
    console.error('waitlist notification failed:', error)
  }
}

// A volunteer cancels their own sign-up or leaves the waitlist. Not once the
// day has passed or attendance is marked (that's a record now), and not a
// rejected one: deleting it would let them sign up again. A freed slot goes
// to the waitlist. Shared by DELETE /signup and "Can't make it" (#438), so the
// two can't drift. Answers { ok, status } or { ok: false, code, error }.
async function cancelOwnSignup(taskId, userId) {
  const { rows } = await query(
    `SELECT s.status, s.attendance_status, t.date < CURRENT_DATE - 1 AS past
       FROM public_task_signups s JOIN public_tasks t ON t.id = s.task_id
      WHERE s.task_id = $1 AND s.user_id = $2`,
    [taskId, userId],
  )
  if (rows.length === 0) return { ok: false, code: 404, error: "You aren't signed up for this task." }
  const signup = rows[0]
  if (signup.status === 'rejected') return { ok: false, code: 400, error: 'The organizer already declined this sign-up.' }
  if (signup.past || signup.attendance_status) {
    return { ok: false, code: 400, error: 'This task has already happened, so the sign-up stays on your record.' }
  }
  await query('DELETE FROM public_task_signups WHERE task_id = $1 AND user_id = $2', [taskId, userId])
  // Only pending and approved hold a slot; a sign-up still waiting for (or
  // turned down by) a parent, or on the waitlist, frees nothing.
  if (['pending', 'approved'].includes(signup.status)) await promoteFromWaitlist(taskId)
  return { ok: true, status: signup.status }
}

// DELETE /api/school/public-tasks/:id/signup — see cancelOwnSignup.
router.delete('/public-tasks/:id/signup', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const result = await cancelOwnSignup(req.params.id, req.auth.sub)
    if (!result.ok) return res.status(result.code).json({ error: result.error })
    return res.json({ ok: true })
  } catch (error) {
    console.error('cancel signup failed:', error)
    return res.status(500).json({ error: 'Could not cancel the sign-up.' })
  }
})

// --- Day of the task (#438) ----------------------------------------------------
//
// On the task's day an approved volunteer can tell the organizer they're
// running late (with an optional ETA) or that they can't make it. "The day" has
// the check-in code's day of slack either side, since the server's date is
// UTC's; the app shows the buttons only on the volunteer's own local date.

const LATE_ETAS = [10, 20, 30]
const dayOfLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many updates. Please wait a few minutes.' },
})

// The caller's approved sign-up on a task happening today, or an error.
async function dayOfSignup(taskId, userId) {
  const { rows } = await query(
    `SELECT s.id, s.status, s.late_at, s.late_eta_minutes, s.checked_in_at,
            (s.late_at IS NOT NULL AND s.late_at::date >= CURRENT_DATE - 1) AS late_today,
            t.title, t.created_by, t.status AS task_status,
            t.date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 1 AS today, u.name
       FROM public_task_signups s JOIN public_tasks t ON t.id = s.task_id JOIN users u ON u.id = s.user_id
      WHERE s.task_id = $1 AND s.user_id = $2`,
    [taskId, userId],
  )
  const row = rows[0]
  if (!row) return { error: "You aren't signed up for this task.", code: 404 }
  if (row.status !== 'approved') return { error: 'Only approved volunteers can send day-of updates.', code: 403 }
  if (row.task_status === 'cancelled') return { error: 'This task was cancelled.', code: 400 }
  if (!row.today) return { error: 'You can only send this on the day of the task.', code: 400 }
  return { row }
}

// POST { etaMinutes?: 10 | 20 | 30 | null } — "Running late". One per sign-up
// on the day: sending again changes the ETA. The organizer's bell rings the
// first time and whenever the ETA changes.
router.post('/public-tasks/:id/running-late', dayOfLimiter, requireDb, requireAuth(), async (req, res) => {
  const raw = req.body?.etaMinutes
  const eta = raw == null || raw === '' ? null : Number(raw)
  if (eta !== null && !LATE_ETAS.includes(eta)) return res.status(400).json({ error: 'Pick 10, 20 or 30+ minutes, or no time.' })
  try {
    const { row, error, code } = await dayOfSignup(req.params.id, req.auth.sub)
    if (error) return res.status(code).json({ error })
    if (row.checked_in_at) return res.status(400).json({ error: "You've already checked in." })
    const changed = !row.late_today || row.late_eta_minutes !== eta
    const { rows: saved } = await query(
      `UPDATE public_task_signups
          SET late_eta_minutes = $2, late_at = CASE WHEN $3::boolean THEN late_at ELSE now() END
        WHERE id = $1 RETURNING late_eta_minutes, late_at`,
      [row.id, eta, row.late_today],
    )
    if (changed) {
      notify(row.created_by, {
        kind: 'volunteer_late',
        title: row.title,
        body: `${row.name || 'A volunteer'} is running late${eta ? ` (~${eta === 30 ? '30+' : eta} min)` : ''}.`,
        link: '/my-tasks',
      })
    }
    return res.json({ ok: true, lateEtaMinutes: saved[0].late_eta_minutes, lateAt: saved[0].late_at })
  } catch (error) {
    console.error('running late failed:', error)
    return res.status(500).json({ error: 'Could not tell the organizer.' })
  }
})

// POST — "Can't make it": the ordinary cancel (cancelOwnSignup, so the
// waitlist moves up), plus a bell entry for the organizer.
router.post('/public-tasks/:id/cant-make-it', dayOfLimiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { row, error, code } = await dayOfSignup(req.params.id, req.auth.sub)
    if (error) return res.status(code).json({ error })
    const result = await cancelOwnSignup(req.params.id, req.auth.sub)
    if (!result.ok) return res.status(result.code).json({ error: result.error })
    notify(row.created_by, {
      kind: 'volunteer_cancelled_day_of',
      title: row.title,
      body: `${row.name || 'A volunteer'} can't make it today. Their spot went to the waitlist, if anyone was waiting.`,
      link: '/my-tasks',
    })
    return res.json({ ok: true })
  } catch (error) {
    console.error('cant make it failed:', error)
    return res.status(500).json({ error: 'Could not cancel the sign-up.' })
  }
})

// PATCH /api/school/public-tasks/:id/signup/guests { guestCount, guestNames }
// Group sign-ups (#439): the student changes how many guests they bring, or
// removes them (guestCount 0). More guests on a sign-up that holds spots must
// fit in the spots left; on the waitlist the group just waits as its new size.
// Fewer guests free spots, so the waitlist moves up. Not once the day has
// passed or attendance is marked, as for cancelling.
router.patch('/public-tasks/:id/signup/guests', limiter, requireDb, requireAuth(), async (req, res) => {
  const guests = readGuests({ guestCount: req.body?.guestCount ?? 0, guestNames: req.body?.guestNames })
  if (!guests.ok) return res.status(400).json({ error: guests.error })
  const client = await getPool().connect()
  let freed = false
  try {
    await client.query('BEGIN')
    // The task row lock, as sign-up and promotion take it.
    const { rows: taskRows } = await client.query(
      'SELECT status, slots_total, allow_guests, date < CURRENT_DATE - 1 AS past FROM public_tasks WHERE id = $1 FOR UPDATE',
      [req.params.id],
    )
    const { rows: signupRows } = await client.query(
      `SELECT s.status, s.guest_count, s.attendance_status, u.under_13
         FROM public_task_signups s JOIN users u ON u.id = s.user_id
        WHERE s.task_id = $1 AND s.user_id = $2 FOR UPDATE OF s`,
      [req.params.id, req.auth.sub],
    )
    const task = taskRows[0]
    const signup = signupRows[0]
    const refuse = async (code, error, extra = {}) => {
      await client.query('ROLLBACK')
      return res.status(code).json({ error, ...extra })
    }
    if (!task || !signup) return await refuse(404, "You aren't signed up for this task.")
    if (!['pending', 'approved', 'waitlisted'].includes(signup.status)) return await refuse(400, "This sign-up can't take guests.")
    if (task.status === 'cancelled') return await refuse(400, 'This task was cancelled.')
    if (task.past || signup.attendance_status) return await refuse(400, 'This task has already happened.')
    const before = Number(signup.guest_count) || 0
    if (guests.count > before) {
      if (!task.allow_guests) return await refuse(400, "This task doesn't take guests.")
      if (signup.under_13 === true) return await refuse(400, "Students under 13 can't bring guests.")
      if (signup.status !== 'waitlisted') {
        const others = await spotsUsed(client, req.params.id) - (1 + before)
        const left = task.slots_total - others
        if (1 + guests.count > left) {
          return await refuse(400, groupTooBigMessage(Math.max(0, left), 1 + guests.count), { spotsLeft: Math.max(0, left), groupTooBig: true })
        }
      }
    }
    await client.query(
      'UPDATE public_task_signups SET guest_count = $3, guest_names = $4 WHERE task_id = $1 AND user_id = $2',
      [req.params.id, req.auth.sub, guests.count, guests.names.length ? guests.names : null],
    )
    await client.query('COMMIT')
    // A smaller group frees spots — or, on the waitlist, may now fit.
    freed = guests.count < before
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { /* connection already broken */ }
    console.error('change guests failed:', error)
    return res.status(500).json({ error: 'Could not change your guests.' })
  } finally {
    client.release()
  }
  if (freed) await promoteFromWaitlist(req.params.id)
  return res.json({ ok: true, guestCount: guests.count, guestNames: guests.names })
})

// Approve a signup (the creator or a co-host) — reveals phone number to volunteer
router.post('/public-tasks/:id/approve/:userId', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const access = await canManageTask(req.params.id, req.auth.sub)
    if (refuseTaskAccess(res, access, "Only the task's organizer or a co-host can approve signups.")) return

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

// Reject a signup (the creator or a co-host)
router.post('/public-tasks/:id/reject/:userId', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const access = await canManageTask(req.params.id, req.auth.sub)
    if (refuseTaskAccess(res, access, "Only the task's organizer or a co-host can reject signups.")) return

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
// The task's .ics file: phones and calendar apps open it as "add this event".
function taskCalendarLink(taskId) {
  return `${emailApiBase()}/api/school/public-tasks/${encodeURIComponent(taskId)}/calendar.ics`
}

// Same two choices as the app's AddToCalendar: Google, and the .ics file.
function calendarLinksHtml(task, taskId, lang = 'en') {
  const google = googleCalendarLink(task, taskId, lang)
  return `<p><strong>${et(lang, 'Add to calendar:')}</strong> ${google ? `<a href="${escapeHtml(google)}">Google Calendar</a> · ` : ''}<a href="${escapeHtml(taskCalendarLink(taskId))}">Apple / Outlook</a></p>`
}

// Google Calendar's "new event" page, the same event as the .ics file (two
// hours, or all day without a time). Mirrors src/lib/calendarLinks.js.
function googleCalendarLink(task, taskId, lang = 'en') {
  const iso = task.date instanceof Date
    ? `${task.date.getFullYear()}-${String(task.date.getMonth() + 1).padStart(2, '0')}-${String(task.date.getDate()).padStart(2, '0')}`
    : String(task.date || '').slice(0, 10)
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = (dt) => `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00`
  const hm = /^(\d{1,2}):(\d{2})/.exec(task.time || '')
  let dates
  if (hm) {
    const start = new Date(Date.UTC(y, m - 1, d, Number(hm[1]), Number(hm[2])))
    dates = `${stamp(start)}/${stamp(new Date(start.getTime() + 2 * 3600e3))}`
  } else {
    const day = new Date(Date.UTC(y, m - 1, d))
    dates = `${stamp(day).slice(0, 8)}/${stamp(new Date(day.getTime() + 86400e3)).slice(0, 8)}`
  }
  const details = [task.creator_name && et(lang, 'Posted by {name}', { name: task.creator_name }), taskPageLink(taskId)].filter(Boolean).join('\n\n')
  const q = new URLSearchParams({ action: 'TEMPLATE', text: task.title || 'Volunteer task', dates, location: task.location || '', details })
  return `https://calendar.google.com/calendar/render?${q}`
}

// `lang` ('en' | 'es') translates the template's own words; callers pass
// heading, lines and labels already translated (see ../emailStrings.js).
function taskEmailHtml({ heading, lines, task, link, linkLabel, calendarTaskId, unsubscribe, lang = 'en' }) {
  const when = friendlyWhen(task.date, task.time, lang)
  const detail = [
    when ? `<p><strong>${et(lang, 'When:')}</strong> ${escapeHtml(when)}</p>` : '',
    task.location ? `<p><strong>${et(lang, 'Where:')}</strong> ${escapeHtml(task.location)}</p>` : '',
    task.creator_name ? `<p><strong>${et(lang, 'Organizer:')}</strong> ${escapeHtml(task.creator_name)}</p>` : '',
  ].join('')
  return `
    <h2>${escapeHtml(heading)}</h2>
    ${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')}
    <h3>${escapeHtml(task.title || et(lang, 'Volunteer opportunity'))}</h3>
    ${detail}
    ${link ? `<p><a href="${escapeHtml(link)}">${escapeHtml(linkLabel || et(lang, 'Open in VolunTrack'))}</a></p>` : ''}
    ${calendarTaskId ? calendarLinksHtml(task, calendarTaskId, lang) : ''}
    ${unsubscribe ? `<p style="font-size:12px;color:#888"><a href="${escapeHtml(unsubscribe.href)}">${escapeHtml(unsubscribe.label)}</a></p>` : ''}
    ${emailFooterHtml(lang)}
  `
}

// "Hi Sam," / "Hola, Sam:", or "Hi there," without a name.
function emailHi(lang, name) {
  return name ? et(lang, 'Hi {name},', { name }) : et(lang, 'Hi there,')
}

// Fire-and-forget, like recordAudit: a mail server having a bad day must not
// turn a successful approval into a 500 for the organizer.
async function notifySignupDecision(taskId, userId, decision) {
  try {
    const { rows } = await query(
      `SELECT t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location, t.creator_name, t.important_info, u.email, u.name, u.language
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
        ? friendlyWhen(row.date, row.time) || 'The organizer approved your sign-up.'
        : 'The organizer could not take your sign-up for this one.',
      link: approved ? '/attendance' : '/opportunities',
    })
    if (!row.email) return
    const lang = emailLang(row.language)
    await sendEmail({
      to: row.email,
      subject: et(lang, approved ? "You're in: {title}" : 'Update on your signup: {title}', { title: row.title }),
      html: taskEmailHtml({
        lang,
        heading: et(lang, approved ? "You're approved" : 'Your signup was not accepted'),
        lines: approved
          ? [
            emailHi(lang, row.name),
            et(lang, 'The organizer approved your signup.'),
            ...(row.important_info ? [row.important_info] : []),
          ]
          : [emailHi(lang, row.name), et(lang, 'The organizer could not take your signup for this one. Other opportunities are listed in VolunTrack.')],
        task: row,
        link: taskPageLink(taskId),
        linkLabel: et(lang, 'View task'),
        calendarTaskId: approved ? taskId : undefined,
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
  const editable = ['title', 'description', 'location', 'date', 'time', 'phone', 'importantInfo', 'slotsTotal', 'latitude', 'longitude', 'category',
    'minAge', 'isOnline', 'wheelchairAccessible', 'accessibilityNote', 'isOutdoor', 'meetingPoint', 'dayOfContact', 'allowGuests']
  const limits = { title: 200, description: 5000, location: 300, phone: 30, importantInfo: 2000 }
  // Task details (#426): same readers as create.
  const detailReaders = {
    minAge: taskMinAge, isOnline: taskOnline, wheelchairAccessible: taskWheelchair, accessibilityNote: taskAccessNote, isOutdoor: taskOutdoor,
    meetingPoint: taskMeetingPoint, dayOfContact: taskDayOfContact,
    // Turning guests off later keeps the guests already signed up.
    allowGuests: (v) => (typeof v === 'boolean' ? { ok: true, value: v } : { ok: false, error: 'Allow guests must be true or false.' }),
  }

  try {
    const { rows } = await query('SELECT created_by, status, is_online, location FROM public_tasks WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'Task not found.' })
    if (rows[0].created_by !== req.auth.sub) return res.status(403).json({ error: 'Only the task creator can edit this task.' })
    if (rows[0].status === 'cancelled') return res.status(400).json({ error: 'A cancelled task cannot be edited.' })
    if (req.body.date !== undefined && !isValidDateString(req.body.date)) {
      return res.status(400).json({ error: 'Enter the date as YYYY-MM-DD.' })
    }

    if (req.body.isOnline !== undefined && typeof req.body.isOnline !== 'boolean') {
      return res.status(400).json({ error: 'Online must be true or false.' })
    }
    const onlineAfter = req.body.isOnline !== undefined ? req.body.isOnline : rows[0].is_online
    // Back to in person: it needs a real address again.
    if (!onlineAfter && rows[0].is_online && req.body.location === undefined && rows[0].location === ONLINE_LOCATION) {
      return res.status(400).json({ error: 'Add the address for an in-person task.' })
    }

    const sets = []
    const values = []
    for (const field of editable) {
      if (req.body[field] === undefined) continue
      const column = {
        importantInfo: 'important_info', slotsTotal: 'slots_total', minAge: 'min_age', isOnline: 'is_online',
        wheelchairAccessible: 'wheelchair_accessible', accessibilityNote: 'accessibility_note', isOutdoor: 'is_outdoor',
        meetingPoint: 'meeting_point', dayOfContact: 'day_of_contact', allowGuests: 'allow_guests',
      }[field] || field

      if (detailReaders[field]) {
        const d = detailReaders[field](req.body[field])
        if (!d.ok) return res.status(400).json({ error: d.error })
        values.push(d.value)
        sets.push(`${column} = $${values.length}`)
        continue
      }
      // An online task has no map pin, and its address is optional.
      if (onlineAfter && (field === 'latitude' || field === 'longitude')) continue
      if (onlineAfter && field === 'location' && !String(req.body.location ?? '').trim()) {
        values.push(ONLINE_LOCATION)
        sets.push(`location = $${values.length}`)
        continue
      }

      if (field === 'slotsTotal') {
        const slots = Number(req.body.slotsTotal)
        if (!Number.isInteger(slots) || slots < 1 || slots > 1000) {
          return res.status(400).json({ error: 'Volunteers needed must be between 1 and 1000.' })
        }
        // Spots, not people: an approved volunteer's guests hold spots too.
        const { rows: approved } = await query(
          `SELECT COUNT(*)::int AS people, COALESCE(SUM(${SIGNUP_SPOTS_SQL('s')}), 0)::int AS spots
             FROM public_task_signups s WHERE s.task_id = $1 AND s.status = 'approved'`,
          [req.params.id],
        )
        const { people, spots } = approved[0]
        if (slots < spots) {
          return res.status(400).json({
            error: spots === people
              ? `You have already approved ${people} volunteers — reject someone first to go below that.`
              : `Your approved ${people === 1 ? 'volunteer and their guests' : 'volunteers and their guests'} already take ${spots} spots — reject someone first to go below that.`,
          })
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
    if (onlineAfter) sets.push('latitude = NULL', 'longitude = NULL')
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

// Everyone a cancellation should reach: signed up, not turned away.
async function cancellationRecipients(taskId) {
  const { rows } = await query(
    `SELECT u.email, u.name, u.language FROM public_task_signups s JOIN users u ON u.id = s.user_id
      WHERE s.task_id = $1 AND s.status NOT IN ('rejected', 'parent_declined')`,
    [taskId],
  )
  return rows
}

// Sequential and individual — see taskEmailHtml on why there is no shared
// recipient line. Failures are logged, never surfaced as a failed cancel:
// the event is off either way. `accountClosed` swaps the "organizer
// cancelled" line for one saying the organizer's account is gone.
async function sendCancellationEmails(task, people, { reason = '', accountClosed = false } = {}) {
  for (const person of people) {
    if (!person.email) continue
    try {
      const lang = emailLang(person.language)
      await sendEmail({
        to: person.email,
        subject: et(lang, 'Cancelled: {title}', { title: task.title }),
        html: taskEmailHtml({
          lang,
          heading: et(lang, 'This event has been cancelled'),
          lines: [
            emailHi(lang, person.name),
            accountClosed
              ? et(lang, 'The organizer closed their VolunTrack account, so this event will not happen.')
              : et(lang, 'The organizer has cancelled this event.'),
            ...(reason ? [et(lang, 'Reason given: {reason}', { reason })] : []),
          ],
          task,
          // The cancelled task isn't listed any more, so point at the rest.
          link: `${frontendBase()}/opportunities`,
          linkLabel: et(lang, 'Find another task'),
        }),
      })
    } catch (error) { console.error('cancellation email failed:', error) }
  }
}

// An organizer's events that haven't happened yet, with who signed up. Used
// before their account is deleted (routes/auth.js), because deleting it
// cascades the tasks and signups away: this is the last chance to tell people.
export async function upcomingEventsFor(userId) {
  const { rows: tasks } = await query(
    `SELECT id, title, to_char(date, 'YYYY-MM-DD') AS date, time, location, creator_name
       FROM public_tasks
      WHERE created_by = $1 AND status <> 'cancelled' AND date >= CURRENT_DATE
      ORDER BY date`,
    [userId],
  )
  const out = []
  for (const task of tasks) out.push({ task, people: await cancellationRecipients(task.id) })
  return out
}

// Fire-and-forget after the account is gone: the rows no longer exist, so
// the list gathered by upcomingEventsFor is all that is left.
export function notifyEventsCancelledByDeletion(events) {
  ;(async () => {
    for (const { task, people } of events) await sendCancellationEmails(task, people, { accountClosed: true })
  })().catch((error) => console.error('account-deletion cancellation emails failed:', error))
}

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

    const people = await cancellationRecipients(req.params.id)
    await sendCancellationEmails(rows[0], people, { reason })

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
    const access = await canManageTask(req.params.id, req.auth.sub)
    if (refuseTaskAccess(res, access, "Only the task's organizer or a co-host can message volunteers.")) return
    // A co-host's message is signed with their own name.
    let cohostName = null
    if (access.isCohost) {
      const { rows: me } = await query('SELECT name FROM users WHERE id = $1', [req.auth.sub])
      cohostName = me[0]?.name || ''
    }
    const fromFor = (lang) => (cohostName !== null
      ? et(lang, '{name} (co-host)', { name: cohostName || et(lang, 'a co-host') })
      : rows[0].creator_name || et(lang, 'the organizer'))

    const { rows: people } = await query(
      // Not to anyone who blocked the task's creator or the sender
      // (server/routes/reports.js).
      `SELECT u.email, u.name, u.language FROM public_task_signups s JOIN users u ON u.id = s.user_id
        WHERE s.task_id = $1 AND s.status = 'approved'
          AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = s.user_id AND b.blocked_id IN ($2, $3))`,
      [req.params.id, access.createdBy, req.auth.sub],
    )
    if (people.length === 0) return res.status(400).json({ error: 'No approved volunteers to message yet.' })

    let sent = 0
    for (const person of people) {
      try {
        const lang = emailLang(person.language)
        await sendEmail({
          to: person.email,
          subject: et(lang, 'Message from the organizer: {title}', { title: rows[0].title }),
          html: taskEmailHtml({
            lang,
            heading: et(lang, 'A message from {from}', { from: fromFor(lang) }),
            lines: [message],
            task: rows[0],
            link: taskPageLink(req.params.id),
            linkLabel: et(lang, 'View task'),
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
      `SELECT t.id, t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location, t.creator_name, t.important_info,
              t.meeting_point, t.day_of_contact
         FROM public_tasks t
        WHERE t.status = 'open'
          AND t.date = (current_date + interval '1 day')::date
          AND NOT EXISTS (SELECT 1 FROM public_task_reminder_sends r WHERE r.task_id = t.id)`,
    )

    const results = []
    for (const task of tasks) {
      const { rows: people } = await query(
        `SELECT u.email, u.name, u.language FROM public_task_signups s JOIN users u ON u.id = s.user_id
          WHERE s.task_id = $1 AND s.status = 'approved'`,
        [task.id],
      )
      if (people.length === 0) continue
      if (dryRun) { results.push({ task: task.title, recipients: people.length, dryRun: true }); continue }

      let sent = 0
      for (const person of people) {
        try {
          const lang = emailLang(person.language)
          await sendEmail({
            to: person.email,
            subject: et(lang, 'Tomorrow: {title}', { title: task.title }),
            html: taskEmailHtml({
              lang,
              heading: et(lang, 'Your volunteer event is tomorrow'),
              lines: [
                emailHi(lang, person.name),
                et(lang, 'This is a reminder about tomorrow.'),
                ...(task.important_info ? [task.important_info] : []),
                // Only approved volunteers get this email, so the day-of details may go in.
                ...(task.meeting_point ? [et(lang, 'Meeting point: {place}', { place: task.meeting_point })] : []),
                ...(task.day_of_contact ? [et(lang, 'On the day, contact: {contact}', { contact: task.day_of_contact })] : []),
              ],
              task,
              link: taskPageLink(task.id),
              linkLabel: et(lang, 'View task'),
              calendarTaskId: task.id,
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

// Who "showed up", over a signup `s`: an approved volunteer marked present, or
// one who checked in by QR and wasn't since marked absent or excused — the same
// reading RATING_OPEN_SQL uses for who may rate.
const SHOWED_UP_SQL = `(s.status = 'approved' AND (s.attendance_status = 'present'
  OR (s.checked_in_at IS NOT NULL AND s.attendance_status IS NULL)))`

// One row per task the organizer posted in [from, to] (either end optional),
// with its signup, attendance, hours and rating counts. Shared by the impact
// report and the stats view so the two can't drift apart. Signups, logs and
// ratings are each one-to-many off a task, so each is aggregated in its own
// LATERAL subquery — joining them in one GROUP BY would multiply them against
// each other (a task with 3 signups and 2 logs reported 30 hours, not 10).
async function organizerTaskRows(userId, { from, to }) {
  const params = [userId]
  let range = ''
  if (from) { params.push(from); range += ` AND t.date >= $${params.length}` }
  if (to) { params.push(to); range += ` AND t.date <= $${params.length}` }
  const { rows } = await query(
    `SELECT t.id, t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.location, t.status, t.slots_total, t.category,
            sg.*, lg.*, rt.*
       FROM public_tasks t
       CROSS JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE s.status = 'approved')::int                                 AS approved,
                COUNT(*) FILTER (WHERE s.status = 'pending')::int                                  AS pending,
                COUNT(*) FILTER (WHERE s.status = 'waitlisted')::int                               AS waitlisted,
                -- Group sign-ups (#439): guests of approved volunteers. They
                -- hold spots but have no accounts, so attendance and hours
                -- below count students only.
                COALESCE(SUM(s.guest_count) FILTER (WHERE s.status = 'approved'), 0)::int          AS approved_guests,
                COUNT(*) FILTER (WHERE s.attendance_status = 'present')::int                       AS present,
                COUNT(*) FILTER (WHERE s.attendance_status = 'absent')::int                        AS absent,
                COUNT(*) FILTER (WHERE s.attendance_status = 'excused')::int                       AS excused,
                COUNT(*) FILTER (WHERE ${SHOWED_UP_SQL})::int                                      AS showed_up,
                COUNT(*) FILTER (WHERE s.status = 'approved' AND s.attendance_status = 'absent')::int  AS no_shows,
                COUNT(*) FILTER (WHERE s.status = 'approved' AND s.attendance_status = 'excused')::int AS excused_approved
           FROM public_task_signups s WHERE s.task_id = t.id
       ) sg
       CROSS JOIN LATERAL (
         SELECT COALESCE(SUM(l.hours), 0)::float8                                                   AS hours,
                COALESCE(SUM(l.hours) FILTER (WHERE l.verification_status = 'approved'), 0)::float8 AS hours_approved
           FROM logs l WHERE l.task_id = t.id
       ) lg
       CROSS JOIN LATERAL (
         SELECT COUNT(*)::int AS rating_count, COALESCE(SUM(r.stars), 0)::int AS rating_sum
           FROM task_ratings r WHERE r.task_id = t.id
       ) rt
      WHERE ${MANAGED_BY_SQL('t', '$1')}${range}
      ORDER BY t.date DESC, t.created_at DESC`,
    params,
  )
  return { rows, params, range }
}

// GET /api/school/public-tasks/mine/report?from=&to=
// What an organizer needs at grant time. Every figure here was already in
// public_tasks and its signups; nothing could read it back out.
router.get('/public-tasks/mine/report', limiter, requireDb, requireAuth(), async (req, res) => {
  const from = String(req.query.from || '').trim()
  const to = String(req.query.to || '').trim()
  if (from && !validator.isDate(from)) return res.status(400).json({ error: 'Invalid from date.' })
  if (to && !validator.isDate(to)) return res.status(400).json({ error: 'Invalid to date.' })

  try {
    const { rows, params, range } = await organizerTaskRows(req.auth.sub, { from, to })

    const tasks = rows.map((r) => ({
      id: r.id,
      title: r.title,
      date: r.date,
      location: r.location,
      status: r.status,
      slotsTotal: r.slots_total,
      approved: r.approved,
      guests: r.approved_guests,
      pending: r.pending,
      present: r.present,
      absent: r.absent,
      excused: r.excused,
      hours: r.hours,
    }))

    // Distinct people, not signups: one volunteer at six events is one
    // volunteer, which is the number a grant report is asking for.
    const { rows: distinct } = await query(
      `SELECT COUNT(DISTINCT s.user_id) AS people
         FROM public_task_signups s JOIN public_tasks t ON t.id = s.task_id
        WHERE ${MANAGED_BY_SQL('t', '$1')} AND s.status = 'approved'${range}`,
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
        guests: tasks.reduce((n, t) => n + t.guests, 0),
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

// GET /api/school/public-tasks/mine/stats?from=&to=&all=1
// How the caller's own tasks went, for the Stats tab of My Tasks. Counts only —
// no volunteer's name, email or id, which My Tasks already shows per task.
//
// Window: by task date, default the last 12 months up to today (the database's
// CURRENT_DATE, the clock check-in and rating use). all=1 drops the lower bound.
//
// Show-up rate = showed up ÷ (showed up + no-shows), over approved signups on
// tasks that weren't cancelled. "Showed up" is marked present, or checked in by
// QR and not since marked otherwise; a no-show is marked absent. Excused
// volunteers count on neither side (they told the organizer), and a volunteer
// nobody marked or checked in isn't counted either — so the rate is null, not
// 0%, until attendance has been taken.
//
// Cancelled tasks are left out of every figure and reported only as a count.
// Hours are approved logs linked to the task; a repeat volunteer showed up at
// 2+ of the organizer's tasks within the window.
router.get('/public-tasks/mine/stats', limiter, requireDb, requireAuth(), async (req, res) => {
  const all = req.query.all === '1' || req.query.all === 'true'
  const rawFrom = String(req.query.from || '').trim()
  const rawTo = String(req.query.to || '').trim()
  if (rawFrom && !validator.isDate(rawFrom)) return res.status(400).json({ error: 'Invalid from date.' })
  if (rawTo && !validator.isDate(rawTo)) return res.status(400).json({ error: 'Invalid to date.' })

  try {
    const { rows: [win] } = await query(
      `SELECT CASE WHEN $3::bool THEN NULL
                   ELSE to_char(COALESCE($1::date, (CURRENT_DATE - INTERVAL '12 months')::date), 'YYYY-MM-DD') END AS from_date,
              to_char(COALESCE($2::date, CURRENT_DATE), 'YYYY-MM-DD') AS to_date`,
      [rawFrom || null, rawTo || null, all],
    )
    const from = win.from_date
    const to = win.to_date
    if (from && from > to) return res.status(400).json({ error: 'The start date is after the end date.' })

    const { rows, params, range } = await organizerTaskRows(req.auth.sub, { from, to })
    const ran = rows.filter((r) => r.status !== 'cancelled')
    const cancelled = rows.length - ran.length

    const { rows: [people] } = await query(
      `WITH came AS (
         SELECT DISTINCT s.user_id, s.task_id
           FROM public_task_signups s JOIN public_tasks t ON t.id = s.task_id
          WHERE ${MANAGED_BY_SQL('t', '$1')} AND t.status <> 'cancelled'${range} AND ${SHOWED_UP_SQL}
       ), repeaters AS (
         SELECT user_id FROM came GROUP BY user_id HAVING COUNT(*) >= 2
       )
       SELECT (SELECT COUNT(DISTINCT s.user_id)::int
                 FROM public_task_signups s JOIN public_tasks t ON t.id = s.task_id
                WHERE ${MANAGED_BY_SQL('t', '$1')} AND t.status <> 'cancelled'${range} AND s.status = 'approved') AS volunteers,
              (SELECT COUNT(DISTINCT user_id)::int FROM came) AS attended,
              (SELECT COUNT(*)::int FROM repeaters) AS repeaters,
              COALESCE((SELECT json_object_agg(task_id, n) FROM (
                SELECT c.task_id, COUNT(*)::int AS n FROM came c JOIN repeaters USING (user_id) GROUP BY c.task_id
              ) per), '{}'::json) AS repeaters_by_task`,
      params,
    )

    const round = (n) => Math.round(n * 100) / 100
    const rate = (showed, noShows) => (showed + noShows > 0 ? showed / (showed + noShows) : null)
    const avg = (sum, count) => (count > 0 ? Math.round((sum / count) * 10) / 10 : null)

    const tasks = ran.map((r) => ({
      id: r.id,
      title: r.title,
      date: r.date,
      status: r.status,
      category: r.category || null,
      signups: r.approved,
      guests: r.approved_guests,
      waitlisted: r.waitlisted,
      showedUp: r.showed_up,
      noShows: r.no_shows,
      excused: r.excused_approved,
      showUpRate: rate(r.showed_up, r.no_shows),
      hours: round(r.hours_approved),
      rating: { average: avg(r.rating_sum, r.rating_count), count: r.rating_count },
      repeatVolunteers: Number(people.repeaters_by_task?.[r.id] || 0),
    }))

    // Hours by the month of the task, every month of the window present (an
    // empty month is a fact worth seeing), oldest first.
    // A range reaching back decades (from=1900-01-01) stops at 20 years.
    const byMonth = new Map()
    const lastMonth = to.slice(0, 7)
    let [y, m] = (from || ran.map((r) => r.date).sort()[0] || to).slice(0, 7).split('-').map(Number)
    if ((Number(lastMonth.slice(0, 4)) - y) * 12 > 240) [y, m] = [Number(lastMonth.slice(0, 4)) - 20, Number(lastMonth.slice(5))]
    for (;;) {
      const key = `${y}-${String(m).padStart(2, '0')}`
      if (key > lastMonth) break
      byMonth.set(key, { month: key, tasks: 0, signups: 0, hours: 0 })
      if (++m > 12) { m = 1; y++ }
    }
    const byCategory = new Map()
    for (const t of tasks) {
      const month = byMonth.get(t.date.slice(0, 7))
      if (month) { month.tasks++; month.signups += t.signups; month.hours = round(month.hours + t.hours) }
      if (t.category) {
        const c = byCategory.get(t.category) || { category: t.category, tasks: 0, signups: 0, hours: 0 }
        c.tasks++; c.signups += t.signups; c.hours = round(c.hours + t.hours)
        byCategory.set(t.category, c)
      }
    }
    // Busiest = most hours given, then most sign-ups, then most tasks.
    const busiest = (list) => list.filter((x) => x.tasks > 0)
      .sort((a, b) => b.hours - a.hours || b.signups - a.signups || b.tasks - a.tasks)[0] || null

    const sum = (key) => tasks.reduce((n, t) => n + t[key], 0)
    const showedUp = sum('showedUp')
    const noShows = sum('noShows')
    const ratingCount = ran.reduce((n, r) => n + r.rating_count, 0)
    const ratingSum = ran.reduce((n, r) => n + r.rating_sum, 0)

    return res.json({
      from,
      to,
      totals: {
        tasksRun: tasks.length,
        cancelled,
        signups: sum('signups'),
        guests: sum('guests'),
        waitlisted: sum('waitlisted'),
        volunteers: people.volunteers,
        attended: people.attended,
        showedUp,
        noShows,
        excused: sum('excused'),
        showUpRate: rate(showedUp, noShows),
        hours: round(sum('hours')),
        rating: { average: avg(ratingSum, ratingCount), count: ratingCount },
        repeatVolunteers: people.repeaters,
        busiestCategory: busiest([...byCategory.values()]),
        busiestMonth: busiest([...byMonth.values()]),
      },
      months: [...byMonth.values()],
      tasks,
    })
  } catch (error) {
    console.error('organizer stats failed:', error)
    return res.status(500).json({ error: 'Could not load your stats.' })
  }
})

// --- Organizer endpoints (my tasks + log hours for volunteers) ---

// List tasks I created or co-host, with signups (includes phone + signup status).
// important_info is the organizer's own text: Edit and Post again prefill it,
// and without it here saving an edit blanked it.
router.get('/public-tasks/mine', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT t.id, t.title, t.description, t.location, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.slots_total, t.status, t.category, t.phone, t.important_info, t.latitude, t.longitude, t.created_at,
              t.min_age, t.is_online, t.wheelchair_accessible, t.accessibility_note, t.is_outdoor, t.meeting_point, t.day_of_contact, t.cover_photo_id, t.allow_guests,
              ${SPOTS_USED_SQL('t.id')} AS slots_filled,
              (SELECT COALESCE(json_agg(json_build_object(
                'id', u.id, 'name', u.name, 'email', u.email, 'status', s.status, 'signed_up_at', s.signed_up_at,
                'attendance_status', s.attendance_status, 'attendance_marked_at', s.attendance_marked_at,
                'checked_in_at', s.checked_in_at, 'checked_out_at', s.checked_out_at,
                -- "Running late" (#438), only on the day it was reported.
                'late_eta_minutes', CASE WHEN s.late_at IS NOT NULL AND t.date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 1 THEN s.late_eta_minutes END,
                'late_at', CASE WHEN t.date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 1 THEN s.late_at END,
                -- Group sign-ups (#439): guests coming with them.
                'guest_count', s.guest_count, 'guest_names', COALESCE(s.guest_names, '{}'),
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
               FROM task_ratings r WHERE r.task_id = t.id AND r.comment IS NOT NULL) AS rating_comments,
              -- The one thank-you note (POST /public-tasks/:id/thanks), if sent.
              (SELECT to_char(th.sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM task_thanks th WHERE th.task_id = t.id) AS thanks_sent_at,
              -- Ask the organizer: every question, and those still unanswered.
              (SELECT COUNT(*)::int FROM task_questions q WHERE q.task_id = t.id) AS question_count,
              (SELECT COUNT(*)::int FROM task_questions q WHERE q.task_id = t.id AND q.answer IS NULL AND NOT q.hidden) AS open_question_count,
              -- Co-hosts (#440): the caller may be one rather than the creator.
              t.created_by <> $1 AS is_cohost, t.creator_name,
              (SELECT COUNT(*)::int FROM task_cohosts c WHERE c.task_id = t.id) AS cohost_count
       FROM public_tasks t WHERE ${MANAGED_BY_SQL('t', '$1')}
       ORDER BY t.date DESC, t.created_at DESC`,
      [req.auth.sub],
    )
    return res.json({ tasks: rows })
  } catch (error) {
    console.error('my tasks failed:', error)
    return res.status(500).json({ error: 'Could not fetch your tasks.' })
  }
})

// --- Ask the organizer (#436) -----------------------------------------------
//
// Public Q&A on a task. A signed-in student asks; only the task's creator
// answers, edits the answer, hides or deletes. An answered, unhidden question
// is shown to everyone who can see the task; an unanswered one only to its
// asker and the organizer; a hidden one only to the organizer. The asker is
// never named to other students — only the organizer sees "First L.".
// Blocks and suspensions apply as everywhere else on a task (reports.js);
// a cancelled task is read-only.

const QUESTION_MAX = 300
const ANSWER_MAX = 1000
const OPEN_QUESTIONS_PER_TASK = 3

// Per IP, and a school's students often share one, so it's a spam cap, not a
// per-student quota (that's OPEN_QUESTIONS_PER_TASK).
const askLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many questions. Please try again later.' },
})

// The task as this viewer may see it, or null when it doesn't exist for them:
// an organizer the admin suspended or one the viewer blocked hides the task
// from everyone but the organizer.
async function questionTaskFor(taskId, viewerId) {
  const { rows } = await query(
    `SELECT t.id, t.title, t.status, t.created_by,
            (SELECT posting_suspended_at IS NOT NULL FROM users WHERE id = t.created_by) AS host_suspended,
            ${viewerId ? `EXISTS (SELECT 1 FROM user_blocks b
                    WHERE (b.blocker_id = $2 AND b.blocked_id = t.created_by)
                       OR (b.blocker_id = t.created_by AND b.blocked_id = $2))` : 'false'} AS blocked
       FROM public_tasks t WHERE t.id = $1`,
    viewerId ? [taskId, viewerId] : [taskId],
  )
  const task = rows[0]
  if (!task) return null
  // The creator or a co-host (#440) runs the Q&A.
  const isOrganizer = Boolean(viewerId)
    && (task.created_by === viewerId || (await canManageTask(task.id, viewerId)).allowed)
  if (!isOrganizer && (task.host_suspended || task.blocked)) return null
  return { ...task, isOrganizer }
}

function questionJson(row, { isOrganizer, viewerId }) {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    answeredAt: row.answered_at,
    createdAt: row.created_at,
    mine: Boolean(viewerId) && row.asker_id === viewerId,
    ...(isOrganizer ? { hidden: row.hidden, askerName: displayName(row.asker_name) } : {}),
  }
}

// GET: the questions this viewer may see. Works signed out (answered only).
router.get('/public-tasks/:id/questions', limiter, requireDb, authenticate, async (req, res) => {
  try {
    const viewerId = req.auth?.sub || null
    const task = await questionTaskFor(req.params.id, viewerId)
    if (!task) return res.status(404).json({ error: 'Task not found.' })
    const { rows } = task.isOrganizer
      ? await query(
        `SELECT q.*, u.name AS asker_name FROM task_questions q JOIN users u ON u.id = q.asker_id
          WHERE q.task_id = $1 ORDER BY (q.answer IS NULL) DESC, q.created_at DESC`,
        [task.id],
      )
      : await query(
        `SELECT q.id, q.asker_id, q.question, q.answer, q.answered_at, q.created_at FROM task_questions q
          WHERE q.task_id = $1 AND NOT q.hidden
            AND (q.answer IS NOT NULL ${viewerId ? 'OR q.asker_id = $2' : ''})
          ORDER BY q.created_at DESC`,
        viewerId ? [task.id, viewerId] : [task.id],
      )
    return res.json({
      questions: rows.map((r) => questionJson(r, { isOrganizer: task.isOrganizer, viewerId })),
      isOrganizer: task.isOrganizer,
      canAsk: !task.isOrganizer && req.auth?.role === 'student' && task.status === 'open',
      readOnly: task.status === 'cancelled',
    })
  } catch (error) {
    console.error('list task questions failed:', error)
    return res.status(500).json({ error: 'Could not load questions.' })
  }
})

// POST { question }: a student asks the organizer.
router.post('/public-tasks/:id/questions', askLimiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const text = typeof req.body?.question === 'string' ? req.body.question.trim() : ''
    if (!text) return res.status(400).json({ error: 'Write a question first.' })
    if (text.length > QUESTION_MAX) return res.status(400).json({ error: `Keep your question under ${QUESTION_MAX} characters.` })
    const task = await questionTaskFor(req.params.id, req.auth.sub)
    if (!task) return res.status(404).json({ error: 'Task not found.' })
    if (task.isOrganizer) return res.status(400).json({ error: 'This is your task — you answer questions here.' })
    if (task.status !== 'open') return res.status(400).json({ error: 'This task isn\'t taking questions.' })
    // Hidden ones count too, so hiding a question doesn't hand back a slot.
    const { rows: open } = await query(
      'SELECT COUNT(*)::int AS n FROM task_questions WHERE task_id = $1 AND asker_id = $2 AND answer IS NULL',
      [task.id, req.auth.sub],
    )
    if (open[0].n >= OPEN_QUESTIONS_PER_TASK) {
      return res.status(429).json({ error: `You have ${OPEN_QUESTIONS_PER_TASK} questions waiting for an answer on this task. Wait for a reply first.` })
    }
    const { rows } = await query(
      `INSERT INTO task_questions (id, task_id, asker_id, question) VALUES ($1, $2, $3, $4)
       RETURNING id, asker_id, question, answer, answered_at, created_at`,
      [uid('tq'), task.id, req.auth.sub, text],
    )
    notify(task.created_by, {
      kind: 'task_question',
      title: `New question on "${task.title}"`,
      body: text,
      link: '/my-tasks',
    })
    return res.status(201).json({ question: questionJson(rows[0], { isOrganizer: false, viewerId: req.auth.sub }) })
  } catch (error) {
    console.error('ask task question failed:', error)
    return res.status(500).json({ error: 'Could not send your question.' })
  }
})

// PUT { answer, hidden? }: the organizer answers or edits the answer, and/or
// hides or unhides the question. An empty answer leaves it unanswered.
router.put('/public-tasks/:id/questions/:qid/answer', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const task = await questionTaskFor(req.params.id, req.auth.sub)
    if (!task) return res.status(404).json({ error: 'Task not found.' })
    if (!task.isOrganizer) return res.status(403).json({ error: 'Only the task\'s organizer can answer.' })
    if (task.status === 'cancelled') return res.status(400).json({ error: 'This task was cancelled.' })
    if (task.host_suspended) return res.status(403).json({ error: 'Your account can\'t post right now.' })
    const hasAnswer = req.body?.answer !== undefined
    const answer = typeof req.body?.answer === 'string' ? req.body.answer.trim() : ''
    if (hasAnswer && typeof req.body.answer !== 'string') return res.status(400).json({ error: 'Invalid answer.' })
    if (answer.length > ANSWER_MAX) return res.status(400).json({ error: `Keep your answer under ${ANSWER_MAX} characters.` })
    const hidden = typeof req.body?.hidden === 'boolean' ? req.body.hidden : null
    if (!hasAnswer && hidden === null) return res.status(400).json({ error: 'Nothing to change.' })
    const { rows: before } = await query(
      'SELECT answer FROM task_questions WHERE id = $1 AND task_id = $2',
      [req.params.qid, task.id],
    )
    if (before.length === 0) return res.status(404).json({ error: 'Question not found.' })
    const { rows } = await query(
      `UPDATE task_questions q SET
              answer = CASE WHEN $3::boolean THEN NULLIF($4, '') ELSE q.answer END,
              answered_at = CASE WHEN $3::boolean THEN (CASE WHEN $4 = '' THEN NULL ELSE now() END) ELSE q.answered_at END,
              hidden = COALESCE($5::boolean, q.hidden)
        WHERE q.id = $1 AND q.task_id = $2
        RETURNING q.*, (SELECT name FROM users WHERE id = q.asker_id) AS asker_name`,
      [req.params.qid, task.id, hasAnswer, answer, hidden],
    )
    const row = rows[0]
    // First answer only: an edit doesn't ring the bell again.
    if (hasAnswer && answer && !before[0].answer && !row.hidden) {
      notify(row.asker_id, {
        kind: 'task_answer',
        title: `Your question on "${task.title}" was answered`,
        body: answer,
        link: `/opportunities?task=${encodeURIComponent(task.id)}`,
      })
    }
    return res.json({ question: questionJson(row, { isOrganizer: true, viewerId: req.auth.sub }) })
  } catch (error) {
    console.error('answer task question failed:', error)
    return res.status(500).json({ error: 'Could not save the answer.' })
  }
})

// DELETE: the organizer removes any question on their task; an asker may
// withdraw their own.
router.delete('/public-tasks/:id/questions/:qid', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const task = await questionTaskFor(req.params.id, req.auth.sub)
    if (!task) return res.status(404).json({ error: 'Task not found.' })
    const { rowCount } = task.isOrganizer
      ? await query('DELETE FROM task_questions WHERE id = $1 AND task_id = $2', [req.params.qid, task.id])
      : await query('DELETE FROM task_questions WHERE id = $1 AND task_id = $2 AND asker_id = $3', [req.params.qid, task.id, req.auth.sub])
    if (rowCount === 0) return res.status(404).json({ error: 'Question not found.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('delete task question failed:', error)
    return res.status(500).json({ error: 'Could not delete the question.' })
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

// --- Thank-you notes ------------------------------------------------------------
//
// Once a task's day is over its organizer can send one short note of thanks to
// the volunteers who showed up (SHOWED_UP_SQL — the reading ratings use, so
// absent or excused volunteers get nothing). One per task: task_thanks.task_id
// is the key. Each recipient gets a bell entry and their own email; the note
// also shows on that task in their Attendance. Not to anyone who blocked the
// organizer, and not from a suspended organizer (server/routes/reports.js).

const THANKS_MAX = 500

router.post('/public-tasks/:id/thanks', taskMailLimiter, requireDb, requireAuth(), async (req, res) => {
  const raw = req.body?.message
  if (raw != null && typeof raw !== 'string') return res.status(400).json({ error: 'The note must be text.' })
  const message = String(raw || '').trim()
  if (!message) return res.status(400).json({ error: 'Write a short note first.' })
  if (message.length > THANKS_MAX) return res.status(400).json({ error: `Keep the note to ${THANKS_MAX} characters.` })

  try {
    const { rows } = await query(
      `SELECT t.id, t.created_by, t.status, t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location, t.creator_name,
              t.date < CURRENT_DATE AS is_past, o.posting_suspended_at
         FROM public_tasks t LEFT JOIN users o ON o.id = t.created_by
        WHERE t.id = $1`,
      [req.params.id],
    )
    const task = rows[0]
    if (!task) return res.status(404).json({ error: 'Task not found.' })
    if (task.created_by !== req.auth.sub) return res.status(403).json({ error: 'Only the task creator can thank its volunteers.' })
    if (task.posting_suspended_at) return res.status(403).json({ error: 'Your account can\'t contact volunteers right now.' })
    if (task.status === 'cancelled') return res.status(400).json({ error: 'This event was cancelled.' })
    if (!task.is_past) return res.status(400).json({ error: 'You can send a thank-you once the task\'s day is over.' })

    const { rows: people } = await query(
      `SELECT u.id, u.email, u.name, u.language, u.parental_consent_status
         FROM public_task_signups s JOIN users u ON u.id = s.user_id
        WHERE s.task_id = $1 AND ${SHOWED_UP_SQL}
          AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = s.user_id AND b.blocked_id = $2)`,
      [task.id, req.auth.sub],
    )
    if (people.length === 0) return res.status(400).json({ error: 'No volunteers were marked present or checked in on this task.' })

    // The insert is the claim: two clicks racing can't both send.
    const { rows: saved } = await query(
      `INSERT INTO task_thanks (task_id, sender_id, message) VALUES ($1, $2, $3)
       ON CONFLICT (task_id) DO NOTHING
       RETURNING to_char(sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS sent_at`,
      [task.id, req.auth.sub, message],
    )
    if (saved.length === 0) return res.status(409).json({ error: 'You already sent a thank-you for this task.' })

    res.json({ ok: true, sentAt: saved[0].sent_at, recipients: people.length })
    deliverThanks(task, people, message)
  } catch (error) {
    console.error('task thanks failed:', error)
    if (!res.headersSent) return res.status(500).json({ error: 'Could not send your thank-you.' })
  }
})

// Fire-and-forget, after the response: one bell entry and one email per
// person. The bell skips an under-13 still waiting on a parent, as the email
// does; the email also skips the @test.com fixtures.
async function deliverThanks(task, people, message) {
  const from = task.creator_name || 'The organizer'
  const site = String(process.env.FRONTEND_URL || '').split(',')[0].trim().replace(/\/$/, '')
  const seen = new Set()
  for (const p of people) {
    if (p.parental_consent_status === 'pending') continue
    notify(p.id, {
      kind: 'task_thanks',
      title: task.title,
      body: `${from}: ${message}`,
      link: '/attendance',
    })
    const email = String(p.email || '').trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    if (email.endsWith('@test.com')) {
      console.log(`[thanks] skipped @test.com fixture ${email}: ${task.title}`)
      continue
    }
    try {
      const lang = emailLang(p.language)
      await sendEmail({
        to: email,
        subject: et(lang, 'Thank you for volunteering: {title}', { title: task.title }),
        html: taskEmailHtml({
          lang,
          heading: et(lang, 'A thank-you from {from}', { from: task.creator_name || et(lang, 'The organizer') }),
          lines: [emailHi(lang, p.name), message],
          task,
          link: site ? `${site}/attendance` : undefined,
          linkLabel: et(lang, 'See it in VolunTrack'),
        }),
      })
    } catch (error) { console.error('thank-you email failed:', error) }
  }
}

// List tasks the current user signed up for (as a participant), with their
// signup + attendance status. Unlike GET /public-tasks, this isn't limited to
// status = 'open' — closed/past tasks still show so attendance stays visible.
router.get('/public-tasks/signups/mine', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query(
      // The organizer's email only reaches volunteers they approved — it is who
      // those students ask to sign off their hours on the task.
      `SELECT t.id, t.title, t.location, t.latitude, t.longitude, t.is_online, t.is_outdoor, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.creator_name, t.status AS task_status,
              CASE WHEN s.status = 'approved' THEN t.creator_email END AS creator_email,
              -- Day-of details (#438), approved volunteers only.
              CASE WHEN s.status = 'approved' THEN t.meeting_point END AS meeting_point,
              CASE WHEN s.status = 'approved' THEN t.day_of_contact END AS day_of_contact,
              s.late_eta_minutes, s.late_at, s.checked_in_at,
              s.status AS signup_status, s.attendance_status, s.attendance_marked_at, s.signed_up_at,
              ${WAITLIST_POSITION_SQL('t.id', 's.user_id')} AS waitlist_position,
              ${RATING_OPEN_SQL} AS can_rate,
              (SELECT json_build_object('stars', r.stars, 'comment', r.comment, 'updated_at', r.updated_at)
                 FROM task_ratings r WHERE r.task_id = t.id AND r.user_id = s.user_id) AS my_rating,
              -- The organizer's thank-you, only to those it was sent to: who
              -- showed up and hasn't blocked the organizer.
              (SELECT json_build_object('message', th.message, 'sent_at', to_char(th.sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
                 FROM task_thanks th
                WHERE th.task_id = t.id AND ${SHOWED_UP_SQL}
                  AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = s.user_id AND b.blocked_id = t.created_by)) AS thanks
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

// Log hours for a volunteer on a task (the creator or a co-host, no approval needed)
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
    if (refuseTaskAccess(res, await canManageTask(task.id, req.auth.sub), "Only the task's organizer or a co-host can show the check-in code.")) return
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
    if (refuseTaskAccess(res, await canManageTask(task.id, req.auth.sub), "Only the task's organizer or a co-host can check volunteers out.")) return
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
    if (refuseTaskAccess(res, await canManageTask(req.params.id, req.auth.sub), "Only the task's organizer or a co-host can log hours.")) return

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
    if (refuseTaskAccess(res, await canManageTask(req.params.id, req.auth.sub), "Only the task's organizer or a co-host can log hours.")) return

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
    const access = await canManageTask(req.params.id, req.auth.sub)
    if (refuseTaskAccess(res, access, "Only the task's organizer or a co-host can view logs.")) return

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

// List every student approved on a task I created or co-host, with their recent logs —
// lets a volunteer review and approve/reject hours a student logged themselves,
// not just log hours on the student's behalf (see log-hours/log-hours-batch above).
router.get('/my-students', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows: signups } = await query(
      `SELECT DISTINCT u.id, u.name, u.email
       FROM public_task_signups s
       JOIN public_tasks t ON t.id = s.task_id
       JOIN users u ON u.id = s.user_id
       WHERE ${MANAGED_BY_SQL('t', '$1')} AND s.status = 'approved'
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
       WHERE l.user_id = ANY($1::text[]) AND ${MANAGED_BY_SQL('t', '$2')}
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

// Validates a decision request body shared by the single and bulk verify
// routes. Returns an error message, or null when the decision is acceptable.
function verifyDecisionError(status, signature) {
  if (!['approved', 'rejected'].includes(status)) return 'status must be approved or rejected.'
  // An approval is a sign-off, so it carries the organizer's signature — the
  // same rule as the supervisor's emailed link. A rejection needs none.
  if (status === 'approved' && !isSignatureImage(signature)) return 'Sign to approve these hours.'
  return null
}

// Records an organizer's decision on one student's log. Shared by the single
// and bulk verify routes so both apply exactly the same authorization and side
// effects. An expected refusal is returned, not thrown, as
// { ok: false, httpStatus, error, ...extra }; an unexpected database error
// still throws and the caller decides how to report it.
async function verifyStudentLog({ organizerId, studentId, logId, status, signature }) {
  const { rows: relRows } = await query(
    `SELECT 1 FROM public_task_signups s JOIN public_tasks t ON t.id = s.task_id
     WHERE ${MANAGED_BY_SQL('t', '$1')} AND s.user_id = $2 AND s.status = 'approved'`,
    [organizerId, studentId],
  )
  if (relRows.length === 0) return { ok: false, httpStatus: 403, error: 'This student is not approved on any of your tasks.' }

  const { rows: logRows } = await query('SELECT task_id FROM logs WHERE id = $1 AND user_id = $2', [logId, studentId])
  if (logRows.length === 0) return { ok: false, httpStatus: 404, error: 'Log not found.' }
  const { rows: ownsTask } = await query(
    `SELECT 1 FROM public_tasks t WHERE t.id = $1 AND ${MANAGED_BY_SQL('t', '$2')}`,
    [logRows[0].task_id, organizerId],
  )
  if (ownsTask.length === 0) return { ok: false, httpStatus: 403, error: 'This log is not for one of your tasks.' }

  // What (if anything) had already been recorded, so the caller can tell
  // this was a change rather than a first decision.
  const { rows: beforeRows } = await query(
    'SELECT verification_status, verification_token FROM logs WHERE id = $1',
    [logId],
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
    [logId, beforeRows[0]?.verification_token ?? null],
  )
  if (rejectedBySupervisor[0] && status === 'approved') {
    const who = rejectedBySupervisor[0].supervisor_name || 'The supervisor'
    const when = rejectedBySupervisor[0].responded_at
      ? new Date(rejectedBySupervisor[0].responded_at).toISOString().slice(0, 10)
      : null
    return {
      ok: false,
      httpStatus: 409,
      error: `${who} rejected these hours${when ? ` on ${when}` : ''}. A supervisor's rejection is final, so these hours cannot be approved here.`,
      supervisorStatus: 'rejected',
    }
  }

  await query(
    'UPDATE logs SET verification_status = $1, verified_by = $2, organizer_signature = $4 WHERE id = $3',
    [status, organizerId, logId, status === 'approved' ? signature : null],
  )
  if (status !== previousStatus) notifyHoursDecision(studentId, logId, status)

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
    [logId, beforeRows[0]?.verification_token ?? null],
  )

  return { ok: true, previousStatus, supersededSupervisorLinks: superseded.length }
}

// Approve or reject a specific log entry for a student approved on one of my tasks.
router.post('/students/:studentId/logs/:logId/verify', limiter, requireDb, requireAuth(), async (req, res) => {
  const { status, signature } = req.body
  const invalid = verifyDecisionError(status, signature)
  if (invalid) return res.status(400).json({ error: invalid })

  try {
    const { httpStatus, ...result } = await verifyStudentLog({
      organizerId: req.auth.sub,
      studentId: req.params.studentId,
      logId: req.params.logId,
      status,
      signature,
    })
    if (!result.ok) {
      const { error, supervisorStatus } = result
      return res.status(httpStatus).json(supervisorStatus ? { error, supervisorStatus } : { error })
    }
    return res.json(result)
  } catch (error) {
    console.error('verify student log failed:', error)
    return res.status(500).json({ error: 'Could not update log.' })
  }
})

// Bulk approve/reject is one click that writes up to BULK_VERIFY_MAX decisions
// and bell notifications, so it gets its own tighter budget on top of the
// general limiter.
const BULK_VERIFY_MAX = 100
const bulkVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many bulk updates. Please try again later.' },
})

// Approve or reject several of my students' logs at once (My Tasks → My
// Students). Each item goes through verifyStudentLog() — the same checks and
// side effects as the single route — and is processed independently, so one
// refused item never fails the rest. Body:
// { items: [{ studentId, logId }], status | decision, signature? } — one
// signature covers every approval in the batch.
router.post('/logs/verify-bulk', limiter, bulkVerifyLimiter, requireDb, requireAuth(), async (req, res) => {
  const { items, signature } = req.body || {}
  const status = req.body?.status ?? req.body?.decision
  const invalid = verifyDecisionError(status, signature)
  if (invalid) return res.status(400).json({ error: invalid })
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items must be a non-empty list.' })
  // Checked on the raw list too, so a huge body can't make us walk it.
  if (items.length > BULK_VERIFY_MAX * 2) {
    return res.status(400).json({ error: `At most ${BULK_VERIFY_MAX} entries can be updated at once.` })
  }

  // Dedupe on the log id: a log belongs to exactly one student, so a repeated
  // logId is the same decision twice.
  const seen = new Set()
  const unique = []
  for (const item of items) {
    const studentId = typeof item?.studentId === 'string' ? item.studentId.trim() : ''
    const logId = typeof item?.logId === 'string' ? item.logId.trim() : ''
    if (!studentId || !logId || studentId.length > 100 || logId.length > 100) {
      return res.status(400).json({ error: 'Each item needs a studentId and a logId.' })
    }
    if (seen.has(logId)) continue
    seen.add(logId)
    unique.push({ studentId, logId })
  }
  if (unique.length > BULK_VERIFY_MAX) {
    return res.status(400).json({ error: `At most ${BULK_VERIFY_MAX} entries can be updated at once.` })
  }

  const results = []
  for (const { studentId, logId } of unique) {
    try {
      const result = await verifyStudentLog({ organizerId: req.auth.sub, studentId, logId, status, signature })
      results.push(result.ok ? { logId, ok: true } : { logId, ok: false, error: result.error })
    } catch (error) {
      console.error('bulk verify student log failed:', error)
      results.push({ logId, ok: false, error: 'Could not update log.' })
    }
  }
  const succeeded = results.filter((r) => r.ok).length
  return res.json({ status, succeeded, failed: results.length - succeeded, results })
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

// Mark attendance for a signed-up student on a task I created or co-host.
router.post('/public-tasks/:id/attendance/:userId', limiter, requireDb, requireAuth(), async (req, res) => {
  const { status } = req.body
  if (!['present', 'absent', 'excused'].includes(status)) return res.status(400).json({ error: 'status must be present, absent, or excused.' })

  try {
    const access = await canManageTask(req.params.id, req.auth.sub)
    if (refuseTaskAccess(res, access, "Only the task's organizer or a co-host can mark attendance.")) return

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

// --- Co-hosts (#440) -----------------------------------------------------------
//
// The creator adds up to COHOST_MAX Task Makers by email; each can then do the
// day-to-day organizer work (canManageTask() in ../taskCohosts.js). The add
// refuses with one generic message for anyone who can't be a co-host, so the
// form never tells the creator whether an address has an account.

const cohostLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => (req.auth?.sub ? `user:${req.auth.sub}` : `ip:${req.ip}`),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many co-host changes. Please try again later.' },
})

async function cohostList(taskId) {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, c.created_at
       FROM task_cohosts c JOIN users u ON u.id = c.user_id
      WHERE c.task_id = $1 ORDER BY c.created_at, u.id`,
    [taskId],
  )
  return rows.map((r) => ({ id: r.id, name: r.name, email: r.email, addedAt: r.created_at }))
}

// GET: the task's co-hosts, for its creator and its co-hosts.
router.get('/public-tasks/:id/cohosts', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const access = await canManageTask(req.params.id, req.auth.sub)
    if (refuseTaskAccess(res, access, "Only the task's organizer or a co-host can see its co-hosts.")) return
    return res.json({ cohosts: await cohostList(req.params.id), max: COHOST_MAX, isCreator: access.isCreator })
  } catch (error) {
    console.error('list cohosts failed:', error)
    return res.status(500).json({ error: 'Could not load the co-hosts.' })
  }
})

// POST { email }: the creator adds a co-host.
router.post('/public-tasks/:id/cohosts', cohostLimiter, requireDb, requireAuth(), async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  if (!email || email.length > 254 || !validator.isEmail(email)) return res.status(400).json({ error: 'Enter an email address.' })
  const client = await getPool().connect()
  let added = null
  let task = null
  try {
    await client.query('BEGIN')
    // The task row lock serializes adds, so two at once can't pass the cap.
    const { rows: taskRows } = await client.query(
      'SELECT id, created_by, status, title, creator_name FROM public_tasks WHERE id = $1 FOR UPDATE',
      [req.params.id],
    )
    task = taskRows[0]
    if (!task) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Task not found.' }) }
    if (task.created_by !== req.auth.sub) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Only the task creator can add co-hosts.' }) }
    if (task.status === 'cancelled') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'This task was cancelled.' }) }
    const { rows: count } = await client.query('SELECT COUNT(*)::int AS n FROM task_cohosts WHERE task_id = $1', [task.id])
    if (count[0].n >= COHOST_MAX) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: `A task can have up to ${COHOST_MAX} co-hosts.` })
    }
    // Not found, the wrong kind of account, suspended or the creator
    // themselves: all one answer (COHOST_GENERIC_REFUSAL).
    const { rows: people } = await client.query(
      `SELECT id, name FROM users
        WHERE LOWER(email) = $1 AND role = ANY($2::text[]) AND posting_suspended_at IS NULL AND id <> $3
        LIMIT 1`,
      [email, COHOST_ROLES, req.auth.sub],
    )
    const person = people[0]
    if (!person) { await client.query('ROLLBACK'); return res.status(400).json({ error: COHOST_GENERIC_REFUSAL }) }
    // Someone signed up to volunteer can't also approve their own sign-up.
    // The creator already sees this person in the sign-up list.
    const { rows: signedUp } = await client.query(
      "SELECT 1 FROM public_task_signups WHERE task_id = $1 AND user_id = $2 AND status NOT IN ('rejected', 'parent_declined')",
      [task.id, person.id],
    )
    if (signedUp.length > 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: "That person is signed up to volunteer on this task, so they can't co-host it." })
    }
    const { rows: inserted } = await client.query(
      'INSERT INTO task_cohosts (task_id, user_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING user_id',
      [task.id, person.id, req.auth.sub],
    )
    await client.query('COMMIT')
    if (inserted.length > 0) added = person
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { /* connection already broken */ }
    console.error('add cohost failed:', error)
    return res.status(500).json({ error: 'Could not add the co-host.' })
  } finally {
    client.release()
  }
  if (added) {
    notify(added.id, {
      kind: 'cohost_added',
      title: task.title,
      body: `${task.creator_name || 'The organizer'} added you as a co-host. Help run it from My Tasks.`,
      link: '/my-tasks',
    })
  }
  try {
    return res.status(added ? 201 : 200).json({ ok: true, cohosts: await cohostList(task.id), max: COHOST_MAX })
  } catch {
    return res.json({ ok: true })
  }
})

// DELETE: the creator removes a co-host, or a co-host leaves.
router.delete('/public-tasks/:id/cohosts/:userId', cohostLimiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const leaving = req.params.userId === req.auth.sub
    const { rows } = await query('SELECT created_by FROM public_tasks WHERE id = $1', [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'Task not found.' })
    if (!leaving && rows[0].created_by !== req.auth.sub) {
      return res.status(403).json({ error: 'Only the task creator can remove co-hosts.' })
    }
    const { rowCount } = await query('DELETE FROM task_cohosts WHERE task_id = $1 AND user_id = $2', [req.params.id, req.params.userId])
    if (rowCount === 0) return res.status(404).json({ error: leaving ? "You aren't a co-host of this task." : "That person isn't a co-host of this task." })
    return res.json({ ok: true })
  } catch (error) {
    console.error('remove cohost failed:', error)
    return res.status(500).json({ error: 'Could not remove the co-host.' })
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
      `SELECT s.id, s.name, s.pin, s.account_code, s.contact_email, s.plan, s.payment_status, s.payment_notes, s.admin_notes, s.paid_at, s.payment_due_date, s.payment_confirmation_ref, s.price_amount, s.price_period, s.created_at,
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

// Switch a school between the free club plan and the paid school plan (#506).
// Moving a club to 'school' makes the payment lock apply, so invoice it first.
router.patch('/admin/:id/plan', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const plan = String(req.body.plan || '')
  if (!PLANS.includes(plan)) return res.status(400).json({ error: 'Plan must be club or school.' })
  try {
    if (plan === 'club') {
      const n = await clubStudentCount(req.params.id)
      if (n > CLUB_STUDENT_LIMIT) {
        return res.status(409).json({ error: `This school has ${n} students, more than a free club's ${CLUB_STUDENT_LIMIT}. It can't be a club.` })
      }
    }
    const { rowCount } = await query('UPDATE schools SET plan = $1 WHERE id = $2', [plan, req.params.id])
    if (rowCount === 0) return res.status(404).json({ error: 'School not found.' })
    return res.json({ ok: true, plan })
  } catch (error) {
    console.error('admin plan update failed:', error)
    return res.status(500).json({ error: 'Could not change plan.' })
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
    const { rows: paid } = await query('SELECT payment_status, plan FROM schools WHERE id = $1', [schoolId])
    if (!schoolIsActive(paid[0])) return { unpaid: true }
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
