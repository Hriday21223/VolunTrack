import { query, getPool } from './db.js'

// A school account is on one of two plans (#506):
//  - 'school': the paid plan. Registered with a code or invite from us, and
//    locked until its payment is verified.
//  - 'club': free for one adviser and up to CLUB_STUDENT_LIMIT students, with
//    every school feature. Anyone can register one, and it is never
//    payment-locked. The admin switches it to 'school' when it upgrades.
export const CLUB_STUDENT_LIMIT = 50
// "One adviser": the club's own account plus at most this many co-advisers.
export const CLUB_MAX_CO_ADMINS = 1
export const PLANS = ['club', 'school']

// Whether a school row may use the school features. Needs `plan` and
// `payment_status` from the row.
export function schoolIsActive(row) {
  return row?.plan === 'club' || row?.payment_status === 'paid'
}

export function clubFullMessage(name) {
  return `${name || 'This club'} is full: a free club can have up to ${CLUB_STUDENT_LIMIT} students. Ask your adviser to upgrade to a school plan.`
}

// The one place a school's students are counted for the club limit.
export async function clubStudentCount(schoolId, run = query) {
  const { rows } = await run(`SELECT COUNT(*)::int AS n FROM users WHERE school_id = $1 AND role = 'student'`, [schoolId])
  return rows[0].n
}

// Null when one more student may join this school; otherwise the error text.
// Only a club has a limit, so a paid school always gets null. An early,
// friendly check: the write itself must go through joinWithSeat(), which
// re-checks under a lock.
export async function clubSeatProblem(schoolId) {
  if (!schoolId) return null
  const { rows } = await query('SELECT plan, name FROM schools WHERE id = $1', [schoolId])
  const school = rows[0]
  if (!school || school.plan !== 'club') return null
  return (await clubStudentCount(schoolId)) >= CLUB_STUDENT_LIMIT ? clubFullMessage(school.name) : null
}

// Runs `write(client)` — the statement that puts a student into this school —
// only if a seat is free, holding the school row locked so two joins at the
// same moment can't both take the last seat. Returns { error } when the club
// is full, else { result } with whatever `write` returned.
export async function joinWithSeat(schoolId, write) {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query('SELECT plan, name FROM schools WHERE id = $1 FOR UPDATE', [schoolId])
    const school = rows[0]
    if (school?.plan === 'club' && (await clubStudentCount(schoolId, (t, p) => client.query(t, p))) >= CLUB_STUDENT_LIMIT) {
      await client.query('ROLLBACK')
      return { error: clubFullMessage(school.name) }
    }
    const result = await write(client)
    await client.query('COMMIT')
    return { result }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
