// School vs school challenge (#575): an organization runs one challenge at a
// time across the schools it owns, e.g. "Most hours in November". Schools are
// ranked by total hours, or hours per student (fairer between big and small
// schools), counting entries dated within the challenge, rejected left out.
// Only school names and numbers leave the server, never a student.
import { query } from './db.js'

export const METRICS = ['total', 'per_student']

const round = (n) => Math.round((Number(n) || 0) * 100) / 100

export async function activeOrgChallenge(orgId) {
  const { rows } = await query(
    `SELECT id, title, metric, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on,
            (ends_on < CURRENT_DATE) AS finished
       FROM org_challenges WHERE organization_id = $1 AND ended_at IS NULL`,
    [orgId],
  )
  const c = rows[0]
  return c ? { id: c.id, title: c.title, metric: c.metric, startsOn: c.starts_on, endsOn: c.ends_on, finished: c.finished } : null
}

export async function scoreboard(orgId, challenge) {
  const { rows } = await query(
    `SELECT s.id, s.name,
            COUNT(DISTINCT u.id)::int AS students,
            COUNT(DISTINCT l.user_id)::int AS active,
            COALESCE(SUM(l.hours), 0)::float AS hours
       FROM schools s
       LEFT JOIN users u ON u.school_id = s.id AND u.role = 'student'
       LEFT JOIN logs l ON l.user_id = u.id
             AND l.verification_status IS DISTINCT FROM 'rejected'
             AND l.date BETWEEN $2::date AND $3::date
      WHERE s.organization_id = $1
      GROUP BY s.id, s.name`,
    [orgId, challenge.startsOn, challenge.endsOn],
  )
  const board = rows.map((r) => ({
    schoolId: r.id,
    name: r.name,
    hours: round(r.hours),
    students: r.students,
    active: r.active,
    perStudent: r.students ? round(r.hours / r.students) : 0,
  }))
  const key = challenge.metric === 'per_student' ? 'perStudent' : 'hours'
  board.sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name))
  // Ties share a rank.
  let rank = 0
  let last = null
  board.forEach((row, i) => {
    if (row[key] !== last) { rank = i + 1; last = row[key] }
    row.rank = rank
  })
  return board
}
