// Clubs and groups inside a school (#660): NHS, Key Club, Beta Club. A club
// has members (students at the school), advisers (the school's staff), and an
// optional hour goal for the school year. School staff manage clubs; a
// student sees the clubs they're in and their progress toward each goal.
import express from 'express'
import rateLimit from 'express-rate-limit'
import { perPersonKey } from '../rateKey.js'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { uid } from '../ids.js'
import { recordAudit, AUDIT } from '../audit.js'
import { notify } from '../notifications.js'

const router = express.Router()
const limiter = rateLimit({ keyGenerator: perPersonKey, windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please try again later.' } })
const requireDb = (_req, res, next) => (hasDatabase() ? next() : res.status(503).json({ error: 'Server database is not configured.' }))

export const MAX_CLUBS = 30
const MAX_MEMBERS = 500

// Aug 1 – Jul 31 of the current school year, as YYYY-MM-DD.
export function schoolYearRange(today = new Date()) {
  const y = today.getMonth() >= 7 ? today.getFullYear() : today.getFullYear() - 1
  return { from: `${y}-08-01`, to: `${y + 1}-07-31` }
}

async function mySchool(userId) {
  const { rows } = await query('SELECT school_id FROM users WHERE id = $1', [userId])
  return rows[0]?.school_id || null
}

async function clubAtSchool(clubId, schoolId) {
  const { rows } = await query('SELECT * FROM school_clubs WHERE id = $1 AND school_id = $2', [clubId, schoolId])
  return rows[0] || null
}

const cleanName = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 80)
function cleanGoal(v) {
  if (v === null || v === '' || v === undefined) return { ok: true, value: null }
  const n = Number(v)
  return Number.isFinite(n) && n > 0 && n <= 10000 ? { ok: true, value: n } : { ok: false }
}

// --- Assignments (#675) -------------------------------------------------------
// A teacher asks a club for hours (and optionally a reflection) by a due
// date. Students attach their own entries; an assignment is done when the
// attached, non-rejected hours reach its hours and, if asked, one attached
// entry has a reflection. Staff see only whether a reflection exists, never
// its text: reflections stay private to the student.
const MAX_ASSIGNMENTS_PER_CLUB = 50

function cleanAssignment(b = {}) {
  const title = String(b.title || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const details = String(b.details || '').trim().slice(0, 1000) || null
  const hours = Number(b.hours)
  const due = /^\d{4}-\d{2}-\d{2}$/.test(String(b.dueDate || '')) ? String(b.dueDate) : null
  if (!title) return { error: 'Give the assignment a title.' }
  if (!Number.isFinite(hours) || hours <= 0 || hours > 1000) return { error: 'Hours must be between 0 and 1000.' }
  return { title, details, hours, due, needsReflection: b.needsReflection === true }
}

// Per member: attached hours and whether a reflection is attached.
async function assignmentProgress(assignmentIds) {
  if (assignmentIds.length === 0) return []
  const { rows } = await query(
    `SELECT e.assignment_id, e.user_id,
            COALESCE(SUM(l.hours) FILTER (WHERE l.verification_status IS DISTINCT FROM 'rejected'), 0)::float8 AS hours,
            BOOL_OR(COALESCE(btrim(l.reflection), '') <> '') AS reflected,
            COUNT(*)::int AS entries
       FROM club_assignment_entries e JOIN logs l ON l.id = e.log_id AND l.user_id = e.user_id
      WHERE e.assignment_id = ANY($1::text[])
      GROUP BY e.assignment_id, e.user_id`,
    [assignmentIds],
  )
  return rows
}

const isDone = (a, p) => Boolean(p) && p.hours >= Number(a.hours) && (!a.needs_reflection || p.reflected)
const shapeAssignment = (a) => ({ id: a.id, title: a.title, details: a.details, hours: Number(a.hours), needsReflection: a.needs_reflection, dueDate: a.due_date })

// GET /api/clubs/mine/assignments — a student's assignments, their attached
// entries and progress, and recent entries they could attach.
router.get('/mine/assignments', limiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const { rows: list } = await query(
      `SELECT a.id, a.title, a.details, a.hours::float8 AS hours, a.needs_reflection, to_char(a.due_date, 'YYYY-MM-DD') AS due_date, c.name AS club_name
         FROM club_assignments a
         JOIN school_clubs c ON c.id = a.club_id
         JOIN club_members m ON m.club_id = c.id AND m.user_id = $1
         JOIN users u ON u.id = $1 AND u.school_id = c.school_id
        ORDER BY a.due_date NULLS LAST, a.created_at`,
      [req.auth.sub],
    )
    const { rows: attached } = await query(
      `SELECT e.assignment_id, l.id, to_char(l.date, 'YYYY-MM-DD') AS date, l.activity, l.hours::float8 AS hours, l.verification_status
         FROM club_assignment_entries e JOIN logs l ON l.id = e.log_id
        WHERE e.user_id = $1 ORDER BY l.date`,
      [req.auth.sub],
    )
    const progress = (await assignmentProgress(list.map((a) => a.id))).filter((p) => p.user_id === req.auth.sub)
    const { rows: recent } = await query(
      `SELECT id, to_char(date, 'YYYY-MM-DD') AS date, activity, hours::float8 AS hours FROM logs
        WHERE user_id = $1 AND verification_status IS DISTINCT FROM 'rejected' AND date >= current_date - 365
        ORDER BY date DESC, created_at DESC LIMIT 100`,
      [req.auth.sub],
    )
    return res.json({
      assignments: list.map((a) => {
        const p = progress.find((r) => r.assignment_id === a.id)
        return {
          ...shapeAssignment(a), club: a.club_name,
          done: isDone(a, p), attachedHours: p ? Math.round(p.hours * 100) / 100 : 0, reflected: Boolean(p?.reflected),
          entries: attached.filter((e) => e.assignment_id === a.id).map(({ assignment_id: _a, ...e }) => e),
        }
      }),
      recent,
    })
  } catch (error) {
    console.error('my assignments failed:', error)
    return res.status(500).json({ error: 'Could not load your assignments.' })
  }
})

// GET /api/clubs/:id/assignments — staff: each assignment and who's done.
router.get('/:id/assignments', limiter, requireDb, requireAuth('school', 'school_staff'), async (req, res) => {
  try {
    const schoolId = await mySchool(req.auth.sub)
    const club = schoolId && await clubAtSchool(req.params.id, schoolId)
    if (!club) return res.status(404).json({ error: 'Club not found.' })
    const { rows: list } = await query(
      `SELECT id, title, details, hours::float8 AS hours, needs_reflection, to_char(due_date, 'YYYY-MM-DD') AS due_date
         FROM club_assignments WHERE club_id = $1 ORDER BY due_date NULLS LAST, created_at`,
      [club.id],
    )
    const { rows: members } = await query(
      'SELECT u.id, u.name FROM club_members m JOIN users u ON u.id = m.user_id AND u.school_id = $2 WHERE m.club_id = $1 ORDER BY u.name',
      [club.id, schoolId],
    )
    const progress = await assignmentProgress(list.map((a) => a.id))
    recordAudit(req, { action: AUDIT.STUDENT_LIST_READ, schoolId, objectType: 'club_assignments', objectId: club.id, meta: { count: members.length } })
    return res.json({
      assignments: list.map((a) => ({
        ...shapeAssignment(a),
        members: members.map((m) => {
          const p = progress.find((r) => r.assignment_id === a.id && r.user_id === m.id)
          return { id: m.id, name: m.name, hours: p ? Math.round(p.hours * 100) / 100 : 0, reflected: Boolean(p?.reflected), done: isDone(a, p) }
        }),
      })),
    })
  } catch (error) {
    console.error('club assignments list failed:', error)
    return res.status(500).json({ error: 'Could not load the assignments.' })
  }
})

// POST /api/clubs/:id/assignments — { title, details?, hours, dueDate?, needsReflection? }
router.post('/:id/assignments', limiter, requireDb, requireAuth('school', 'school_staff'), async (req, res) => {
  const a = cleanAssignment(req.body)
  if (a.error) return res.status(400).json({ error: a.error })
  try {
    const schoolId = await mySchool(req.auth.sub)
    const club = schoolId && await clubAtSchool(req.params.id, schoolId)
    if (!club) return res.status(404).json({ error: 'Club not found.' })
    const { rows: n } = await query('SELECT COUNT(*)::int AS n FROM club_assignments WHERE club_id = $1', [club.id])
    if (n[0].n >= MAX_ASSIGNMENTS_PER_CLUB) return res.status(400).json({ error: `A club can have at most ${MAX_ASSIGNMENTS_PER_CLUB} assignments.` })
    const id = uid('asg')
    await query(
      `INSERT INTO club_assignments (id, club_id, title, details, hours, needs_reflection, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, club.id, a.title, a.details, a.hours, a.needsReflection, a.due, req.auth.sub],
    )
    const { rows: members } = await query('SELECT user_id FROM club_members WHERE club_id = $1', [club.id])
    for (const m of members) {
      notify(m.user_id, { kind: 'club_assignment', title: `${club.name}: ${a.title}`, body: `${a.hours} hours${a.due ? ` by ${a.due}` : ''}`, link: '/' })
    }
    return res.status(201).json({ id })
  } catch (error) {
    console.error('club assignment create failed:', error)
    return res.status(500).json({ error: 'Could not add the assignment.' })
  }
})

// DELETE /api/clubs/assignments/:aid — staff at the club's school.
router.delete('/assignments/:aid', limiter, requireDb, requireAuth('school', 'school_staff'), async (req, res) => {
  try {
    const schoolId = await mySchool(req.auth.sub)
    const { rowCount } = await query(
      'DELETE FROM club_assignments a USING school_clubs c WHERE a.id = $1 AND c.id = a.club_id AND c.school_id = $2',
      [req.params.aid, schoolId],
    )
    if (rowCount === 0) return res.status(404).json({ error: 'Assignment not found.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('club assignment delete failed:', error)
    return res.status(500).json({ error: 'Could not remove the assignment.' })
  }
})

// POST|DELETE /api/clubs/assignments/:aid/entries/:logId — a student attaches
// or removes one of their own entries, for an assignment in their club.
router.post('/assignments/:aid/entries/:logId', limiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT 1 FROM club_assignments a
         JOIN school_clubs c ON c.id = a.club_id
         JOIN club_members m ON m.club_id = c.id AND m.user_id = $2
         JOIN users u ON u.id = $2 AND u.school_id = c.school_id
         JOIN logs l ON l.id = $3 AND l.user_id = $2
        WHERE a.id = $1`,
      [req.params.aid, req.auth.sub, req.params.logId],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Assignment or entry not found.' })
    await query(
      'INSERT INTO club_assignment_entries (assignment_id, log_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [req.params.aid, req.params.logId, req.auth.sub],
    )
    return res.json({ ok: true })
  } catch (error) {
    console.error('attach entry failed:', error)
    return res.status(500).json({ error: 'Could not add that entry.' })
  }
})

router.delete('/assignments/:aid/entries/:logId', limiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    await query('DELETE FROM club_assignment_entries WHERE assignment_id = $1 AND log_id = $2 AND user_id = $3', [req.params.aid, req.params.logId, req.auth.sub])
    return res.json({ ok: true })
  } catch (error) {
    console.error('detach entry failed:', error)
    return res.status(500).json({ error: 'Could not remove that entry.' })
  }
})

// GET /api/clubs — the school's clubs with member counts and advisers.
router.get('/', limiter, requireDb, requireAuth('school', 'school_staff'), async (req, res) => {
  try {
    const schoolId = await mySchool(req.auth.sub)
    if (!schoolId) return res.status(403).json({ error: 'Your account is not linked to a school.' })
    const { rows } = await query(
      `SELECT c.id, c.name, c.goal_hours::float8 AS goal_hours, c.created_at,
              (SELECT COUNT(*)::int FROM club_members m WHERE m.club_id = c.id) AS members,
              (SELECT COALESCE(json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.name), '[]')
                 FROM club_advisers a JOIN users u ON u.id = a.user_id WHERE a.club_id = c.id) AS advisers,
              (SELECT COALESCE(array_agg(m.user_id), '{}') FROM club_members m WHERE m.club_id = c.id) AS member_ids
         FROM school_clubs c WHERE c.school_id = $1 ORDER BY c.name`,
      [schoolId],
    )
    const { rows: staff } = await query(
      `SELECT id, name FROM users WHERE school_id = $1 AND role IN ('school', 'school_staff') ORDER BY name`,
      [schoolId],
    )
    return res.json({
      clubs: rows.map((r) => ({ id: r.id, name: r.name, goalHours: r.goal_hours, members: r.members, memberIds: r.member_ids, advisers: r.advisers, mine: r.advisers.some((a) => a.id === req.auth.sub) })),
      staff,
    })
  } catch (error) {
    console.error('clubs list failed:', error)
    return res.status(500).json({ error: 'Could not load the clubs.' })
  }
})

// POST /api/clubs — { name, goalHours? }. The creator becomes an adviser.
router.post('/', limiter, requireDb, requireAuth('school', 'school_staff'), async (req, res) => {
  const name = cleanName(req.body?.name)
  const goal = cleanGoal(req.body?.goalHours)
  if (!name) return res.status(400).json({ error: 'Give the club a name.' })
  if (!goal.ok) return res.status(400).json({ error: 'The hour goal must be a positive number.' })
  try {
    const schoolId = await mySchool(req.auth.sub)
    if (!schoolId) return res.status(403).json({ error: 'Your account is not linked to a school.' })
    const { rows: n } = await query('SELECT COUNT(*)::int AS n FROM school_clubs WHERE school_id = $1', [schoolId])
    if (n[0].n >= MAX_CLUBS) return res.status(400).json({ error: `A school can have up to ${MAX_CLUBS} clubs.` })
    const id = uid('club')
    await query('INSERT INTO school_clubs (id, school_id, name, goal_hours, created_by) VALUES ($1, $2, $3, $4, $5)', [id, schoolId, name, goal.value, req.auth.sub])
    await query('INSERT INTO club_advisers (club_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, req.auth.sub])
    return res.json({ ok: true, id })
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'There is already a club with that name.' })
    console.error('club create failed:', error)
    return res.status(500).json({ error: 'Could not create the club.' })
  }
})

// PATCH /api/clubs/:id — { name?, goalHours?, adviserIds? }
router.patch('/:id', limiter, requireDb, requireAuth('school', 'school_staff'), async (req, res) => {
  try {
    const schoolId = await mySchool(req.auth.sub)
    const club = schoolId && await clubAtSchool(req.params.id, schoolId)
    if (!club) return res.status(404).json({ error: 'Club not found.' })
    if (req.body?.name !== undefined) {
      const name = cleanName(req.body.name)
      if (!name) return res.status(400).json({ error: 'Give the club a name.' })
      await query('UPDATE school_clubs SET name = $2 WHERE id = $1', [club.id, name])
    }
    if (req.body?.goalHours !== undefined) {
      const goal = cleanGoal(req.body.goalHours)
      if (!goal.ok) return res.status(400).json({ error: 'The hour goal must be a positive number.' })
      await query('UPDATE school_clubs SET goal_hours = $2 WHERE id = $1', [club.id, goal.value])
    }
    if (Array.isArray(req.body?.adviserIds)) {
      const ids = [...new Set(req.body.adviserIds.map(String))].slice(0, 20)
      const { rows: ok } = await query(`SELECT id FROM users WHERE id = ANY($1::text[]) AND school_id = $2 AND role IN ('school', 'school_staff')`, [ids, schoolId])
      await query('DELETE FROM club_advisers WHERE club_id = $1', [club.id])
      for (const { id } of ok) await query('INSERT INTO club_advisers (club_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [club.id, id])
    }
    return res.json({ ok: true })
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'There is already a club with that name.' })
    console.error('club update failed:', error)
    return res.status(500).json({ error: 'Could not update the club.' })
  }
})

router.delete('/:id', limiter, requireDb, requireAuth('school', 'school_staff'), async (req, res) => {
  try {
    const schoolId = await mySchool(req.auth.sub)
    const club = schoolId && await clubAtSchool(req.params.id, schoolId)
    if (!club) return res.status(404).json({ error: 'Club not found.' })
    await query('DELETE FROM school_clubs WHERE id = $1', [club.id])
    return res.json({ ok: true })
  } catch (error) {
    console.error('club delete failed:', error)
    return res.status(500).json({ error: 'Could not delete the club.' })
  }
})

// PUT /api/clubs/:id/members — { userIds }: the full member list. Only
// students at this school are kept.
router.put('/:id/members', limiter, requireDb, requireAuth('school', 'school_staff'), async (req, res) => {
  const ids = Array.isArray(req.body?.userIds) ? [...new Set(req.body.userIds.map(String))] : null
  if (!ids) return res.status(400).json({ error: 'Send the list of members.' })
  if (ids.length > MAX_MEMBERS) return res.status(400).json({ error: `A club can have up to ${MAX_MEMBERS} members.` })
  try {
    const schoolId = await mySchool(req.auth.sub)
    const club = schoolId && await clubAtSchool(req.params.id, schoolId)
    if (!club) return res.status(404).json({ error: 'Club not found.' })
    const { rows: ok } = await query(`SELECT id FROM users WHERE id = ANY($1::text[]) AND school_id = $2 AND role = 'student'`, [ids, schoolId])
    await query('DELETE FROM club_members WHERE club_id = $1 AND NOT (user_id = ANY($2::text[]))', [club.id, ok.map((r) => r.id)])
    for (const { id } of ok) await query('INSERT INTO club_members (club_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [club.id, id])
    return res.json({ ok: true, members: ok.length })
  } catch (error) {
    console.error('club members failed:', error)
    return res.status(500).json({ error: 'Could not save the members.' })
  }
})

// GET /api/clubs/:id/progress?from=&to= — each member's hours in the range
// (default: this school year) against the club's goal. Rejected hours don't count.
router.get('/:id/progress', limiter, requireDb, requireAuth('school', 'school_staff'), async (req, res) => {
  const range = schoolYearRange()
  const day = /^\d{4}-\d{2}-\d{2}$/
  const from = day.test(String(req.query.from || '')) ? String(req.query.from) : range.from
  const to = day.test(String(req.query.to || '')) ? String(req.query.to) : range.to
  try {
    const schoolId = await mySchool(req.auth.sub)
    const club = schoolId && await clubAtSchool(req.params.id, schoolId)
    if (!club) return res.status(404).json({ error: 'Club not found.' })
    const { rows } = await query(
      `SELECT u.id, u.name, u.email, u.grade,
              COALESCE(SUM(l.hours) FILTER (WHERE l.verification_status IS DISTINCT FROM 'rejected'), 0)::float8 AS hours,
              COALESCE(SUM(l.hours) FILTER (WHERE l.verification_status = 'approved'), 0)::float8 AS approved
         FROM club_members m
         JOIN users u ON u.id = m.user_id AND u.school_id = $2
         LEFT JOIN logs l ON l.user_id = u.id AND l.date BETWEEN $3::date AND $4::date
        WHERE m.club_id = $1
        GROUP BY u.id ORDER BY u.name`,
      [club.id, schoolId, from, to],
    )
    recordAudit(req, { action: AUDIT.STUDENT_LIST_READ, schoolId, objectType: 'club_progress', objectId: club.id, meta: { count: rows.length } })
    const goal = club.goal_hours != null ? Number(club.goal_hours) : null
    return res.json({
      club: { id: club.id, name: club.name, goalHours: goal },
      range: { from, to },
      members: rows.map((r) => {
        const hours = Math.round(r.hours * 100) / 100
        return { id: r.id, name: r.name, email: r.email, grade: r.grade, hours, approved: Math.round(r.approved * 100) / 100, remaining: goal ? Math.max(0, Math.round((goal - hours) * 100) / 100) : null }
      }),
    })
  } catch (error) {
    console.error('club progress failed:', error)
    return res.status(500).json({ error: 'Could not load the club’s progress.' })
  }
})

// GET /api/clubs/mine — a student's clubs and their hours this school year.
router.get('/mine', limiter, requireDb, requireAuth('student'), async (req, res) => {
  const { from, to } = schoolYearRange()
  try {
    const { rows } = await query(
      `SELECT c.id, c.name, c.goal_hours::float8 AS goal_hours,
              (SELECT COALESCE(SUM(l.hours), 0)::float8 FROM logs l
                WHERE l.user_id = $1 AND l.verification_status IS DISTINCT FROM 'rejected' AND l.date BETWEEN $2::date AND $3::date) AS hours
         FROM club_members m JOIN school_clubs c ON c.id = m.club_id
         JOIN users u ON u.id = m.user_id AND u.school_id = c.school_id
        WHERE m.user_id = $1 ORDER BY c.name`,
      [req.auth.sub, from, to],
    )
    return res.json({ clubs: rows.map((r) => ({ id: r.id, name: r.name, goalHours: r.goal_hours, hours: Math.round(r.hours * 100) / 100 })) })
  } catch (error) {
    console.error('my clubs failed:', error)
    return res.status(500).json({ error: 'Could not load your clubs.' })
  }
})

export default router
