import { query } from './db.js'

// A school account is on one of two plans (#506):
//  - 'school': the paid plan. Registered with a code or invite from us, and
//    locked until its payment is verified.
//  - 'club': free for one adviser and up to CLUB_STUDENT_LIMIT students, with
//    every school feature. Anyone can register one, and it is never
//    payment-locked. The admin switches it to 'school' when it upgrades.
export const CLUB_STUDENT_LIMIT = 50
export const PLANS = ['club', 'school']

// Whether a school row may use the school features. Needs `plan` and
// `payment_status` from the row.
export function schoolIsActive(row) {
  return row?.plan === 'club' || row?.payment_status === 'paid'
}

export function clubFullMessage(name) {
  return `${name || 'This club'} is full: a free club can have up to ${CLUB_STUDENT_LIMIT} students. Ask your adviser to upgrade to a school plan.`
}

// Null when one more student may join this school; otherwise the error text.
// Only a club has a limit, so a paid school always gets null.
export async function clubSeatProblem(schoolId) {
  if (!schoolId) return null
  const { rows } = await query(
    `SELECT s.plan, s.name,
            (SELECT COUNT(*) FROM users u WHERE u.school_id = s.id AND u.role = 'student')::int AS students
       FROM schools s WHERE s.id = $1`,
    [schoolId],
  )
  const school = rows[0]
  if (!school || school.plan !== 'club') return null
  return school.students >= CLUB_STUDENT_LIMIT ? clubFullMessage(school.name) : null
}
