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

// A custom date range (#610), for grant reports: ?from=YYYY-MM-DD&to=YYYY-MM-DD,
// both days included. At most MAX_RANGE_DAYS long.
export const MAX_RANGE_DAYS = 366 * 5
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const shiftYears = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCFullYear(d.getUTCFullYear() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Reads ?from=&to= into a range for impactFor ({ from, to } with `to`
 * exclusive). Returns null when neither is given, or { error } when invalid.
 */
export function rangeFromQuery(q = {}) {
  const from = q.from == null ? '' : String(q.from)
  const to = q.to == null ? '' : String(q.to)
  if (!from && !to) return null
  const valid = (s) => DATE_RE.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s)
  if (!valid(from) || !valid(to)) return { error: 'Use dates like 2026-01-31 for both the start and the end.' }
  if (from > to) return { error: 'The start date must be on or before the end date.' }
  const days = (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000
  if (days > MAX_RANGE_DAYS) return { error: 'Pick a range of five years or less.' }
  return { from, to: addDays(to, 1), lastDay: to }
}

// A place only appears when two or more students served there, so a small
// school's report can't point to one student.
const MIN_STUDENTS_PER_PLACE = 2
const TOP_CATEGORIES = 6
const TOP_PLACES = 5

const round = (n) => Math.round((Number(n) || 0) * 100) / 100

// `range` ({ from, to }, to exclusive) overrides the period, e.g. one month
// for the monthly impact email (#573).
export async function impactFor(schoolIds, period = 'year', now = new Date(), range = null) {
  const since = range ? range.from : period === 'all' ? null : schoolYearStart(now)
  const until = range ? range.to : null
  const where = `u.school_id = ANY($1) AND u.role = 'student'
    AND l.verification_status IS DISTINCT FROM 'rejected'
    AND ($2::date IS NULL OR l.date >= $2::date)
    AND ($3::date IS NULL OR l.date < $3::date)`
  const params = [schoolIds, since, until]

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
            GROUP BY 1 ORDER BY 1 DESC LIMIT 24`, params),
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

  // Hours by grade (#610). Like places, a grade shows only once two or more
  // students in it volunteered; smaller groups are folded together.
  const grades = await query(
    `SELECT COALESCE(NULLIF(TRIM(u.grade), ''), 'Not set') AS name, SUM(l.hours)::float AS hours,
            COUNT(DISTINCT l.user_id)::int AS students
       FROM logs l JOIN users u ON u.id = l.user_id WHERE ${where}
      GROUP BY 1 ORDER BY 1`, params,
  )
  const byGrade = grades.rows.filter((g) => g.students >= MIN_STUDENTS_PER_PLACE).map((g) => ({ name: g.name, hours: round(g.hours), students: g.students }))
  const folded = grades.rows.filter((g) => g.students < MIN_STUDENTS_PER_PLACE)
  if (folded.length) {
    const n = folded.reduce((s, g) => s + g.students, 0)
    if (n >= MIN_STUDENTS_PER_PLACE || byGrade.length) {
      byGrade.push({ name: 'Other grades', hours: round(folded.reduce((s, g) => s + g.hours, 0)), students: n })
    }
  }

  // The same dates a year earlier, for "compared with last year" (#610).
  let lastYear = null
  if (range) {
    const prev = await query(
      `SELECT COALESCE(SUM(l.hours), 0)::float AS hours, COUNT(*)::int AS entries,
              COUNT(DISTINCT l.user_id)::int AS active
         FROM logs l JOIN users u ON u.id = l.user_id WHERE ${where}`,
      [schoolIds, shiftYears(range.from, -1), shiftYears(range.to, -1)],
    )
    lastYear = {
      from: shiftYears(range.from, -1),
      to: shiftYears(addDays(range.to, -1), -1),
      hours: round(prev.rows[0].hours),
      entries: prev.rows[0].entries,
      activeStudents: prev.rows[0].active,
    }
  }

  return {
    period: range ? 'range' : period,
    since,
    until: range ? addDays(range.to, -1) : null,
    lastYear,
    byGrade,
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
export async function impactBySchool(schoolIds, period = 'year', now = new Date(), range = null) {
  const since = range ? range.from : period === 'all' ? null : schoolYearStart(now)
  const until = range ? range.to : null
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
             AND ($3::date IS NULL OR l.date < $3::date)
      WHERE s.id = ANY($1)
      GROUP BY s.id, s.name
      ORDER BY hours DESC, s.name`,
    [schoolIds, since, until],
  )
  return rows.map((r) => ({ name: r.name, hours: round(r.hours), activeStudents: r.active, students: r.students }))
}
