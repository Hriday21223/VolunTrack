// Creates test accounts on the LIVE site, so each kind of account can be tried
// there (#888). Run it yourself: it asks for the live database address and a
// password at hidden prompts, so neither is ever typed into a file, a shell
// history or a chat.
//
//   npm run seed:live-test-accounts
//
// What it makes (all @test.com, so they're never emailed and are left out of
// the admin's sign-up counts):
//   live-student@test.com      student at "Live Test School" (a free club)
//   live-volunteer@test.com    Volunteer Task Maker
//   live-parent@test.com       parent, linked to the student
//   live-school@test.com       the club's adviser
//   live-organization@test.com organization
// No admin: an admin account with a password typed into a script is too
// strong a key to leave lying around. Admin is granted through ADMIN_EMAIL.
//
// Safe to re-run: it resets these five accounts' password and links and
// touches nothing else. The local test accounts (seed-test-accounts.mjs) stay
// local; this one refuses a database on this machine instead.
import readline from 'node:readline'
import { stdin, stdout } from 'node:process'

// One readline for every question (a second one would miss input that
// arrived early). Hidden answers aren't echoed.
const rl = readline.createInterface({ input: stdin, output: stdout, terminal: Boolean(stdin.isTTY) })
let muted = false
rl._writeToOutput = (s) => { if (!muted) rl.output.write(s) }
const lines = []
let waiting = null
rl.on('line', (line) => { if (waiting) { const w = waiting; waiting = null; w(line) } else lines.push(line) })
function ask(question, { hidden = false } = {}) {
  stdout.write(question)
  muted = hidden
  return new Promise((resolve) => {
    const done = (answer) => { muted = false; if (hidden) stdout.write('\n'); resolve(String(answer).trim()) }
    if (lines.length) done(lines.shift()); else waiting = done
  })
}

const url = process.env.LIVE_DATABASE_URL || await ask('Live database address (hidden): ', { hidden: true })
if (!url) { console.error('No database address. Nothing done.'); process.exit(1) }
process.env.DATABASE_URL = url

const { isLocalDatabaseUrl } = await import('../server/localDb.js')
if (isLocalDatabaseUrl(url)) {
  console.error('That is a database on this machine. For local test accounts use: npm run seed:test-accounts')
  process.exit(1)
}

const { isWeakPassword } = await import('../server/validate.js')
const password = await ask('Password for the five test accounts (hidden, 12+ characters): ', { hidden: true })
const again = await ask('Type it again (hidden): ', { hidden: true })
if (password !== again) { console.error('The two passwords are different. Nothing done.'); process.exit(1) }
if (password.length < 12 || isWeakPassword(password)) {
  console.error('Pick a longer, less common password (12+ characters). Nothing done.')
  process.exit(1)
}

const host = new URL(url).hostname
const ok = await ask(`Create or reset the five live test accounts on ${host}? Type yes: `)
if (ok.toLowerCase() !== 'yes') { console.error('Nothing done.'); process.exit(1) }

rl.close()
const { initSchema, query, getPool } = await import('../server/db.js')
const { hashPassword } = await import('../server/auth.js')

const SCHOOL_ID = 'sch_live_test'
const ORG_ID = 'org_live_test'
const ACCOUNTS = [
  { id: 'usr_live_student', role: 'student', name: 'Live Test Student', email: 'live-student@test.com', schoolId: SCHOOL_ID, grade: '10' },
  { id: 'usr_live_volunteer', role: 'volunteer', name: 'Live Test Task Maker', email: 'live-volunteer@test.com' },
  { id: 'usr_live_parent', role: 'parent', name: 'Live Test Parent', email: 'live-parent@test.com' },
  { id: 'usr_live_school', role: 'school', name: 'Live Test Adviser', email: 'live-school@test.com', schoolId: SCHOOL_ID },
  { id: 'usr_live_org', role: 'org', name: 'Live Test Organization', email: 'live-organization@test.com', organizationId: ORG_ID },
]

await initSchema()

// A free club, so it's never payment-locked and needs no invoice.
await query(
  `INSERT INTO schools (id, name, pin, contact_email, payment_status, plan)
   VALUES ($1, 'Live Test School', 'livetest-2026', 'live-school@test.com', 'unpaid', 'club')
   ON CONFLICT (id) DO NOTHING`,
  [SCHOOL_ID],
)
await query(
  `INSERT INTO organizations (id, name, contact_email) VALUES ($1, 'Live Test Organization', 'live-organization@test.com')
   ON CONFLICT (id) DO NOTHING`,
  [ORG_ID],
)

const hash = await hashPassword(password)
for (const a of ACCOUNTS) {
  await query(
    `INSERT INTO users (id, role, name, email, password_hash, school_id, grade, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (email) DO UPDATE SET role = $2, name = $3, password_hash = $5, school_id = $6, grade = $7, organization_id = $8`,
    [a.id, a.role, a.name, a.email, hash, a.schoolId || null, a.grade || null, a.organizationId || null],
  )
}

// School and organization accounts must set up two-step sign-in; give these
// test ones a long grace period so the password alone signs in, as locally.
await query(
  `UPDATE users SET mfa_required_at = now() + interval '1 year'
    WHERE email = ANY($1) AND role IN ('school', 'school_staff', 'org') AND NOT totp_enabled`,
  [ACCOUNTS.map((a) => a.email)],
)

await query(
  `INSERT INTO parent_child_links (parent_id, child_id)
   SELECT p.id, c.id FROM users p, users c WHERE p.email = 'live-parent@test.com' AND c.email = 'live-student@test.com'
   ON CONFLICT DO NOTHING`,
)

console.log(`Done on ${host}. The five live test accounts (password: the one you just typed):`)
for (const a of ACCOUNTS) console.log(`  ${a.role.padEnd(10)} ${a.email}`)
console.log('School code for joining: livetest-2026')
await getPool().end()
