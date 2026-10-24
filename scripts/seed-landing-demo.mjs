// Fills a THROWAWAY local database with made-up sample data, so
// capture-landing-screenshots.mjs can photograph the parent and volunteer
// dashboards, and the student's Opportunities list, for the landing page (#292). The sample school and district are
// still created — the parent's child, the school requirement and the task
// sign-ups all hang off them — but their own dashboards are not photographed.
//
//   DATABASE_URL=postgresql://user@localhost:5432/demo \
//     node scripts/seed-landing-demo.mjs [apiBase=http://localhost:10001]
//
// Run a backend against that same database first (PORT=10001 DATABASE_URL=…
// PGSSL=disable node server.js, with email env vars blank). Accounts go
// through the real API; states the API can't reach quickly (paid, approved,
// linked) are set with SQL. Every name and address is invented.
//
// It refuses to run unless both the database and the API are on this
// machine: the project .env points at production, and sample schools must
// never land there.
import 'dotenv/config'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import { signToken } from '../server/auth.js'

const API = (process.argv[2] || 'http://localhost:10001').replace(/\/$/, '')
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const hostOf = (url) => { try { return new URL(url).hostname } catch { return '' } }

if (!LOCAL.has(hostOf(process.env.DATABASE_URL)) || !LOCAL.has(hostOf(API))) {
  console.error('Refusing to seed: DATABASE_URL and the API must both be on localhost.')
  console.error(`  DATABASE_URL host: ${hostOf(process.env.DATABASE_URL) || '(unset)'}  API host: ${hostOf(API) || '(invalid)'}`)
  process.exit(1)
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
await db.connect()

const PASSWORD = 'Demo-Landing-2026!'
const admin = signToken({ id: 'usr_demo_admin', role: 'admin', email: 'admin@example.com' })

async function call(method, path, body, token) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${data.error || ''}`)
  return data
}
// Self sign-up now needs a date of birth and the 6-digit code emailed to the
// address (#310). This database is local and throwaway, so the code is put
// in signup_codes directly instead of being read out of an inbox.
const SIGNUP_CODE = '424242'
const signupCodeHash = await bcrypt.hash(SIGNUP_CODE, 10)
const BIRTH = { student: '2009-06-15', volunteer: '1988-03-02', parent: '1982-09-20' }
async function register(body) {
  await db.query(
    `INSERT INTO signup_codes (email, code_hash, expires_at) VALUES ($1, $2, now() + interval '10 minutes')
     ON CONFLICT (email) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0`,
    [body.email, signupCodeHash],
  )
  return call('POST', '/api/auth/register', { dateOfBirth: BIRTH[body.role], emailCode: SIGNUP_CODE, ...body })
}
const code = async (kind) => (await call('POST', '/api/registration-codes/admin', { kind }, admin)).code
const day = (offset) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

// --- organization and its three schools
const org = await call('POST', '/api/organization/register', {
  name: 'Riverside School District', email: 'district@example.com', password: PASSWORD, registrationCode: await code('organization'),
})
const SCHOOLS = [
  ['Lincoln High School', 'lincoln@example.com', 'lincoln-2026'],
  ['Riverside Middle School', 'riverside-ms@example.com', 'rivms-2026'],
  ['Oak Grove Academy', 'oakgrove@example.com', 'oakg-2026'],
]
const schools = []
for (const [name, email, pin] of SCHOOLS) {
  schools.push(await call('POST', '/api/school/register', { name, email, password: PASSWORD, pin, registrationCode: await code('school') }))
}
const lincoln = schools[0]
await db.query(`UPDATE schools SET organization_id = $1, payment_status = 'paid', paid_at = now() WHERE pin = ANY($2)`,
  [org.user.organizationId, SCHOOLS.map((s) => s[2])])
await db.query(`UPDATE organizations SET payment_status = 'paid' WHERE id = $1`, [org.user.organizationId]).catch(() => {})
// Lincoln's own requirement, so parent and school views have a target to show.
await db.query(`UPDATE schools SET requirements = $1 WHERE pin = 'lincoln-2026'`,
  [JSON.stringify({ goals: { totalHours: 40, deadline: `${new Date().getFullYear() + 1}-05-01`, note: 'NHS service requirement' } })])

// --- Lincoln students, each with a handful of entries
const STUDENTS = [
  ['Maya Patel', '11'], ['Jordan Lee', '12'], ['Sofia Ramirez', '10'], ['Ethan Brooks', '11'],
  ['Aisha Khan', '12'], ['Noah Kim', '9'], ['Olivia Chen', '10'], ['Lucas Moreno', '11'],
]
const ENTRIES = [
  ['Food bank sorting', 'Community Service', 'Central Food Bank', 3],
  ['Reading buddies', 'Education & Tutoring', 'Lincoln Elementary', 2],
  ['Creek cleanup', 'Environmental', 'Riverside Park', 4],
  ['Animal shelter walks', 'Animal Welfare', 'Happy Tails Shelter', 2],
  ['Senior center visit', 'Health & Wellness', 'Oak Grove Senior Center', 2.5],
  ['Habitat build day', 'Community Service', 'Habitat for Humanity', 5],
  ['Youth soccer coaching', 'Sports & Coaching', 'YMCA', 2],
  ['Museum guide', 'Arts & Culture', 'Children’s Museum', 3],
]
const students = []
for (const [i, [name, grade]] of STUDENTS.entries()) {
  const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`
  const s = await register({ name, email, password: PASSWORD, role: 'student', ageBand: '13plus', grade })
  await call('POST', '/api/school/join', { pin: 'lincoln-2026' }, s.token)
  const count = 3 + (i % 4)
  for (let n = 0; n < count; n++) {
    const [activity, category, location, hours] = ENTRIES[(i + n * 3) % ENTRIES.length]
    await call('POST', '/api/logs', {
      date: day(-(n * 9 + i)), activity, category, hours, location,
      orgName: location, supervisorName: 'Jamie Rivera', supervisorEmail: 'supervisor@example.com',
    }, s.token)
  }
  students.push({ ...s, name })
}
// The district's other schools get a few students too, so no school reads "0 students".
const OTHERS = [['rivms-2026', ['Grace Turner', 'Daniel Nguyen', 'Emma Wilson', 'Leo Garcia']], ['oakg-2026', ['Hannah Scott', 'Ryan Patel', 'Zoe Adams']]]
for (const [pin, names] of OTHERS) {
  for (const name of names) {
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`
    const s = await register({ name, email, password: PASSWORD, role: 'student', ageBand: '13plus', grade: '8' })
    await call('POST', '/api/school/join', { pin }, s.token)
  }
}

// Most entries approved, the newest few still waiting — what a real roster looks like.
await db.query(`UPDATE logs SET verification_status = 'approved' WHERE user_id = ANY($1)`, [students.map((s) => s.user.id)])
await db.query(`
  UPDATE logs SET verification_status = 'pending'
   WHERE id IN (SELECT id FROM logs WHERE user_id = ANY($1) AND date >= $2)`,
  [students.map((s) => s.user.id), day(-6)])

// --- a parent following Maya
const parent = await register({ name: 'Priya Patel', email: 'priya.patel@example.com', password: PASSWORD, role: 'parent' })
await db.query('INSERT INTO parent_child_links (parent_id, child_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [parent.user.id, students[0].user.id])

// --- a volunteer task maker with three upcoming tasks and some sign-ups
const vol = await register({ name: 'Green Streets Collective', email: 'greenstreets@example.com', password: PASSWORD, role: 'volunteer' })
const TASKS = [
  ['Saturday park cleanup', 'Pick up litter and clear trails along the river walk. Gloves and bags provided.', 'Riverside Park, Main Gate', 4, '09:00', 12, 'Environmental'],
  ['Food drive sorting', 'Sort and pack donated food for weekend family boxes.', 'Central Food Bank', 9, '15:30', 8, 'Community Service'],
  ['Tree planting day', 'Plant 60 saplings with the city forestry team.', 'City Arboretum', 16, '10:00', 15, 'Environmental'],
]
for (const [t, [title, description, location, inDays, time, slotsTotal, category]] of TASKS.entries()) {
  const task = await call('POST', '/api/school/public-tasks', {
    title, description, location, date: day(inDays), time, slotsTotal, category, phone: '555-0142', importantInfo: 'Wear closed-toe shoes.',
  }, vol.token)
  const signers = students.slice(t * 2, t * 2 + 3 + t)
  for (const s of signers) await call('POST', `/api/school/public-tasks/${task.id}/signup`, {}, s.token)
  for (const s of signers.slice(0, 2)) await call('POST', `/api/school/public-tasks/${task.id}/approve/${s.user.id}`, {}, vol.token)
}

// --- more organizers, so the student's Opportunities list has some variety
const MORE = [
  ['Happy Tails Shelter', 'happytails@example.com', [
    ['Dog walking morning', 'Walk and socialize shelter dogs waiting for adoption.', 'Happy Tails Shelter', 3, '08:30', 6, 'Animal Welfare', {}],
    ['Adoption day helpers', 'Greet families and help run the adoption event.', 'Riverside Park Pavilion', 11, '11:00', 10, 'Animal Welfare', {}],
  ]],
  ['Lincoln Library Friends', 'libraryfriends@example.com', [
    ['Reading hour for kids', 'Read picture books aloud to children ages 4–8.', 'Lincoln Public Library', 6, '16:00', 4, 'Education & Tutoring', { wheelchairAccessible: 'yes' }],
    ['Online homework help', 'Tutor middle schoolers in math over video call.', 'Online', 2, '18:00', 5, 'Education & Tutoring', { isOnline: true }],
  ]],
]
for (const [name, email, tasks] of MORE) {
  const org = await register({ name, email, password: PASSWORD, role: 'volunteer' })
  for (const [title, description, location, inDays, time, slotsTotal, category, extra] of tasks) {
    const task = await call('POST', '/api/school/public-tasks', {
      title, description, location, date: day(inDays), time, slotsTotal, category, phone: '555-0177', ...extra,
    }, org.token)
    // A few sign-ups so spots-left counts look lived in.
    for (const s of students.slice(4, 6)) await call('POST', `/api/school/public-tasks/${task.id}/signup`, {}, s.token)
  }
}

// Put the in-person tasks around one made-up neighborhood (central Austin),
// so Opportunities can show them as "near you" with distances. The capture
// script places the browser at DEMO_LOCATION too.
const DEMO_LOCATION = { latitude: 30.2672, longitude: -97.7431 }
await db.query(`
  UPDATE public_tasks t
     SET latitude = $1 + (((n.rn % 5) - 2) * 0.012), longitude = $2 + (((n.rn % 3) - 1) * 0.015)
    FROM (SELECT id, row_number() OVER (ORDER BY date, id) AS rn FROM public_tasks) n
   WHERE n.id = t.id AND NOT COALESCE(t.is_online, false)`, [DEMO_LOCATION.latitude, DEMO_LOCATION.longitude])
// Maya's causes, so Opportunities opens with its "For you" picks rather than
// the one-time "What causes do you care about?" prompt.
await call('PUT', '/api/interests', { interests: ['Environmental', 'Animal Welfare'] }, students[0].token)

await db.end()

// Hand the capture script these sessions directly: signing in again would
// trip the backend's auth rate limit, which the sign-ups above already used.
// They're bearer tokens, so they go in this project's own (gitignored)
// node_modules/.cache, owner-only — not a predictable name in the shared
// system temp folder, where another user could read or swap the file.
const sessionsFile = fileURLToPath(new URL('../node_modules/.cache/voluntrack-landing-demo.json', import.meta.url))
fs.mkdirSync(path.dirname(sessionsFile), { recursive: true })
fs.writeFileSync(sessionsFile, JSON.stringify({
  api: API,
  parent: { token: parent.token, user: parent.user },
  student: { token: students[0].token, user: students[0].user },
  volunteer: { token: vol.token, user: vol.user },
}), { mode: 0o600 })
console.log(`Wrote demo sessions to ${sessionsFile}`)
console.log('Seeded sample data. Sign-in for every demo account:', PASSWORD)
console.log(JSON.stringify({
  school: SCHOOLS[0][1], organization: 'district@example.com', parent: 'priya.patel@example.com', volunteer: 'greenstreets@example.com',
}, null, 2))
console.log(`(${schools.length} schools, ${students.length} students; lincoln user ${lincoln.user.id})`)
