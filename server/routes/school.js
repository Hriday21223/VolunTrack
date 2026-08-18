import express from 'express'
import rateLimit from 'express-rate-limit'
import validator from 'validator'
import { query, hasDatabase } from '../db.js'
import { uid, generateToken } from '../ids.js'
import { hashPassword, verifyPassword, signToken, requireAuth, authenticate } from '../auth.js'
import { sendEmail } from '../email.js'
import { escapeHtml } from '../html.js'

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
router.post('/register', limiter, requireDb, async (req, res) => {
  const name = String(req.body.name || '').trim()
  const email = String(req.body.email || '').trim().toLowerCase()
  const password = req.body.password
  const pin = String(req.body.pin || '').trim().toLowerCase()
  const inviteToken = req.body.inviteToken ? String(req.body.inviteToken).trim() : null

  if (!name || name.length > 100) return res.status(400).json({ error: 'School name is required.' })
  if (!email || !validator.isEmail(email) || email.length > 254) return res.status(400).json({ error: 'Valid email required.' })
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' })
  if (!pin || !/^[a-z]+-?\d{3,5}$/.test(pin)) return res.status(400).json({ error: 'School code must be letters followed by digits (e.g. cisd-12345).' })

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

    const schoolId = uid('sch')
    await query(
      'INSERT INTO schools (id, name, pin, contact_email, organization_id) VALUES ($1, $2, $3, $4, $5)',
      [schoolId, name, pin, email, invite?.organization_id || null],
    )

    const hash = await hashPassword(password)
    const userId = uid('usr')
    const { rows } = await query(
      `INSERT INTO users (id, role, name, email, password_hash, school_id)
       VALUES ($1, 'school', $2, $3, $4, $5)
       RETURNING *`,
      [userId, name, email, hash, schoolId],
    )

    if (invite) {
      await query(`UPDATE school_invites SET status = 'completed' WHERE id = $1`, [invite.id])
    }

    const user = { id: rows[0].id, role: rows[0].role, name: rows[0].name, email: rows[0].email, schoolId: rows[0].school_id, grade: rows[0].grade }
    return res.status(201).json({ token: signToken(user), user })
  } catch (error) {
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
router.post('/join', limiter, requireDb, requireAuth(), async (req, res) => {
  const pin = String(req.body.pin || '').trim().toLowerCase()

  if (!pin) return res.status(400).json({ error: 'School code is required.' })

  try {
    const { rows } = await query('SELECT id FROM schools WHERE pin = $1', [pin])
    if (rows.length === 0) return res.status(404).json({ error: 'No school found with that code.' })

    await query('UPDATE users SET school_id = $1 WHERE id = $2', [rows[0].id, req.auth.sub])
    return res.json({ ok: true, schoolId: rows[0].id })
  } catch (error) {
    console.error('school join failed:', error)
    return res.status(500).json({ error: 'Could not join school.' })
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
    return res.json({ students: rows })
  } catch (error) {
    console.error('school students failed:', error)
    return res.status(500).json({ error: 'Could not fetch students.' })
  }
})

// Add a student to the school by email (school admin only)
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

    await query('UPDATE users SET school_id = $1 WHERE id = $2', [userRows[0].school_id, target[0].id])
    return res.json({ ok: true })
  } catch (error) {
    console.error('add-student failed:', error)
    return res.status(500).json({ error: 'Could not add student.' })
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
    return res.json({ ok: true })
  } catch (error) {
    console.error('remove school staff failed:', error)
    return res.status(500).json({ error: 'Could not remove co-admin.' })
  }
})

// Upload a PDF (student or admin)
router.post('/upload', limiter, requireDb, requireAuth('student', 'admin'), async (req, res, next) => {
  if (req.auth.role === 'admin') return next()
  return requirePaidSchool(req, res, next)
}, async (req, res) => {
  const { filename, fileData, fileType } = req.body

  if (!filename || !fileData) return res.status(400).json({ error: 'Filename and file data required.' })

  try {
    const { rows: userRows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
    let schoolId = userRows[0]?.school_id
    if (!schoolId && req.body.schoolId) schoolId = req.body.schoolId
    if (!schoolId) return res.status(400).json({ error: 'No school linked to your account.' })

    const id = uid('pdf')
    await query(
      `INSERT INTO pdf_uploads (id, user_id, school_id, filename, file_data, file_type)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, req.auth.sub, schoolId, filename, fileData, fileType || 'application/pdf'],
    )
    return res.status(201).json({ ok: true, id })
  } catch (error) {
    console.error('pdf upload failed:', error)
    return res.status(500).json({ error: 'Could not upload file.' })
  }
})

// Get PDFs for a student (school admin can see all, student can see own)
router.get('/pdfs', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    if (req.auth.role === 'school') {
      const { rows: userRows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
      if (!userRows[0]?.school_id) return res.status(404).json({ error: 'School not found.' })
      const { rows } = await query(
        `SELECT p.id, p.user_id, u.name AS user_name, u.email AS user_email, p.filename, p.file_type, p.status, p.notes, p.created_at
         FROM pdf_uploads p JOIN users u ON p.user_id = u.id
         WHERE p.school_id = $1
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
    if (req.auth.role === 'student' && pdf.user_id !== req.auth.sub) {
      return res.status(403).json({ error: 'Not allowed.' })
    }
    if (req.auth.role === 'school') {
      const { rows: userRows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
      if (pdf.school_id !== userRows[0]?.school_id) return res.status(403).json({ error: 'Not allowed.' })
    }

    return res.json({ pdf: { id: pdf.id, filename: pdf.filename, fileData: pdf.file_data, fileType: pdf.file_type, status: pdf.status, notes: pdf.notes, createdAt: pdf.created_at } })
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

    await query(
      'UPDATE pdf_uploads SET status = $1, notes = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $4',
      [status, notes || null, req.auth.sub, req.params.id],
    )
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
    const cols = 'id, name, pin, payment_status, payment_notes, paid_at, payment_due_date, payment_confirmation_ref'
    let rows
    if (pin) {
      const r = await query(`SELECT ${cols} FROM schools WHERE pin = $1`, [pin])
      rows = r.rows
    } else {
      const r = await query(`SELECT ${cols} FROM schools WHERE id = $1`, [id])
      rows = r.rows
    }
    if (rows.length === 0) return res.status(404).json({ error: 'No school found.' })
    return res.json({ school: { id: rows[0].id, name: rows[0].name, pin: rows[0].pin, paymentStatus: rows[0].payment_status, paymentNotes: rows[0].payment_notes, paidAt: rows[0].paid_at, paymentDueDate: rows[0].payment_due_date, paymentConfirmationRef: rows[0].payment_confirmation_ref } })
  } catch (error) {
    return res.status(500).json({ error: 'Could not fetch school.' })
  }
})

// --- Public volunteer tasks (any user can post, any user can sign up) ---

// Create a public task (phone required)
router.post('/public-tasks', limiter, requireDb, requireAuth(), async (req, res) => {
  const { title, description, location, date, time, slotsTotal, phone, latitude, longitude, importantInfo } = req.body
  if (!title || !description || !location || !date) return res.status(400).json({ error: 'Title, description, location, and date required.' })
  if (!phone) return res.status(400).json({ error: 'Phone number is required so volunteers can reach you.' })

  try {
    const { rows } = await query('SELECT name, email FROM users WHERE id = $1', [req.auth.sub])
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' })

    const id = uid('ptask')
    await query(
      `INSERT INTO public_tasks (id, title, description, location, date, time, slots_total, created_by, creator_name, creator_email, phone, latitude, longitude, important_info)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [id, title, description, location, date, time || null, Number(slotsTotal) || 1, req.auth.sub, rows[0].name, rows[0].email, phone, latitude || null, longitude || null, importantInfo || null],
    )
    return res.status(201).json({ ok: true, id })
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
    const useDist = lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)

    const params = userId ? [userId] : []

    const distExpr = useDist
      ? `CASE WHEN t.latitude IS NOT NULL AND t.longitude IS NOT NULL THEN
           6371 * 2 * ASIN(SQRT(
             POWER(SIN(RADIANS(t.latitude - $${params.length + 1}) / 2), 2) +
             COS(RADIANS($${params.length + 1})) * COS(RADIANS(t.latitude)) *
             POWER(SIN(RADIANS(t.longitude - $${params.length + 2}) / 2), 2)
           ))
         ELSE NULL END AS distance`
      : 'NULL AS distance'

    const havingClause = useDist && maxDistance && !isNaN(maxDistance)
      ? `HAVING CASE WHEN t.latitude IS NOT NULL AND t.longitude IS NOT NULL THEN
           6371 * 2 * ASIN(SQRT(
             POWER(SIN(RADIANS(t.latitude - $${params.length + 1}) / 2), 2) +
             COS(RADIANS($${params.length + 1})) * COS(RADIANS(t.latitude)) *
             POWER(SIN(RADIANS(t.longitude - $${params.length + 2}) / 2), 2)
           ))
         ELSE 999999 END <= $${useDist ? params.length + 3 : params.length + 1}`
      : ''

    const selectParams = useDist ? [...params, lat, lng] : [...params]
    const havingParams = useDist && maxDistance ? [lat, lng, maxDistance] : []
    const orderParams = useDist ? [lat, lng] : []

    const { rows } = await query(
      `SELECT * FROM (
        SELECT t.id, t.title, t.description, t.location, t.date, t.time, t.slots_total, t.status,
               t.creator_name, t.latitude, t.longitude, ${distExpr}, t.created_at,
               (SELECT COUNT(*) FROM public_task_signups WHERE task_id = t.id) AS slots_filled,
               ${userId ? `(SELECT status FROM public_task_signups WHERE task_id = t.id AND user_id = $1) AS my_signup_status` : 'NULL AS my_signup_status'},
               ${userId ? `CASE WHEN (SELECT status FROM public_task_signups WHERE task_id = t.id AND user_id = $1) = 'approved' THEN t.phone ELSE NULL END AS phone` : 'NULL AS phone'},
               ${userId ? `CASE WHEN (SELECT status FROM public_task_signups WHERE task_id = t.id AND user_id = $1) = 'approved' THEN t.important_info ELSE NULL END AS important_info` : 'NULL AS important_info'}
        FROM public_tasks t
        WHERE t.status = 'open'
       ) sub
       ${havingClause}
       ${useDist ? `ORDER BY distance ASC NULLS LAST, date ASC, created_at DESC` : 'ORDER BY date ASC, created_at DESC'}`,
      [...selectParams, ...havingParams],
    )
    return res.json({ tasks: rows })
  } catch (error) {
    console.error('list public tasks failed:', error)
    return res.status(500).json({ error: 'Could not fetch tasks.' })
  }
})

// Sign up for a public task
router.post('/public-tasks/:id/signup', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM public_tasks WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'Task not found.' })
    if (rows[0].status === 'closed') return res.status(400).json({ error: 'Task is closed.' })

    const { rows: signups } = await query('SELECT COUNT(*) AS cnt FROM public_task_signups WHERE task_id = $1', [req.params.id])
    if (Number(signups[0].cnt) >= rows[0].slots_total) return res.status(400).json({ error: 'Task is full.' })

    const sid = uid('psig')
    await query(
      'INSERT INTO public_task_signups (id, task_id, user_id, status) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
      [sid, req.params.id, req.auth.sub, 'pending'],
    )
    return res.json({ ok: true, id: sid })
  } catch (error) {
    console.error('public task signup failed:', error)
    return res.status(500).json({ error: 'Could not sign up.' })
  }
})

// Approve a signup (organizer only) — reveals phone number to volunteer
router.post('/public-tasks/:id/approve/:userId', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows: taskRows } = await query('SELECT created_by FROM public_tasks WHERE id = $1', [req.params.id])
    if (taskRows.length === 0) return res.status(404).json({ error: 'Task not found.' })
    if (taskRows[0].created_by !== req.auth.sub) return res.status(403).json({ error: 'Only the task creator can approve signups.' })

    await query(
      "UPDATE public_task_signups SET status = 'approved' WHERE task_id = $1 AND user_id = $2",
      [req.params.id, req.params.userId],
    )
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

    await query(
      "UPDATE public_task_signups SET status = 'rejected' WHERE task_id = $1 AND user_id = $2",
      [req.params.id, req.params.userId],
    )
    return res.json({ ok: true })
  } catch (error) {
    console.error('reject signup failed:', error)
    return res.status(500).json({ error: 'Could not reject signup.' })
  }
})

// --- Organizer endpoints (my tasks + log hours for volunteers) ---

// List tasks I created, with signups (includes phone + signup status)
router.get('/public-tasks/mine', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT t.id, t.title, t.description, t.location, t.date, t.time, t.slots_total, t.status, t.phone, t.latitude, t.longitude, t.created_at,
              (SELECT COUNT(*) FROM public_task_signups WHERE task_id = t.id) AS slots_filled,
              (SELECT COALESCE(json_agg(json_build_object(
                'id', u.id, 'name', u.name, 'email', u.email, 'status', s.status, 'signed_up_at', s.signed_up_at,
                'attendance_status', s.attendance_status, 'attendance_marked_at', s.attendance_marked_at
              ) ORDER BY s.signed_up_at), '[]'::json)
               FROM public_task_signups s JOIN users u ON u.id = s.user_id WHERE s.task_id = t.id) AS signups
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

// List tasks the current user signed up for (as a participant), with their
// signup + attendance status. Unlike GET /public-tasks, this isn't limited to
// status = 'open' — closed/past tasks still show so attendance stays visible.
router.get('/public-tasks/signups/mine', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT t.id, t.title, t.location, t.date, t.time, t.creator_name, t.status AS task_status,
              s.status AS signup_status, s.attendance_status, s.attendance_marked_at, s.signed_up_at
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
router.post('/public-tasks/:id/log-hours', limiter, requireDb, requireAuth(), async (req, res) => {
  const { volunteerId, hours, date } = req.body
  if (!volunteerId || !hours) return res.status(400).json({ error: 'volunteerId and hours required.' })

  try {
    const { rows: taskRows } = await query('SELECT * FROM public_tasks WHERE id = $1', [req.params.id])
    if (taskRows.length === 0) return res.status(404).json({ error: 'Task not found.' })
    if (taskRows[0].created_by !== req.auth.sub) return res.status(403).json({ error: 'Only the task creator can log hours.' })

    const { rows: signupRows } = await query(
      'SELECT attendance_status FROM public_task_signups WHERE task_id = $1 AND user_id = $2',
      [req.params.id, volunteerId],
    )
    if (signupRows.length === 0) return res.status(400).json({ error: 'Volunteer is not signed up for this task.' })
    if (signupRows[0].attendance_status === 'absent') return res.status(400).json({ error: 'Cannot log hours for a volunteer marked absent.' })

    const lid = uid('log')
    await query(
      `INSERT INTO logs (id, user_id, date, activity, category, hours, notes, verified_by, task_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        lid,
        volunteerId,
        date || taskRows[0].date,
        taskRows[0].title,
        'volunteer',
        Number(hours),
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

  try {
    const { rows: taskRows } = await query('SELECT * FROM public_tasks WHERE id = $1', [req.params.id])
    if (taskRows.length === 0) return res.status(404).json({ error: 'Task not found.' })
    if (taskRows[0].created_by !== req.auth.sub) return res.status(403).json({ error: 'Only the task creator can log hours.' })

    const { rows: approvedRows } = await query(
      'SELECT user_id FROM public_task_signups WHERE task_id = $1 AND status = \'approved\' AND attendance_status IS DISTINCT FROM \'absent\'',
      [req.params.id],
    )
    const approvedIds = new Set(approvedRows.map((r) => r.user_id))

    let logged = 0
    for (const entry of entries) {
      if (!entry.volunteerId || !entry.hours) continue
      if (!approvedIds.has(entry.volunteerId)) continue

      const lid = uid('log')
      await query(
        `INSERT INTO logs (id, user_id, date, activity, category, hours, notes, verified_by, task_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          lid,
          entry.volunteerId,
          date || taskRows[0].date,
          taskRows[0].title,
          'volunteer',
          Number(entry.hours),
          `Logged by task organizer (${taskRows[0].title})`,
          req.auth.sub,
          req.params.id,
        ],
      )
      logged++
    }
    return res.status(201).json({ ok: true, logged })
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
  const { status } = req.body
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'status must be approved or rejected.' })

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

    await query(
      'UPDATE logs SET verification_status = $1, verified_by = $2 WHERE id = $3',
      [status, req.auth.sub, req.params.logId],
    )
    return res.json({ ok: true })
  } catch (error) {
    console.error('verify student log failed:', error)
    return res.status(500).json({ error: 'Could not update log.' })
  }
})

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
      `SELECT s.id, s.name, s.pin, s.contact_email, s.payment_status, s.payment_notes, s.admin_notes, s.paid_at, s.payment_due_date, s.payment_confirmation_ref, s.price_amount, s.price_period, s.created_at,
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
      `SELECT o.id, o.name, o.contact_email, o.created_at, o.price_amount, o.price_period, o.payment_due_date,
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
  const amount = String(req.body.amount ?? '').trim()
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
    if (status === 'paid') {
      await query(
        'UPDATE schools SET payment_status = $1, payment_notes = $2, paid_at = now() WHERE id = $3',
        [status, notes || null, req.params.id],
      )
      await query(
        `INSERT INTO payment_events (id, entity_type, entity_id, event_type, notes) VALUES ($1, 'school', $2, 'status_paid', $3)`,
        [uid('pev'), req.params.id, notes || null],
      )

      const { rows } = await query('SELECT contact_email FROM schools WHERE id = $1', [req.params.id])
      if (rows[0]?.contact_email) {
        const id = uid('anot')
        await sendEmail({
          to: rows[0].contact_email,
          subject: 'Payment confirmed — VolunTrack',
          html: `<p>Your payment confirmation has been verified. Your school's account is now unlocked — student uploads and management are available.</p>`,
          idempotencyKey: `payment-approved/${req.params.id}/${id}`,
        })
      }
    } else {
      await query(
        'UPDATE schools SET payment_status = $1, payment_notes = $2, paid_at = NULL WHERE id = $3',
        [status, notes || null, req.params.id],
      )
      await query(
        `INSERT INTO payment_events (id, entity_type, entity_id, event_type, notes) VALUES ($1, 'school', $2, $3, $4)`,
        [uid('pev'), req.params.id, status === 'unpaid' ? 'status_unpaid' : 'status_rejected', notes || null],
      )
    }

    // Rejected payments notify the school so they know to resubmit.
    if (status === 'rejected') {
      const id = uid('anot')
      const reason = notes.trim().replace(/\.+$/, '')
      const rejectMsg = `Your payment confirmation could not be verified: ${reason}. Please resubmit a valid bank confirmation number.`
      await query(
        'INSERT INTO admin_notifications (id, school_id, message) VALUES ($1, $2, $3)',
        [id, req.params.id, rejectMsg],
      )

      const { rows } = await query('SELECT contact_email FROM schools WHERE id = $1', [req.params.id])
      if (rows[0]?.contact_email) {
        await sendEmail({
          to: rows[0].contact_email,
          subject: 'Payment confirmation rejected — VolunTrack',
          html: `<p>${rejectMsg}</p>`,
          idempotencyKey: `payment-rejected/${req.params.id}/${id}`,
        })
      }
    }

    return res.json({ ok: true })
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
    await sendEmail({
      to: email,
      subject: 'You’re invited to set up your school on VolunTrack',
      html: `<p>${name} has been invited to join VolunTrack. Click the link below to finish setting up your school account — choose your password and school code.</p><p><a href="${link}">${link}</a></p><p>This link expires in ${INVITE_TTL_DAYS} days.</p>`,
      idempotencyKey: `school-invite/${id}`,
    })

    return res.status(201).json({ ok: true, id })
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
    await sendEmail({
      to: invite.email,
      subject: 'You’re invited to set up your school on VolunTrack',
      html: `<p>${invite.name} has been invited to join VolunTrack. Click the link below to finish setting up your school account — choose your password and school code.</p><p><a href="${link}">${link}</a></p><p>This link expires in ${INVITE_TTL_DAYS} days.</p>`,
      idempotencyKey: `school-invite-resend/${req.params.id}/${Date.now()}`,
    })

    return res.json({ ok: true })
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
  try {
    await query('UPDATE schools SET payment_due_date = $1 WHERE id = $2', [dueDate || null, req.params.id])
    return res.json({ ok: true })
  } catch (error) {
    console.error('set payment due date failed:', error)
    return res.status(500).json({ error: 'Could not set due date.' })
  }
})

// Builds the HTML body for a payment-request email: school name, optional
// amount owed, the school's due date on file (if any), free-text payment
// instructions from the admin, and a link back to the school dashboard
// where the admin submits their bank confirmation number.
const BILLING_PERIOD_LABELS = { monthly: '/ month', yearly: '/ year', one_time: 'one-time' }

function paymentNoticeHtml({ schoolName, amount, billingPeriod, dueDate, message }) {
  const dashboardLink = `${process.env.FRONTEND_URL || ''}/school/dashboard`
  const dueDateStr = dueDate ? new Date(dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : null
  const periodLabel = BILLING_PERIOD_LABELS[billingPeriod] || ''
  return [
    `<p>Hi ${escapeHtml(schoolName)},</p>`,
    `<p>This is a payment notice for your school's VolunTrack account.</p>`,
    `<table cellpadding="4" cellspacing="0">`,
    amount ? `<tr><td><strong>Amount owed</strong></td><td>${escapeHtml(amount)}${periodLabel ? ' ' + escapeHtml(periodLabel) : ''}</td></tr>` : '',
    dueDateStr ? `<tr><td><strong>Due date</strong></td><td>${dueDateStr}</td></tr>` : '',
    `</table>`,
    `<p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`,
    `<p>Once payment is complete, submit your bank confirmation or reference number from your school dashboard: <a href="${dashboardLink}">${dashboardLink}</a></p>`,
  ].join('')
}

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

    const { rows: schools } = await query('SELECT id, name, contact_email, payment_due_date, price_amount, price_period FROM schools WHERE contact_email IS NOT NULL')
    await Promise.all(schools.map((s) => sendEmail({
      to: s.contact_email,
      subject: 'Payment notice from VolunTrack',
      html: paymentNoticeHtml({
        schoolName: s.name,
        amount: amount || s.price_amount,
        billingPeriod: amount ? billingPeriod : s.price_period,
        dueDate: s.payment_due_date,
        message: message.trim(),
      }),
      idempotencyKey: `payment-notice/${s.id}/${id}`,
    })))

    return res.status(201).json({ ok: true, id })
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

    const { rows } = await query('SELECT name, contact_email, payment_due_date, price_amount, price_period FROM schools WHERE id = $1', [req.params.schoolId])
    if (rows[0]?.contact_email) {
      await sendEmail({
        to: rows[0].contact_email,
        subject: 'Payment notice from VolunTrack',
        html: paymentNoticeHtml({
          schoolName: rows[0].name,
          amount: amount || rows[0].price_amount,
          billingPeriod: amount ? billingPeriod : rows[0].price_period,
          dueDate: rows[0].payment_due_date,
          message: message.trim(),
        }),
        idempotencyKey: `payment-notice/${req.params.schoolId}/${id}`,
      })
    }

    return res.status(201).json({ ok: true, id })
  } catch (error) {
    console.error('notify school failed:', error)
    return res.status(500).json({ error: 'Could not send notification.' })
  }
})

// Get admin notifications (any auth user). If schoolId query param provided,
// returns notifications for that school + broadcast ones (school_id IS NULL).
router.get('/admin/notifications', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { schoolId } = req.query
    let rows
    if (schoolId) {
      const r = await query(
        'SELECT id, message, created_at FROM admin_notifications WHERE school_id IS NULL OR school_id = $1 ORDER BY created_at DESC LIMIT 50',
        [schoolId],
      )
      rows = r.rows
    } else {
      const r = await query(
        'SELECT id, message, created_at FROM admin_notifications ORDER BY created_at DESC LIMIT 50',
      )
      rows = r.rows
    }
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

export default router
