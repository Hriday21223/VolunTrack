// Database-backed lookups for tenant requirements. server/requirements.js is
// the pure policy logic (shared with the browser via the @policy alias); this
// is the half that needs Postgres, kept separate so client code can import the
// rules without dragging a database driver behind them.

import { query } from './db.js'
import { resolvePolicy, normalizePolicy } from './requirements.js'

/**
 * The effective policy for one user, and the tenant it came from.
 *
 * Read fresh from the users row rather than the JWT: a student who transfers
 * schools mid-session must be held to the new school's rules on their next
 * save, not the ones baked into a token issued hours ago.
 */
export async function policyForUser(userId) {
  const { rows } = await query(
    `SELECT u.school_id, u.grade, s.name AS school_name, s.requirements AS school_requirements,
            o.id AS organization_id, o.name AS organization_name, o.requirements AS org_requirements
       FROM users u
       LEFT JOIN schools s ON s.id = u.school_id
       LEFT JOIN organizations o ON o.id = s.organization_id
      WHERE u.id = $1`,
    [userId],
  )
  const row = rows[0]
  if (!row) return null
  const resolved = resolvePolicy({
    schoolPolicy: row.school_requirements,
    orgPolicy: row.org_requirements,
    orgName: row.organization_name,
  })
  return {
    ...resolved,
    schoolId: row.school_id || null,
    schoolName: row.school_name || null,
    organizationId: row.organization_id || null,
    grade: row.grade || null,
  }
}

/** Effective policy for a school, as its own admins see it. */
export async function policyForSchool(schoolId) {
  const { rows } = await query(
    `SELECT s.name AS school_name, s.requirements AS school_requirements,
            o.id AS organization_id, o.name AS organization_name, o.requirements AS org_requirements
       FROM schools s
       LEFT JOIN organizations o ON o.id = s.organization_id
      WHERE s.id = $1`,
    [schoolId],
  )
  const row = rows[0]
  if (!row) return null
  return {
    schoolName: row.school_name,
    organizationId: row.organization_id || null,
    organizationName: row.organization_name || null,
    // What this school itself has set — the sections present here are the ones
    // it overrides. The editor needs this, not just the resolved result, or
    // saving the form would silently convert every inherited section into an
    // override.
    own: normalizePolicy(row.school_requirements),
    inherited: normalizePolicy(row.org_requirements),
    ...resolvePolicy({
      schoolPolicy: row.school_requirements,
      orgPolicy: row.org_requirements,
      orgName: row.organization_name,
    }),
  }
}

/** Policy that applies at sign-in time, resolved from the account's email. */
export async function signInPolicyForEmail(email) {
  const { rows } = await query(
    `SELECT s.requirements AS school_requirements, o.requirements AS org_requirements,
            s.name AS school_name
       FROM users u
       LEFT JOIN schools s ON s.id = u.school_id
       LEFT JOIN organizations o ON o.id = s.organization_id
      WHERE u.email = $1`,
    [email],
  )
  const row = rows[0]
  if (!row) return null
  const { policy } = resolvePolicy({
    schoolPolicy: row.school_requirements,
    orgPolicy: row.org_requirements,
  })
  return { policy, schoolName: row.school_name || null }
}

/**
 * Hours already logged by this user on a date, excluding one log.
 *
 * Only called when the policy sets a per-day cap — the rule cannot be checked
 * from the submitted entry alone, and there is no reason to pay for the query
 * when no tenant asked for the limit.
 */
export async function hoursLoggedOn(userId, date, excludeLogId = null) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(hours), 0) AS total FROM logs
      WHERE user_id = $1 AND date = $2 AND ($3::text IS NULL OR id <> $3)`,
    [userId, date, excludeLogId],
  )
  return Number(rows[0]?.total) || 0
}
