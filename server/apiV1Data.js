// What /api/v1 returns (#622, part 2). Every reader takes the key's scope
// (schools it may see, or the organizer it belongs to) and returns plain
// JSON. Rules shared with the rest of the app:
//  - students under 13 still waiting for a parent, and @test.com fixtures,
//    are never returned;
//  - a log's reflection, skills, notes, custom answers and proof never leave
//    (same as every read of a log by someone other than the student);
//  - event volunteers are shown as first name + last initial.
// Test keys (vt_test_…) get SAMPLE_* data instead, so integrators can build
// without touching real students.
import { query } from './db.js'
import { schoolProgress } from './routes/school.js'
import { impactFor, impactBySchool } from './impact.js'

export const PAGE_MAX = 500
export const PAGE_DEFAULT = 100

const STUDENT_FILTER = `u.role = 'student'
  AND (u.parental_consent_status IS NULL OR u.parental_consent_status <> 'pending')
  AND u.email NOT ILIKE '%@test.com'`

/** The school ids a key may read: its own school, or every school of its org. */
export async function schoolIdsFor(apiKey) {
  if (apiKey.ownerType === 'school') return [apiKey.ownerId]
  if (apiKey.ownerType === 'organization') {
    const { rows } = await query('SELECT id FROM schools WHERE organization_id = $1 ORDER BY id', [apiKey.ownerId])
    return rows.map((r) => r.id)
  }
  return []
}

// Cursors are opaque base64url of the last row's sort key.
export const encodeCursor = (parts) => Buffer.from(JSON.stringify(parts)).toString('base64url')
export function decodeCursor(c) {
  if (!c) return null
  try { const v = JSON.parse(Buffer.from(String(c), 'base64url').toString('utf8')); return Array.isArray(v) ? v : null } catch { return null }
}
export function pageSize(q) {
  const n = Number(q.limit ?? PAGE_DEFAULT)
  return Number.isInteger(n) && n >= 1 ? Math.min(n, PAGE_MAX) : PAGE_DEFAULT
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const isDate = (s) => DATE_RE.test(String(s || '')) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())

const studentOut = (r) => ({
  id: r.id, name: r.name, email: r.email, grade: r.grade || null, studentIdNumber: r.student_id_number || null,
  schoolId: r.school_id, joinedAt: r.created_at,
})

export async function listStudents(schoolIds, { limit, cursor, schoolId }) {
  const ids = schoolId ? schoolIds.filter((s) => s === schoolId) : schoolIds
  const after = decodeCursor(cursor)
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.grade, u.student_id_number, u.school_id, u.created_at
       FROM users u
      WHERE u.school_id = ANY($1) AND ${STUDENT_FILTER}
        AND ($2::text IS NULL OR u.id > $2)
      ORDER BY u.id
      LIMIT $3`,
    [ids, after?.[0] ?? null, limit + 1],
  )
  const page = rows.slice(0, limit)
  return { data: page.map(studentOut), nextCursor: rows.length > limit ? encodeCursor([page[page.length - 1].id]) : null }
}

export async function getStudent(schoolIds, id) {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.grade, u.student_id_number, u.school_id, u.created_at
       FROM users u WHERE u.id = $1 AND u.school_id = ANY($2) AND ${STUDENT_FILTER}`,
    [id, schoolIds],
  )
  return rows[0] ? studentOut(rows[0]) : null
}

const hourOut = (r) => ({
  id: r.id, studentId: r.user_id, date: r.date, activity: r.activity, category: r.category || null,
  hours: Number(r.hours), place: r.org_name || null, location: r.location || null,
  status: r.verification_status === 'none' || !r.verification_status ? 'unconfirmed' : r.verification_status,
  verifiedBy: r.verifier_role === 'school' || r.verifier_role === 'school_staff' ? 'school' : r.verified_by ? 'organizer' : r.verification_status === 'approved' ? 'supervisor' : null,
  reviewNote: r.review_note || null, eventId: r.task_id || null, createdAt: r.created_at,
})

const STATUS = { unconfirmed: ['none', 'pending'], approved: ['approved'], rejected: ['rejected'] }

/**
 * Hours, newest entry first by date then id. Filters: from, to (entry date,
 * both included), status (unconfirmed|approved|rejected), studentId,
 * createdSince (ISO time, for incremental pulls).
 */
export async function listHours(schoolIds, { limit, cursor, from, to, status, studentId, createdSince }) {
  const after = decodeCursor(cursor)
  const { rows } = await query(
    `SELECT l.id, l.user_id, to_char(l.date, 'YYYY-MM-DD') AS date, l.activity, l.category, l.hours, l.org_name, l.location,
            l.verification_status, l.verified_by, v.role AS verifier_role, l.review_note, l.task_id, l.created_at
       FROM logs l
       JOIN users u ON u.id = l.user_id
       LEFT JOIN users v ON v.id = l.verified_by
      WHERE u.school_id = ANY($1) AND ${STUDENT_FILTER}
        AND ($2::date IS NULL OR l.date >= $2::date)
        AND ($3::date IS NULL OR l.date <= $3::date)
        AND ($4::text[] IS NULL OR COALESCE(l.verification_status, 'none') = ANY($4))
        AND ($5::text IS NULL OR l.user_id = $5)
        AND ($6::timestamptz IS NULL OR l.created_at >= $6::timestamptz)
        AND ($7::date IS NULL OR (l.date, l.id) < ($7::date, $8::text))
      ORDER BY l.date DESC, l.id DESC
      LIMIT $9`,
    [schoolIds, from || null, to || null, status ? STATUS[status] : null, studentId || null, createdSince || null,
      after?.[0] ?? null, after?.[1] ?? null, limit + 1],
  )
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return { data: page.map(hourOut), nextCursor: rows.length > limit ? encodeCursor([last.date, last.id]) : null }
}

export async function progress(schoolIds, { schoolId } = {}) {
  const out = []
  for (const id of schoolId ? schoolIds.filter((s) => s === schoolId) : schoolIds) {
    const p = await schoolProgress(id)
    for (const s of p.students) {
      if (s.consentPending || /@test\.com$/i.test(s.email || '')) continue
      out.push({
        studentId: s.id, schoolId: id, grade: s.grade || null, hours: s.hours, target: s.target,
        remaining: s.remaining, met: s.target != null && s.remaining <= 0, award: s.award || null,
        categoryShort: s.categoryShort || [],
      })
    }
  }
  return out
}

export function progressSummary(rows) {
  const withGoal = rows.filter((r) => r.target != null)
  return {
    students: rows.length,
    withRequirement: withGoal.length,
    met: withGoal.filter((r) => r.met).length,
    behind: withGoal.filter((r) => !r.met).length,
    hours: Math.round(rows.reduce((n, r) => n + (r.hours || 0), 0) * 100) / 100,
  }
}

export const impact = (schoolIds, period, range) => impactFor(schoolIds, period, new Date(), range)
export const schoolTotals = (schoolIds, period, range) => impactBySchool(schoolIds, period, new Date(), range)

export async function schoolsFor(schoolIds) {
  const { rows } = await query('SELECT id, name, pin AS code FROM schools WHERE id = ANY($1) ORDER BY name', [schoolIds])
  return rows
}

// --- Events (organizer keys) ------------------------------------------------

const initial = (name) => {
  const parts = String(name || '').trim().split(/\s+/)
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] || ''
}

export async function listEvents(organizerId, { from, to, limit, cursor }) {
  const after = decodeCursor(cursor)
  const { rows } = await query(
    `SELECT t.id, t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location, t.is_online, t.category, t.status,
            t.slots_total, t.created_at,
            (SELECT COUNT(*)::int FROM public_task_signups s WHERE s.task_id = t.id AND s.status = 'approved') AS approved,
            (SELECT COUNT(*)::int FROM public_task_signups s WHERE s.task_id = t.id AND s.status = 'pending') AS pending,
            (SELECT COUNT(*)::int FROM public_task_signups s WHERE s.task_id = t.id AND s.status = 'waitlisted') AS waitlisted
       FROM public_tasks t
      WHERE t.created_by = $1
        AND ($2::date IS NULL OR t.date >= $2::date)
        AND ($3::date IS NULL OR t.date <= $3::date)
        AND ($4::date IS NULL OR (t.date, t.id) < ($4::date, $5::text))
      ORDER BY t.date DESC, t.id DESC
      LIMIT $6`,
    [organizerId, from || null, to || null, after?.[0] ?? null, after?.[1] ?? null, limit + 1],
  )
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return {
    data: page.map((t) => ({
      id: t.id, title: t.title, date: t.date, time: t.time || null, location: t.is_online ? null : t.location || null,
      online: Boolean(t.is_online), category: t.category || null, status: t.status, spots: t.slots_total,
      signups: { approved: t.approved, pending: t.pending, waitlisted: t.waitlisted },
    })),
    nextCursor: rows.length > limit ? encodeCursor([last.date, last.id]) : null,
  }
}

export async function ownsEvent(organizerId, eventId) {
  const { rows } = await query('SELECT 1 FROM public_tasks WHERE id = $1 AND created_by = $2', [eventId, organizerId])
  return rows.length > 0
}

export async function eventSignups(eventId) {
  const { rows } = await query(
    `SELECT s.id, u.name, s.status, s.shift_id, sh.label AS shift, s.guest_count, s.signed_up_at,
            s.attendance_status, s.checked_in_at, s.checked_out_at
       FROM public_task_signups s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN public_task_shifts sh ON sh.id = s.shift_id
      WHERE s.task_id = $1
        AND (u.parental_consent_status IS NULL OR u.parental_consent_status <> 'pending')
      ORDER BY s.signed_up_at`,
    [eventId],
  )
  return rows.map((r) => ({
    id: r.id, volunteer: initial(r.name), status: r.status, shift: r.shift || null, guests: r.guest_count || 0,
    signedUpAt: r.signed_up_at,
    attendance: r.attendance_status || (r.checked_in_at ? 'present' : null),
    checkedInAt: r.checked_in_at, checkedOutAt: r.checked_out_at,
  }))
}

// --- Sample data for test keys ----------------------------------------------

const SAMPLE_STUDENTS = [
  { id: 'usr_sample_1', name: 'Maya Lopez', email: 'maya.lopez@example.edu', grade: '11', studentIdNumber: '100231', schoolId: 'sch_sample', joinedAt: '2026-08-20T15:00:00.000Z' },
  { id: 'usr_sample_2', name: 'Jordan Kim', email: 'jordan.kim@example.edu', grade: '12', studentIdNumber: '100587', schoolId: 'sch_sample', joinedAt: '2026-08-21T15:00:00.000Z' },
  { id: 'usr_sample_3', name: 'Sam Patel', email: 'sam.patel@example.edu', grade: '9', studentIdNumber: null, schoolId: 'sch_sample', joinedAt: '2026-09-02T15:00:00.000Z' },
]
const SAMPLE_HOURS = [
  { id: 'log_sample_1', studentId: 'usr_sample_1', date: '2026-10-18', activity: 'Food bank sorting', category: 'Community Service', hours: 3, place: 'Riverside Food Bank', location: null, status: 'approved', verifiedBy: 'supervisor', reviewNote: null, eventId: null, createdAt: '2026-10-18T22:00:00.000Z' },
  { id: 'log_sample_2', studentId: 'usr_sample_2', date: '2026-10-12', activity: 'Reading buddies', category: 'Education & Tutoring', hours: 2, place: 'City Library', location: null, status: 'unconfirmed', verifiedBy: null, reviewNote: null, eventId: null, createdAt: '2026-10-12T20:00:00.000Z' },
  { id: 'log_sample_3', studentId: 'usr_sample_3', date: '2026-10-05', activity: 'Park cleanup', category: 'Environmental', hours: 4, place: 'Lincoln Park', location: null, status: 'approved', verifiedBy: 'organizer', reviewNote: null, eventId: 'pt_sample_1', createdAt: '2026-10-05T19:00:00.000Z' },
]
export const SAMPLE = {
  students: SAMPLE_STUDENTS,
  hours: SAMPLE_HOURS,
  progress: [
    { studentId: 'usr_sample_1', schoolId: 'sch_sample', grade: '11', hours: 42, target: 40, remaining: 0, met: true, award: 'Silver', categoryShort: [] },
    { studentId: 'usr_sample_2', schoolId: 'sch_sample', grade: '12', hours: 18, target: 40, remaining: 22, met: false, award: null, categoryShort: [] },
    { studentId: 'usr_sample_3', schoolId: 'sch_sample', grade: '9', hours: 4, target: 20, remaining: 16, met: false, award: null, categoryShort: [] },
  ],
  schools: [{ id: 'sch_sample', name: 'Sample High School', code: 'sample-1234' }],
  impact: { period: 'year', since: '2026-08-01', until: null, lastYear: null, hours: 64, entries: 23, activeStudents: 3, totalStudents: 3, byCategory: [{ name: 'Community Service', hours: 30 }, { name: 'Education & Tutoring', hours: 20 }, { name: 'Environmental', hours: 14 }], byMonth: [{ month: '2026-09', hours: 21 }, { month: '2026-10', hours: 43 }], topPlaces: [{ name: 'Riverside Food Bank', hours: 18 }], byGrade: [] },
  schoolTotals: [{ name: 'Sample High School', hours: 64, activeStudents: 3, students: 3 }],
  events: [{ id: 'pt_sample_1', title: 'Park cleanup', date: '2026-10-05', time: '09:00', location: 'Lincoln Park', online: false, category: 'Environmental', status: 'open', spots: 20, signups: { approved: 12, pending: 2, waitlisted: 0 } }],
  signups: [
    { id: 'sg_sample_1', volunteer: 'Maya L.', status: 'approved', shift: null, guests: 0, signedUpAt: '2026-09-28T17:00:00.000Z', attendance: 'present', checkedInAt: '2026-10-05T14:02:00.000Z', checkedOutAt: '2026-10-05T18:01:00.000Z' },
    { id: 'sg_sample_2', volunteer: 'Sam P.', status: 'approved', shift: null, guests: 1, signedUpAt: '2026-09-30T17:00:00.000Z', attendance: 'absent', checkedInAt: null, checkedOutAt: null },
  ],
}
