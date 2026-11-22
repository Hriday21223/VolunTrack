// Limits on what a co-admin (school_staff) sees. The school's main admin, or
// for a caseload the co-admin themself, can set:
//  - club-only (#674): the students in the clubs they advise;
//  - a caseload (#972): students whose last names fall in their ranges
//    (server/nameRange.js) and, if set, in their grades.
// Both together means either group. clubScope() returns null (no limit) or the
// Set of student ids they may see; every staff route that lists or decides on
// students filters through it.
import { query } from './db.js'
import { inAnyRange } from './nameRange.js'
import { gradeKey } from './requirements.js'

export async function clubScope(userId) {
  const { rows } = await query('SELECT role, school_id, club_scoped, scope_ranges, scope_grades FROM users WHERE id = $1', [userId])
  const me = rows[0]
  if (!me || me.role !== 'school_staff') return null
  const ranges = Array.isArray(me.scope_ranges) ? me.scope_ranges : []
  const grades = Array.isArray(me.scope_grades) ? me.scope_grades : []
  const caseload = ranges.length > 0 || grades.length > 0
  if (!me.club_scoped && !caseload) return null

  const allowed = new Set()
  if (me.club_scoped) {
    const { rows: ids } = await query(
      `SELECT DISTINCT m.user_id FROM club_advisers a JOIN club_members m ON m.club_id = a.club_id
        WHERE a.user_id = $1`,
      [userId],
    )
    for (const r of ids) allowed.add(r.user_id)
  }
  if (caseload && me.school_id) {
    const { rows: students } = await query(`SELECT id, name, grade FROM users WHERE school_id = $1 AND role = 'student'`, [me.school_id])
    const gradeSet = new Set(grades)
    for (const s of students) {
      if (ranges.length && !inAnyRange(s.name, ranges)) continue
      if (gradeSet.size && !gradeSet.has(gradeKey(s.grade))) continue
      allowed.add(s.id)
    }
  }
  return allowed
}

export const inScope = (scope, studentId) => !scope || scope.has(String(studentId))

export const OUT_OF_SCOPE = 'This student isn’t one of yours.'

// Grades a request sent, normalized like a student's (gradeKey). → { grades } or { error }.
export function readGrades(input) {
  if (input == null) return { grades: [] }
  if (!Array.isArray(input) || input.length > 20) return { error: 'Send the grades as a list.' }
  const grades = [...new Set(input.map((g) => gradeKey(g)).filter(Boolean))]
  return { grades }
}
