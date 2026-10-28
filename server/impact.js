// Impact report (#563): what a school's or an organization's students did,
// as counts only — never a name, an email or one student's entries. The page
// itself is drawn in the browser (src/lib/impactReport.js); a student's own
// report is built there from their own logs.
//
// Hours count like the requirement: everything but rejected entries.
import { query } from './db.js'

// Where the "this school year" period starts: the latest August 1st.
export function schoolYearStart(now = new Date()) {
  const y = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  return `${y}-08-01`
}

export const PERIODS = ['year', 'all']

// A place only appears when two or more students served there, so a small
// school's report can't point to one student.
const MIN_STUDENTS_PER_PLACE = 2
const TOP_CATEGORIES = 6
const TOP_PLACES = 5

const round = (n) => Math.round((Number(n) || 0) * 100) / 100

export async function impactFor(schoolIds, period = 'year', now = new Date()) {
  const since = period === 'all' ? null : schoolYearStart(now)
  const where = `u.school_id = ANY($1) AND u.role = 'student'
    AND l.verification_status IS DISTINCT FROM 'rejected'
    AND ($2::date IS NULL OR l.date >= $2::date)`
  const params = [schoolIds, since]

  const [totals, people, cats, months, places] = await Promise.all([
    query(`SELECT COALESCE(SUM(l.hours), 0)::float AS hours, COUNT(*)::int AS entries,
                  COUNT(DISTINCT l.user_id)::int AS active
             FROM logs l JOIN users u ON u.id = l.user_id WHERE ${where}`, params),
    query(`SELECT COUNT(*)::int AS n FROM users WHERE school_id = ANY($1) AND role = 'student'`, [schoolIds]),
    query(`SELECT COALESCE(NULLIF(l.category, ''), 'Other') AS name, SUM(l.hours)::float AS hours
             FROM logs l JOIN users u ON u.id = l.user_id WHERE ${where}
            GROUP BY 1 ORDER BY 2 DESC`, params),
    query(`SELECT to_char(l.date, 'YYYY-MM') AS month, SUM(l.hours)::float AS hours
             FROM logs l JOIN users u ON u.id = l.user_id WHERE ${where}
            GROUP BY 1 ORDER BY 1 DESC LIMIT 12`, params),
    query(`SELECT MIN(TRIM(l.org_name)) AS name, SUM(l.hours)::float AS hours
             FROM logs l JOIN users u ON u.id = l.user_id
            WHERE ${where} AND NULLIF(TRIM(l.org_name), '') IS NOT NULL
            GROUP BY LOWER(TRIM(l.org_name))
           HAVING COUNT(DISTINCT l.user_id) >= ${MIN_STUDENTS_PER_PLACE}
            ORDER BY 2 DESC LIMIT ${TOP_PLACES}`, params),
  ])

  // The biggest causes, and the rest folded into one line.
  const byCategory = cats.rows.slice(0, TOP_CATEGORIES).map((c) => ({ name: c.name, hours: round(c.hours) }))
  const rest = cats.rows.slice(TOP_CATEGORIES).reduce((sum, c) => sum + c.hours, 0)
  if (rest > 0) byCategory.push({ name: 'Everything else', hours: round(rest) })

  return {
    period,
    since,
    hours: round(totals.rows[0].hours),
    entries: totals.rows[0].entries,
    activeStudents: totals.rows[0].active,
    totalStudents: people.rows[0].n,
    byCategory,
    byMonth: months.rows.reverse().map((m) => ({ month: m.month, hours: round(m.hours) })),
    topPlaces: places.rows.map((p) => ({ name: p.name, hours: round(p.hours) })),
  }
}

// Per-school totals for an organization's report.
export async function impactBySchool(schoolIds, period = 'year', now = new Date()) {
  const since = period === 'all' ? null : schoolYearStart(now)
  const { rows } = await query(
    `SELECT s.id, s.name,
            COALESCE(SUM(l.hours) FILTER (WHERE l.id IS NOT NULL), 0)::float AS hours,
            COUNT(DISTINCT l.user_id)::int AS active,
            COUNT(DISTINCT u.id)::int AS students
       FROM schools s
       LEFT JOIN users u ON u.school_id = s.id AND u.role = 'student'
       LEFT JOIN logs l ON l.user_id = u.id
             AND l.verification_status IS DISTINCT FROM 'rejected'
             AND ($2::date IS NULL OR l.date >= $2::date)
      WHERE s.id = ANY($1)
      GROUP BY s.id, s.name
      ORDER BY hours DESC, s.name`,
    [schoolIds, since],
  )
  return rows.map((r) => ({ name: r.name, hours: round(r.hours), activeStudents: r.active, students: r.students }))
}
