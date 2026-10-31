// The public API (#622), /api/v1. Server-to-server only: mounted in server.js
// ahead of the CORS middleware, so no browser page can call it with a key.
// Every request needs an API key (server/apiKeys.js); errors use
// { error: { code, message } }. Data readers are in server/apiV1Data.js.
import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { authenticateApiKey, apiError, requireScope } from '../apiKeys.js'
import { recordAudit, AUDIT } from '../audit.js'
import { rangeFromQuery, PERIODS } from '../impact.js'
import {
  schoolIdsFor, pageSize, isDate, listStudents, getStudent, listHours, progress, progressSummary,
  impact, schoolTotals, schoolsFor, listEvents, ownsEvent, eventSignups, SAMPLE,
} from '../apiV1Data.js'

const router = express.Router()

router.use((req, res, next) => {
  if (!hasDatabase()) return apiError(res, 503, 'unavailable', 'The API is not available on this server.')
  res.set('Cache-Control', 'no-store')
  next()
})
router.use(express.json({ limit: '256kb' }))
// Per address, before the key check, so guessing keys is slow.
router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1200,
  standardHeaders: false,
  legacyHeaders: false,
  handler: (req, res) => apiError(res, 429, 'rate_limited', 'Too many requests. Try again shortly.'),
}))
router.use(authenticateApiKey)
// Per key, not per IP: an integration on a shared host shouldn't starve another.
router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.apiKey.id,
  handler: (req, res) => apiError(res, 429, 'rate_limited', 'Too many requests for this key. Slow down and try again shortly.'),
}))

// GET /api/v1/me — who this key belongs to and what it may do.
router.get('/me', async (req, res) => {
  const k = req.apiKey
  try {
    let owner = { type: k.ownerType, id: k.ownerId, name: null }
    if (k.ownerType === 'school') owner.name = (await query('SELECT name FROM schools WHERE id = $1', [k.ownerId])).rows[0]?.name ?? null
    else if (k.ownerType === 'organization') owner.name = (await query('SELECT name FROM organizations WHERE id = $1', [k.ownerId])).rows[0]?.name ?? null
    else owner.name = (await query('SELECT name FROM users WHERE id = $1', [k.ownerId])).rows[0]?.name ?? null
    return res.json({ key: { id: k.id, name: k.name, mode: k.mode, scopes: k.scopes }, owner })
  } catch (error) {
    console.error('api v1 me failed:', error)
    return apiError(res, 500, 'server_error', 'Something went wrong.')
  }
})


const isTest = (req) => req.apiKey.mode === 'test'
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res) } catch (error) {
    // The route pattern, not req.path: the path is the caller's text.
    console.error('api v1 request failed:', req.method, req.route?.path || 'unknown route', error)
    apiError(res, 500, 'server_error', 'Something went wrong.')
  }
}
// Schools and organizations only: the student data endpoints.
const forSchools = (req, res, next) => {
  if (!['school', 'organization'].includes(req.apiKey.ownerType)) return apiError(res, 403, 'wrong_owner', 'This endpoint is for school and organization keys.')
  next()
}
// Organizers only: their events.
const forOrganizers = (req, res, next) => {
  if (req.apiKey.ownerType !== 'organizer') return apiError(res, 403, 'wrong_owner', 'This endpoint is for event organizer keys.')
  next()
}
// Every read of students' records goes in the audit trail (#146), against the
// person who made the key; never awaited.
function audit(req, action, meta) {
  recordAudit(req, {
    action,
    schoolId: req.apiKey.ownerType === 'school' ? req.apiKey.ownerId : null,
    organizationId: req.apiKey.ownerType === 'organization' ? req.apiKey.ownerId : null,
    objectType: 'api_key',
    objectId: req.apiKey.id,
    meta,
  })
}
// ?schoolId= narrows an organization's request to one of its schools.
async function scope(req, res) {
  const ids = await schoolIdsFor(req.apiKey)
  const one = req.query.schoolId ? String(req.query.schoolId) : null
  if (one && !ids.includes(one)) { apiError(res, 404, 'not_found', 'No such school for this key.'); return null }
  return { ids, one }
}
function badDates(req, res) {
  for (const f of ['from', 'to']) {
    if (req.query[f] != null && !isDate(req.query[f])) { apiError(res, 400, 'invalid_parameter', `${f} must be a date like 2026-01-31.`); return true }
  }
  if (req.query.from && req.query.to && req.query.from > req.query.to) { apiError(res, 400, 'invalid_parameter', 'from must be on or before to.'); return true }
  return false
}

// GET /v1/schools — the schools this key covers.
router.get('/schools', forSchools, wrap(async (req, res) => {
  if (isTest(req)) return res.json({ data: SAMPLE.schools })
  const ids = await schoolIdsFor(req.apiKey)
  return res.json({ data: await schoolsFor(ids) })
}))

// GET /v1/students?limit=&cursor=&schoolId=
router.get('/students', forSchools, requireScope('students:read'), wrap(async (req, res) => {
  if (isTest(req)) return res.json({ data: SAMPLE.students, nextCursor: null })
  const sc = await scope(req, res)
  if (!sc) return
  const page = await listStudents(sc.ids, { limit: pageSize(req.query), cursor: req.query.cursor, schoolId: sc.one })
  audit(req, AUDIT.API_STUDENTS_READ, { count: page.data.length })
  return res.json(page)
}))

router.get('/students/:id', forSchools, requireScope('students:read'), wrap(async (req, res) => {
  if (isTest(req)) {
    const s = SAMPLE.students.find((x) => x.id === req.params.id)
    return s ? res.json({ data: s }) : apiError(res, 404, 'not_found', 'No such student for this key.')
  }
  const student = await getStudent(await schoolIdsFor(req.apiKey), req.params.id)
  if (!student) return apiError(res, 404, 'not_found', 'No such student for this key.')
  audit(req, AUDIT.API_STUDENTS_READ, { count: 1, studentId: student.id })
  return res.json({ data: student })
}))

const STATUSES = ['unconfirmed', 'approved', 'rejected']
async function hoursHandler(req, res, studentId) {
  if (badDates(req, res)) return
  const status = req.query.status ? String(req.query.status) : null
  if (status && !STATUSES.includes(status)) return apiError(res, 400, 'invalid_parameter', 'status must be unconfirmed, approved or rejected.')
  const createdSince = req.query.createdSince ? String(req.query.createdSince) : null
  if (createdSince && Number.isNaN(Date.parse(createdSince))) return apiError(res, 400, 'invalid_parameter', 'createdSince must be an ISO 8601 time.')
  if (isTest(req)) {
    const data = SAMPLE.hours.filter((h) => (!studentId || h.studentId === studentId) && (!status || h.status === status))
    return res.json({ data, nextCursor: null })
  }
  const sc = await scope(req, res)
  if (!sc) return
  const ids = sc.one ? [sc.one] : sc.ids
  if (studentId && !(await getStudent(ids, studentId))) return apiError(res, 404, 'not_found', 'No such student for this key.')
  const page = await listHours(ids, {
    limit: pageSize(req.query), cursor: req.query.cursor, from: req.query.from, to: req.query.to, status, studentId, createdSince,
  })
  audit(req, AUDIT.API_HOURS_READ, { count: page.data.length, ...(studentId ? { studentId } : {}) })
  return res.json(page)
}
// GET /v1/hours?from=&to=&status=&studentId=&createdSince=&limit=&cursor=&schoolId=
router.get('/hours', forSchools, requireScope('hours:read'), wrap((req, res) => hoursHandler(req, res, req.query.studentId ? String(req.query.studentId) : null)))
router.get('/students/:id/hours', forSchools, requireScope('hours:read'), wrap((req, res) => hoursHandler(req, res, req.params.id)))

// GET /v1/progress?schoolId= — per student, toward the school's requirement.
router.get('/progress', forSchools, requireScope('progress:read'), wrap(async (req, res) => {
  if (isTest(req)) return res.json({ data: SAMPLE.progress })
  const sc = await scope(req, res)
  if (!sc) return
  const data = await progress(sc.ids, { schoolId: sc.one })
  audit(req, AUDIT.API_STUDENTS_READ, { count: data.length, what: 'progress' })
  return res.json({ data })
}))

// GET /v1/progress/summary — counts only.
router.get('/progress/summary', forSchools, requireScope('progress:read'), wrap(async (req, res) => {
  if (isTest(req)) return res.json({ data: progressSummary(SAMPLE.progress) })
  const sc = await scope(req, res)
  if (!sc) return
  return res.json({ data: progressSummary(await progress(sc.ids, { schoolId: sc.one })) })
}))

// GET /v1/reports/impact?period=year|all or ?from=&to= — counts only (#563, #610).
router.get('/reports/impact', forSchools, requireScope('reports:read'), wrap(async (req, res) => {
  const range = rangeFromQuery(req.query)
  if (range?.error) return apiError(res, 400, 'invalid_parameter', range.error)
  const period = PERIODS.includes(req.query.period) ? req.query.period : 'year'
  if (isTest(req)) return res.json({ data: { ...SAMPLE.impact, schools: req.apiKey.ownerType === 'organization' ? SAMPLE.schoolTotals : undefined } })
  const sc = await scope(req, res)
  if (!sc) return
  const ids = sc.one ? [sc.one] : sc.ids
  const data = await impact(ids, period, range)
  if (req.apiKey.ownerType === 'organization' && !sc.one) data.schools = await schoolTotals(ids, period, range)
  return res.json({ data })
}))

// GET /v1/events?from=&to=&limit=&cursor= — the organizer's own events.
router.get('/events', forOrganizers, requireScope('events:read'), wrap(async (req, res) => {
  if (badDates(req, res)) return
  if (isTest(req)) return res.json({ data: SAMPLE.events, nextCursor: null })
  return res.json(await listEvents(req.apiKey.ownerId, { from: req.query.from, to: req.query.to, limit: pageSize(req.query), cursor: req.query.cursor }))
}))

// GET /v1/events/:id/signups — volunteers as first name + last initial.
router.get('/events/:id/signups', forOrganizers, requireScope('events:read'), wrap(async (req, res) => {
  if (isTest(req)) return req.params.id === 'pt_sample_1' ? res.json({ data: SAMPLE.signups }) : apiError(res, 404, 'not_found', 'No such event for this key.')
  if (!(await ownsEvent(req.apiKey.ownerId, req.params.id))) return apiError(res, 404, 'not_found', 'No such event for this key.')
  return res.json({ data: await eventSignups(req.params.id) })
}))

// GET /v1/events/:id/attendance — approved volunteers and whether they came.
router.get('/events/:id/attendance', forOrganizers, requireScope('events:read'), wrap(async (req, res) => {
  const pick = (rows) => rows.filter((r) => r.status === 'approved').map(({ id, volunteer, shift, attendance, checkedInAt, checkedOutAt }) => ({ id, volunteer, shift, attendance, checkedInAt, checkedOutAt }))
  if (isTest(req)) return req.params.id === 'pt_sample_1' ? res.json({ data: pick(SAMPLE.signups) }) : apiError(res, 404, 'not_found', 'No such event for this key.')
  if (!(await ownsEvent(req.apiKey.ownerId, req.params.id))) return apiError(res, 404, 'not_found', 'No such event for this key.')
  return res.json({ data: pick(await eventSignups(req.params.id)) })
}))

router.use((req, res) => apiError(res, 404, 'not_found', `No endpoint ${req.method} /api/v1${req.path}.`))

export default router
