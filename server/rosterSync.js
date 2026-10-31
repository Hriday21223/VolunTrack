// Roster sync (#608): bring a class list in from Google Classroom or Clever
// instead of a CSV. Every person found goes through inviteStudentsToSchool()
// (server/routes/school.js), so nobody is linked without accepting, the
// school's seat and email limits apply, and a roster's names are kept.
//
// Google Classroom: an adviser connects their own Google account (read-only
// Classroom scopes) and picks their classes. The refresh token is kept
// encrypted (server/secrets.js) so "Sync again" and the nightly run can
// re-read the class. GOOGLE_CLASSROOM_CLIENT_ID / _SECRET; the redirect URI to
// register is <PUBLIC_BACKEND_URL>/api/roster-sync/google/callback.
//
// Clever: a district shares its data with VolunTrack in Clever, which gives us
// a district token (CLEVER_CLIENT_ID / _SECRET, GET /oauth/tokens). An adviser
// finds the sections they teach by their own email and imports them.
//
// Students who later leave a synced class are reported to the adviser and
// never removed automatically. Off until the variables are set.
import crypto from 'node:crypto'
import { query } from './db.js'
import { encryptSecret, decryptSecret, hasEncryptionKey } from './secrets.js'
import { backendUrl } from './email.js'

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.profile.emails',
]
export const MAX_SECTION_STUDENTS = 200
const STATE_TTL_MINUTES = 10

export class RosterError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

export const googleConfigured = () => Boolean(process.env.GOOGLE_CLASSROOM_CLIENT_ID && process.env.GOOGLE_CLASSROOM_CLIENT_SECRET && hasEncryptionKey())
export const cleverConfigured = () => Boolean(process.env.CLEVER_CLIENT_ID && process.env.CLEVER_CLIENT_SECRET)
export const googleRedirectUri = () => `${backendUrl()}/api/roster-sync/google/callback`

async function getJson(url, init = {}, what = 'request') {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new RosterError(`${what} failed (${res.status}).`, res.status === 401 || res.status === 403 ? 409 : 502)
    err.detail = body?.error?.message || body?.error_description || body?.error || ''
    throw err
  }
  return body
}

// --- Google Classroom -------------------------------------------------------

/** The Google consent URL for this adviser; the state is single-use, 10 minutes. */
export async function googleAuthUrl(userId) {
  const state = crypto.randomBytes(24).toString('hex')
  await query('DELETE FROM roster_oauth_states WHERE created_at < now() - $1::interval', [`${STATE_TTL_MINUTES} minutes`])
  await query('INSERT INTO roster_oauth_states (state, user_id) VALUES ($1, $2)', [state, userId])
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  u.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLASSROOM_CLIENT_ID,
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  }).toString()
  return u.toString()
}

/** Finishes the consent: trades the code, stores the refresh token. Returns the adviser id. */
export async function googleCallback({ code, state }) {
  const { rows } = await query(
    'DELETE FROM roster_oauth_states WHERE state = $1 AND created_at > now() - $2::interval RETURNING user_id',
    [String(state || ''), `${STATE_TTL_MINUTES} minutes`],
  )
  const userId = rows[0]?.user_id
  if (!userId) throw new RosterError('This link expired. Start again from your dashboard.')
  const tokens = await getJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: String(code || ''),
      client_id: process.env.GOOGLE_CLASSROOM_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLASSROOM_CLIENT_SECRET,
      redirect_uri: googleRedirectUri(),
      grant_type: 'authorization_code',
    }),
  }, 'Google sign-in')
  if (!tokens.refresh_token) throw new RosterError('Google did not give us ongoing access. Disconnect VolunTrack in your Google account settings and try again.')
  const { rows: me } = await query('SELECT school_id FROM users WHERE id = $1', [userId])
  if (!me[0]?.school_id) throw new RosterError('Your account is not linked to a school.')
  await query(
    `INSERT INTO roster_connections (user_id, provider, school_id, secret_enc) VALUES ($1, 'google', $2, $3)
     ON CONFLICT (user_id, provider) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, school_id = EXCLUDED.school_id, connected_at = now()`,
    [userId, me[0].school_id, encryptSecret(tokens.refresh_token)],
  )
  return userId
}

async function googleAccessToken(userId) {
  const { rows } = await query("SELECT secret_enc FROM roster_connections WHERE user_id = $1 AND provider = 'google'", [userId])
  if (!rows[0]) throw new RosterError('Connect Google Classroom first.', 409)
  const tokens = await getJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: decryptSecret(rows[0].secret_enc),
      client_id: process.env.GOOGLE_CLASSROOM_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLASSROOM_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  }, 'Google sign-in')
  return tokens.access_token
}

export async function googleCourses(userId) {
  const token = await googleAccessToken(userId)
  const body = await getJson('https://classroom.googleapis.com/v1/courses?teacherId=me&courseStates=ACTIVE&pageSize=100',
    { headers: { Authorization: `Bearer ${token}` } }, 'Loading your classes')
  return (body.courses || []).map((c) => ({ id: c.id, name: [c.name, c.section].filter(Boolean).join(' · ') }))
}

async function googleStudents(token, courseId) {
  const out = []
  let pageToken = ''
  do {
    const u = `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(courseId)}/students?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
    const body = await getJson(u, { headers: { Authorization: `Bearer ${token}` } }, 'Loading the class list')
    for (const s of body.students || []) {
      const email = s.profile?.emailAddress
      if (email) out.push({ email: email.toLowerCase(), name: s.profile?.name?.fullName || '' })
    }
    pageToken = body.nextPageToken || ''
  } while (pageToken && out.length < MAX_SECTION_STUDENTS)
  return out.slice(0, MAX_SECTION_STUDENTS)
}

// --- Clever -----------------------------------------------------------------

async function cleverDistrictTokens() {
  const auth = Buffer.from(`${process.env.CLEVER_CLIENT_ID}:${process.env.CLEVER_CLIENT_SECRET}`).toString('base64')
  const body = await getJson('https://clever.com/oauth/tokens?owner_type=district', { headers: { Authorization: `Basic ${auth}` } }, 'Clever')
  return (body.data || []).map((d) => d.access_token).filter(Boolean)
}

async function cleverPages(token, path, maxPages = 20) {
  const out = []
  let next = `https://api.clever.com${path}`
  for (let i = 0; next && i < maxPages; i += 1) {
    const body = await getJson(next, { headers: { Authorization: `Bearer ${token}` } }, 'Clever')
    out.push(...(body.data || []).map((d) => d.data || d))
    const link = (body.links || []).find((l) => l.rel === 'next')
    next = link ? `https://api.clever.com${link.uri}` : null
  }
  return out
}

const cleverName = (u) => [u?.name?.first, u?.name?.last].filter(Boolean).join(' ')

/** Sections the adviser teaches in any district that shares with VolunTrack, matched by their email. */
export async function cleverSections(email) {
  const want = String(email || '').toLowerCase()
  const found = []
  for (const token of await cleverDistrictTokens()) {
    const teachers = await cleverPages(token, '/v3.0/users?role=teacher&limit=1000')
    const me = teachers.find((t) => String(t.email || '').toLowerCase() === want)
    if (!me) continue
    const sections = await cleverPages(token, `/v3.0/users/${encodeURIComponent(me.id)}/sections?limit=100`, 5)
    for (const s of sections) found.push({ id: s.id, name: [s.name, s.period && `Period ${s.period}`].filter(Boolean).join(' · ') })
  }
  return found
}

async function cleverStudents(email, sectionId) {
  const want = String(email || '').toLowerCase()
  for (const token of await cleverDistrictTokens()) {
    const teachers = await cleverPages(token, '/v3.0/users?role=teacher&limit=1000')
    const me = teachers.find((t) => String(t.email || '').toLowerCase() === want)
    if (!me) continue
    const sections = await cleverPages(token, `/v3.0/users/${encodeURIComponent(me.id)}/sections?limit=100`, 5)
    if (!sections.some((s) => s.id === sectionId)) continue
    const students = await cleverPages(token, `/v3.0/sections/${encodeURIComponent(sectionId)}/users?role=student&limit=${MAX_SECTION_STUDENTS}`, 2)
    return students.filter((u) => u.email).map((u) => ({ email: String(u.email).toLowerCase(), name: cleverName(u), grade: u.roles?.student?.grade || '' })).slice(0, MAX_SECTION_STUDENTS)
  }
  throw new RosterError('That section isn’t one of yours in Clever.', 404)
}

// --- Sync -------------------------------------------------------------------

/**
 * Reads one section's students, remembers it for re-syncs, and reports who
 * joined and who left since last time. `invite` is inviteStudentsToSchool,
 * passed in to keep this module free of the route file.
 */
export async function syncSection({ userId, schoolId, provider, sectionId, sectionName, adviserEmail, invite }) {
  let students
  if (provider === 'google') students = await googleStudents(await googleAccessToken(userId), sectionId)
  else if (provider === 'clever') students = await cleverStudents(adviserEmail, sectionId)
  else throw new RosterError('Unknown roster provider.')

  const { rows: before } = await query(
    'SELECT email FROM roster_sync_members WHERE school_id = $1 AND provider = $2 AND section_id = $3',
    [schoolId, provider, sectionId],
  )
  const now = new Set(students.map((s) => s.email))
  const left = before.map((r) => r.email).filter((e) => !now.has(e))

  const result = students.length ? await invite(userId, { students }) : { invited: 0, emailed: 0 }

  await query(
    `INSERT INTO roster_sync_sections (school_id, provider, section_id, name, user_id, last_synced_at, student_count)
     VALUES ($1, $2, $3, $4, $5, now(), $6)
     ON CONFLICT (school_id, provider, section_id) DO UPDATE
       SET name = EXCLUDED.name, user_id = EXCLUDED.user_id, last_synced_at = now(), student_count = EXCLUDED.student_count`,
    [schoolId, provider, sectionId, String(sectionName || '').slice(0, 200), userId, students.length],
  )
  await query('DELETE FROM roster_sync_members WHERE school_id = $1 AND provider = $2 AND section_id = $3', [schoolId, provider, sectionId])
  if (students.length) {
    await query(
      `INSERT INTO roster_sync_members (school_id, provider, section_id, email)
       SELECT $1, $2, $3, unnest($4::text[]) ON CONFLICT DO NOTHING`,
      [schoolId, provider, sectionId, [...now]],
    )
  }
  // Who left and is still linked to this school: shown to the adviser, never removed.
  let leftLinked = []
  if (left.length) {
    const { rows } = await query(
      "SELECT name, email FROM users WHERE school_id = $1 AND role = 'student' AND LOWER(email) = ANY($2)",
      [schoolId, left],
    )
    leftLinked = rows.map((r) => ({ name: r.name, email: r.email }))
  }
  return { section: sectionName, found: students.length, ...result, leftClass: leftLinked }
}
