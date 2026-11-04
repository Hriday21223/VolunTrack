// Club-only advisers (#674): the school's main admin can limit a co-admin
// (school_staff) to the students in the clubs they advise. clubScope() returns
// null (no limit) or the Set of student ids they may see; every staff route
// that lists or decides on students filters through it.
import { query } from './db.js'

export async function clubScope(userId) {
  const { rows } = await query('SELECT role, club_scoped FROM users WHERE id = $1', [userId])
  const me = rows[0]
  if (!me || me.role !== 'school_staff' || !me.club_scoped) return null
  const { rows: ids } = await query(
    `SELECT DISTINCT m.user_id FROM club_advisers a JOIN club_members m ON m.club_id = a.club_id
      WHERE a.user_id = $1`,
    [userId],
  )
  return new Set(ids.map((r) => r.user_id))
}

export const inScope = (scope, studentId) => !scope || scope.has(String(studentId))

export const OUT_OF_SCOPE = 'This student isn’t in one of your clubs.'
