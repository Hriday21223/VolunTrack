// Dev-only: creates the test accounts (one per role) in a local database, so
// they exist on this machine and never on the live site. Safe to re-run: it
// resets each account's password and links, and leaves everything else alone.
//
// Refuses to run unless DATABASE_URL points at this machine (localhost) —
// the test accounts share one well-known password.
//
// Usage: npm run seed:test-accounts
import dotenv from 'dotenv'
import { initSchema, query, getPool } from '../server/db.js'
import { hashPassword } from '../server/auth.js'
import { isLocalDatabaseUrl } from '../server/localDb.js'

dotenv.config()

if (!isLocalDatabaseUrl()) {
  console.error('Refusing to seed test accounts: DATABASE_URL is not a database on this machine.')
  console.error('Point DATABASE_URL at a local Postgres (see .env.example) and try again.')
  process.exit(1)
}

const PASSWORD = process.env.TEST_ACCOUNT_PASSWORD || 'Test1234!'
const SCHOOL_ID = 'sch_test_demo'
const ORG_ID = 'org_test_demo'

const ACCOUNTS = [
  { id: 'usr_test_student', role: 'student', name: 'Test Student', email: 'student@test.com', schoolId: SCHOOL_ID, grade: '10' },
  { id: 'usr_test_volunteer', role: 'volunteer', name: 'Test Volunteer', email: 'volunteer@test.com' },
  { id: 'usr_test_parent', role: 'parent', name: 'Test Parent', email: 'parent@test.com' },
  { id: 'usr_test_school', role: 'school', name: 'Test School', email: 'school@test.com', schoolId: SCHOOL_ID },
  { id: 'usr_test_org', role: 'org', name: 'Test Organization', email: 'organization@test.com', organizationId: ORG_ID },
  { id: 'usr_test_admin', role: 'admin', name: 'Admin', email: 'admin@test.com' },
]

await initSchema()

await query(
  `INSERT INTO schools (id, name, pin, contact_email, payment_status) VALUES ($1, 'Demo High School', 'TEST01', 'school@test.com', 'paid')
   ON CONFLICT (id) DO NOTHING`,
  [SCHOOL_ID],
)
await query(
  `INSERT INTO organizations (id, name, contact_email) VALUES ($1, 'Test Organization', 'organization@test.com')
   ON CONFLICT (id) DO NOTHING`,
  [ORG_ID],
)

const hash = await hashPassword(PASSWORD)
for (const a of ACCOUNTS) {
  await query(
    `INSERT INTO users (id, role, name, email, password_hash, school_id, grade, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (email) DO UPDATE SET role = $2, name = $3, password_hash = $5, school_id = $6, grade = $7, organization_id = $8`,
    [a.id, a.role, a.name, a.email, hash, a.schoolId || null, a.grade || null, a.organizationId || null],
  )
}

// Roles that must use two-factor get a far-off enrolment deadline, so they
// sign in locally with the password alone (the app still offers setup).
await query(
  `UPDATE users SET mfa_required_at = now() + interval '10 years'
    WHERE email = ANY($1) AND role IN ('admin', 'school', 'school_staff', 'org') AND NOT totp_enabled`,
  [ACCOUNTS.map((a) => a.email)],
)

// Link the parent to the student. Looked up by email, since an account that
// already existed keeps its original id.
await query(
  `INSERT INTO parent_child_links (parent_id, child_id)
   SELECT p.id, c.id FROM users p, users c WHERE p.email = 'parent@test.com' AND c.email = 'student@test.com'
   ON CONFLICT DO NOTHING`,
)

console.log(`Seeded ${ACCOUNTS.length} test accounts (password from TEST_ACCOUNT_PASSWORD, or the default in this file):`)
for (const a of ACCOUNTS) console.log(`  ${a.role.padEnd(10)} ${a.email}`)
await getPool().end()
