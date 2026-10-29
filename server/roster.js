// Class roster (#584): when a school invites a whole class from its roster
// CSV, the name and grade next to each address are kept here until that
// student joins. Joining (by code, by accepting the in-app invite, or by a
// transfer the school accepts) then sets their grade from it, so they skip
// the grade picker. Each row is deleted once used, and rows nobody used are
// dropped after ROSTER_KEEP_DAYS: a roster of students who never signed up
// is not ours to keep.

import { query } from './db.js'
import { policyForSchool } from './policy.js'
import { gradeKey, schoolGrades } from './requirements.js'

export const ROSTER_KEEP_DAYS = 180
const NAME_MAX = 100

/** A roster grade as this school's grade key, or null if it doesn't have it. */
export function rosterGrade(policy, raw) {
  const key = gradeKey(raw)
  return key && schoolGrades(policy).includes(key) ? key : null
}

/**
 * Saves the names and grades from a roster upload. `entries` is
 * [{ email, name, grade }] with lower-case emails; blank fields are kept from
 * an earlier upload rather than wiped. Returns how many grades were usable.
 */
export async function saveRoster(schoolId, addedBy, entries) {
  const withData = entries.filter((e) => e.name || e.grade)
  if (withData.length === 0) return { grades: 0, unknownGrades: 0 }
  const target = await policyForSchool(schoolId)
  let grades = 0
  let unknownGrades = 0
  for (const e of withData) {
    const grade = e.grade ? rosterGrade(target?.policy, e.grade) : null
    if (e.grade && !grade) unknownGrades += 1
    if (grade) grades += 1
    const name = e.name ? String(e.name).trim().slice(0, NAME_MAX) || null : null
    if (!name && !grade) continue
    await query(
      `INSERT INTO school_roster_entries (school_id, email, name, grade, added_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (school_id, email) DO UPDATE
         SET name = COALESCE(EXCLUDED.name, school_roster_entries.name),
             grade = COALESCE(EXCLUDED.grade, school_roster_entries.grade),
             added_by = EXCLUDED.added_by, added_at = now()`,
      [schoolId, e.email, name, grade, addedBy],
    )
  }
  await query(`DELETE FROM school_roster_entries WHERE added_at < now() - interval '${ROSTER_KEEP_DAYS} days'`)
  return { grades, unknownGrades }
}

/** The roster row for this address at this school, or null. */
export async function rosterEntry(schoolId, email) {
  if (!schoolId || !email) return null
  const { rows } = await query(
    `SELECT name, grade FROM school_roster_entries
      WHERE school_id = $1 AND email = $2 AND added_at > now() - interval '${ROSTER_KEEP_DAYS} days'`,
    [schoolId, String(email).toLowerCase()],
  )
  return rows[0] || null
}

/**
 * After a student is linked to a school: set their grade from the school's
 * roster if it lists them with a grade the school has, then drop the row.
 * Never throws: a missing roster must not undo a join that already happened.
 * Returns the grade set, or null.
 */
export async function applyRosterGrade(schoolId, userId) {
  try {
    const { rows } = await query('SELECT email FROM users WHERE id = $1', [userId])
    const email = rows[0]?.email
    const entry = await rosterEntry(schoolId, email)
    if (!entry) return null
    let set = null
    if (entry.grade) {
      const target = await policyForSchool(schoolId)
      set = rosterGrade(target?.policy, entry.grade)
      if (set) await query('UPDATE users SET grade = $1 WHERE id = $2', [set, userId])
    }
    await query('DELETE FROM school_roster_entries WHERE school_id = $1 AND email = $2', [schoolId, String(email).toLowerCase()])
    return set
  } catch (error) {
    console.error('roster grade failed:', error.message)
    return null
  }
}
