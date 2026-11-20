import { query } from './db.js'
import { hashPassword } from './auth.js'
import { randomBytes } from 'crypto'

// The five test accounts for trying each kind of account on the live site
// (#888, #890). All @test.com, so they're never emailed and are left out of
// the admin's sign-up counts. Shared by scripts/seed-live-test-accounts.mjs
// and the admin's "Sign in as a test account" card.
export const LIVE_TEST_SCHOOL_ID = 'sch_live_test'
export const LIVE_TEST_ORG_ID = 'org_live_test'
export const LIVE_TEST_ACCOUNTS = [
  { id: 'usr_live_student', role: 'student', name: 'Live Test Student', email: 'live-student@test.com', schoolId: LIVE_TEST_SCHOOL_ID, grade: '10' },
  { id: 'usr_live_volunteer', role: 'volunteer', name: 'Live Test Task Maker', email: 'live-volunteer@test.com' },
  { id: 'usr_live_parent', role: 'parent', name: 'Live Test Parent', email: 'live-parent@test.com' },
  { id: 'usr_live_school', role: 'school', name: 'Live Test Adviser', email: 'live-school@test.com', schoolId: LIVE_TEST_SCHOOL_ID },
  { id: 'usr_live_org', role: 'org', name: 'Live Test Organization', email: 'live-organization@test.com', organizationId: LIVE_TEST_ORG_ID },
]

export function liveTestAccountForRole(role) {
  return LIVE_TEST_ACCOUNTS.find((a) => a.role === role) || null
}

// Creates whatever is missing. With a password it also resets all five to it
// (the seed script); without one, new accounts get a random password nobody
// knows and existing ones keep theirs (the admin card signs in without one).
export async function ensureLiveTestAccounts({ password = null } = {}) {
  // A free club, so it's never payment-locked and needs no invoice.
  await query(
    `INSERT INTO schools (id, name, pin, contact_email, payment_status, plan)
     VALUES ($1, 'Live Test School', 'livetest-2026', 'live-school@test.com', 'unpaid', 'club')
     ON CONFLICT (id) DO NOTHING`,
    [LIVE_TEST_SCHOOL_ID],
  )
  await query(
    `INSERT INTO organizations (id, name, contact_email) VALUES ($1, 'Live Test Organization', 'live-organization@test.com')
     ON CONFLICT (id) DO NOTHING`,
    [LIVE_TEST_ORG_ID],
  )
  // The test school belongs to the test organization, so the organization's
  // features that span its schools (hours, compare, announcements, events,
  // partners) can be tried with real data. Only while it has no organization,
  // so a deliberate change is never undone.
  await query(
    `UPDATE schools SET organization_id = $2 WHERE id = $1 AND organization_id IS NULL`,
    [LIVE_TEST_SCHOOL_ID, LIVE_TEST_ORG_ID],
  )

  const hash = await hashPassword(password || randomBytes(24).toString('base64url'))
  for (const a of LIVE_TEST_ACCOUNTS) {
    const params = [a.id, a.role, a.name, a.email, hash, a.schoolId || null, a.grade || null, a.organizationId || null]
    await query(
      `INSERT INTO users (id, role, name, email, password_hash, school_id, grade, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (email) DO UPDATE SET role = $2, name = $3, school_id = $6, grade = $7, organization_id = $8
         ${password ? ', password_hash = $5' : ''}`,
      params,
    )
  }

  // School and organization accounts must set up two-step sign-in; give these
  // test ones a long grace period so the password alone signs in.
  await query(
    `UPDATE users SET mfa_required_at = now() + interval '1 year'
      WHERE email = ANY($1) AND role IN ('school', 'school_staff', 'org') AND NOT totp_enabled`,
    [LIVE_TEST_ACCOUNTS.map((a) => a.email)],
  )

  await query(
    `INSERT INTO parent_child_links (parent_id, child_id)
     SELECT p.id, c.id FROM users p, users c WHERE p.email = 'live-parent@test.com' AND c.email = 'live-student@test.com'
     ON CONFLICT DO NOTHING`,
  )
}
