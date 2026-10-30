// Impact report (#563): one printable page of what a student, a school or an
// organization did — hours, what they're worth, causes, months and places.
// Schools and organizations get their numbers from the server
// (server/impact.js, counts only); a student's are built here from their own
// logs. Opens the print dialog like the certificates (src/lib/export.js).

// The national value of a volunteer hour, from Independent Sector and the Do
// Good Institute (University of Maryland), released April 2026. Update it each
// spring when the new figure comes out.
export const VALUE_PER_HOUR = 36.14
export const VALUE_SOURCE = 'Independent Sector, 2026 national value of volunteer time'

export const PERIOD_LABELS = {
  year: 'This school year',
  lastMonth: 'Last month',
  lastQuarter: 'Last quarter',
  calendarYear: 'This calendar year',
  lastCalendarYear: 'Last calendar year',
  all: 'All time',
  custom: 'Custom dates…',
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * The dates a preset covers, both days included, or null for 'year' and
 * 'all' (the server's own periods) and 'custom' (the person picks).
 */
export function presetRange(preset, now = new Date()) {
  const y = now.getFullYear()
  const m = now.getMonth()
  if (preset === 'lastMonth') return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) }
  if (preset === 'lastQuarter') {
    const q = Math.floor(m / 3)
    return { from: ymd(new Date(y, q * 3 - 3, 1)), to: ymd(new Date(y, q * 3, 0)) }
  }
  if (preset === 'calendarYear') return { from: `${y}-01-01`, to: ymd(now) }
  if (preset === 'lastCalendarYear') return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }
  return null
}

const round = (n) => Math.round((Number(n) || 0) * 100) / 100

// The latest August 1st, as the server counts a school year.
export function schoolYearStart(now = new Date()) {
  const y = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1
  return `${y}-08-01`
}

/**
 * A student's own impact from their counted logs (rejected already left out),
 * in the same shape the server sends for a school.
 */
export function studentImpact(logs, period = 'year', now = new Date(), range = null) {
  const since = range ? range.from : period === 'all' ? null : schoolYearStart(now)
  const until = range ? range.to : null
  const inRange = (l, from, to) => {
    const d = String(l.date).slice(0, 10)
    return (!from || d >= from) && (!to || d <= to)
  }
  const inPeriod = (logs || []).filter((l) => l.date && inRange(l, since, until))
  const sum = (list) => list.reduce((s, l) => s + (Number(l.hours) || 0), 0)
  const group = (key) => {
    const map = new Map()
    for (const l of inPeriod) {
      const raw = String(key(l) || '').trim()
      if (!raw) continue
      const k = raw.toLowerCase()
      const cur = map.get(k) || { name: raw, hours: 0 }
      cur.hours += Number(l.hours) || 0
      map.set(k, cur)
    }
    return [...map.values()].map((g) => ({ ...g, hours: round(g.hours) })).sort((a, b) => b.hours - a.hours)
  }
  const months = new Map()
  for (const l of inPeriod) {
    const m = String(l.date).slice(0, 7)
    months.set(m, (months.get(m) || 0) + (Number(l.hours) || 0))
  }
  const byMonth = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-24).map(([month, hours]) => ({ month, hours: round(hours) }))
  const cats = group((l) => l.category || 'Other')
  const byCategory = cats.slice(0, 6)
  const rest = cats.slice(6).reduce((s, c) => s + c.hours, 0)
  if (rest > 0) byCategory.push({ name: 'Everything else', hours: round(rest) })
  // The same dates a year earlier (#610).
  const yearBack = (s) => `${Number(s.slice(0, 4)) - 1}${s.slice(4)}`
  const lastYear = range
    ? (() => {
      const prev = (logs || []).filter((l) => l.date && inRange(l, yearBack(range.from), yearBack(range.to)))
      return { from: yearBack(range.from), to: yearBack(range.to), hours: round(sum(prev)), entries: prev.length }
    })()
    : null
  return {
    period: range ? 'range' : period,
    since,
    until,
    lastYear,
    hours: round(sum(inPeriod)),
    entries: inPeriod.length,
    byCategory,
    byMonth,
    topPlaces: group((l) => l.orgName).slice(0, 5),
  }
}

const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
const num = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n)
const monthLabel = (ym) => {
  const [y, m] = String(ym).split('-').map(Number)
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-US', { month: 'short' }) + (m === 1 ? ` ’${String(y).slice(2)}` : '')
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function barsHtml(rows, { label = (r) => r.name } = {}) {
  const max = Math.max(...rows.map((r) => r.hours), 0) || 1
  return rows.map((r) => `
    <div class="hrow">
      <div class="hlabel">${escapeHtml(label(r))}</div>
      <div class="htrack"><div class="hbar" style="width:${Math.max(2, (r.hours / max) * 100)}%"></div></div>
      <div class="hval">${num(r.hours)} h</div>
    </div>`).join('')
}

function monthsHtml(byMonth) {
  if (!byMonth.length) return '<p class="muted">No hours logged in this period.</p>'
  const max = Math.max(...byMonth.map((m) => m.hours)) || 1
  return `<div class="cols">${byMonth.map((m) => `
    <div class="col">
      <div class="cval">${num(m.hours)}</div>
      <div class="cbar" style="height:${Math.max(2, (m.hours / max) * 100)}%"></div>
      <div class="clabel">${escapeHtml(monthLabel(m.month))}</div>
    </div>`).join('')}</div>`
}

const longDate = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
const gradeText = (g) => (/^\d+$/.test(String(g)) ? `Grade ${g}` : String(g))

/** "This school year, since August 1, 2026" / "January 1, 2026 – June 30, 2026" / "All time". */
export function periodDescription(data) {
  if (data.period === 'range' && data.since && data.until) return `${longDate(data.since)} – ${longDate(data.until)}`
  if (data.since) return `${PERIOD_LABELS.year}, since ${longDate(data.since)}`
  return PERIOD_LABELS.all
}

/** "Up 24% on the same dates last year (310 hours)." or null. */
export function comparisonText(data) {
  const prev = data.lastYear
  if (!prev) return null
  if (!prev.hours) return 'No hours were logged on the same dates last year.'
  const change = Math.round(((data.hours - prev.hours) / prev.hours) * 100)
  const word = change > 0 ? `Up ${change}%` : change < 0 ? `Down ${-change}%` : 'Level'
  return `${word} on the same dates last year (${num(prev.hours)} hours).`
}

/** The report as a CSV a grant writer can paste into a spreadsheet (#610). */
export function impactCsv({ name, kind, data }) {
  const cell = (v) => {
    const s = String(v ?? '')
    return /^[=+\-@\t\r]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = []
  const add = (...r) => rows.push(r.map(cell).join(','))
  add('Volunteer impact report', name || '')
  add('Period', periodDescription(data))
  add('')
  add('Total hours', data.hours)
  add('Value to the community (USD)', Math.round(data.hours * VALUE_PER_HOUR))
  add('Entries logged', data.entries)
  if (kind !== 'student') add('Students volunteering', data.activeStudents, data.totalStudents != null ? `of ${data.totalStudents}` : '')
  if (data.requirement) add('Met the hour requirement', data.requirement.met, `of ${data.requirement.students}`)
  if (data.lastYear) add('Same dates last year (hours)', data.lastYear.hours)
  const section = (title, head, list, map) => {
    if (!list?.length) return
    add('')
    add(title)
    add(...head)
    for (const r of list) add(...map(r))
  }
  section('Hours by month', ['Month', 'Hours'], data.byMonth, (m) => [m.month, m.hours])
  section('Causes', ['Cause', 'Hours'], data.byCategory, (c) => [c.name, c.hours])
  section('Top places served', ['Place', 'Hours'], data.topPlaces, (p) => [p.name, p.hours])
  section('By grade', ['Grade', 'Hours', 'Students volunteering'], data.byGrade, (g) => [gradeText(g.name), g.hours, g.students])
  section('By school', ['School', 'Hours', 'Value (USD)', 'Students volunteering', 'Students'], data.schools, (s) => [s.name, s.hours, Math.round(s.hours * VALUE_PER_HOUR), s.activeStudents, s.students])
  add('')
  add(`Value uses $${VALUE_PER_HOUR.toFixed(2)} per hour (${VALUE_SOURCE}). Rejected entries are left out.${kind === 'student' ? '' : ' Totals only, never individual students.'}`)
  return `${rows.join('\n')}\n`
}

/**
 * Opens the report in a new window and its print dialog.
 * { name, kind: 'student'|'school'|'organization', data, period }
 * Returns false when the browser blocked the window.
 */
export function printImpactReport({ name, kind, data, period }) {
  const w = window.open('', '_blank', 'width=900,height=1100')
  if (!w) return false
  const value = data.hours * VALUE_PER_HOUR
  const issued = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const periodText = periodDescription(data)
  const stats = [
    [`${num(data.hours)}`, 'volunteer hours'],
    [money(value), 'value to the community'],
    [`${data.entries}`, data.entries === 1 ? 'entry logged' : 'entries logged'],
  ]
  if (kind !== 'student') stats.push([`${data.activeStudents}${data.totalStudents ? ` of ${data.totalStudents}` : ''}`, 'students volunteered'])
  if (data.requirement) stats.push([`${data.requirement.met} of ${data.requirement.students}`, 'met the hour requirement'])
  const compare = comparisonText(data)
  const logo = `${window.location.origin}${import.meta.env.BASE_URL}logo.png`

  w.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(name || 'Volunteer')} — Impact report</title>
<style>
  @page { size: letter portrait; margin: 0.5in; }
  * { box-sizing: border-box; }
  body { font-family: 'Plus Jakarta Sans', Inter, system-ui, sans-serif; color: #1f2a20; margin: 0; padding: 24px; }
  header { display: flex; align-items: center; gap: 14px; border-bottom: 3px solid #3f8344; padding-bottom: 12px; }
  header img { width: 48px; height: auto; }
  .kicker { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #6c502d; }
  h1 { font-size: 26px; margin: 2px 0 0; color: #214327; }
  .period { font-size: 13px; color: #555; margin-top: 2px; }
  .stats { display: grid; grid-template-columns: repeat(${Math.min(stats.length, 5)}, 1fr); gap: 10px; margin: 20px 0; }
  .stat { border: 1px solid #d6e3d4; border-radius: 10px; padding: 12px; background: #f6faf5; }
  .stat b { display: block; font-size: 24px; color: #27542d; }
  .stat span { font-size: 12px; color: #555; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: #6c502d; margin: 22px 0 8px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .hrow { display: grid; grid-template-columns: 38% 1fr 60px; align-items: center; gap: 8px; font-size: 12px; margin: 5px 0; }
  .hlabel { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .htrack { background: #edf3ec; border-radius: 4px; height: 10px; }
  .hbar { background: #3f8344; height: 10px; border-radius: 4px; }
  .hval { text-align: right; color: #444; }
  .cols { display: flex; align-items: flex-end; gap: 6px; height: 150px; border-bottom: 1px solid #ccc; padding-top: 16px; }
  .col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
  .cbar { width: 70%; background: #3f8344; border-radius: 3px 3px 0 0; }
  .cval { font-size: 10px; color: #444; margin-bottom: 2px; }
  .clabel { font-size: 10px; color: #555; margin-top: 4px; position: relative; top: 18px; height: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid #e3e3e3; }
  td.n, th.n { text-align: right; }
  .muted { color: #777; font-size: 12px; }
  footer { margin-top: 28px; font-size: 10.5px; color: #666; border-top: 1px solid #ddd; padding-top: 8px; line-height: 1.5; }
</style></head>
<body>
  <header>
    <img src="${logo}" alt="" />
    <div>
      <div class="kicker">Volunteer impact report</div>
      <h1>${escapeHtml(name || 'Volunteer')}</h1>
      <div class="period">${escapeHtml(periodText)} · Issued ${escapeHtml(issued)}</div>
    </div>
  </header>

  <div class="stats">${stats.map(([b, s]) => `<div class="stat"><b>${escapeHtml(b)}</b><span>${escapeHtml(s)}</span></div>`).join('')}</div>
  ${compare ? `<p class="muted" style="margin-top:-8px">${escapeHtml(compare)}</p>` : ''}

  <h2>Hours by month</h2>
  ${monthsHtml(data.byMonth)}

  <div class="grid2" style="margin-top:28px">
    <div>
      <h2>Causes</h2>
      ${data.byCategory.length ? barsHtml(data.byCategory) : '<p class="muted">Nothing yet.</p>'}
    </div>
    <div>
      <h2>Top places served</h2>
      ${data.topPlaces.length ? barsHtml(data.topPlaces) : `<p class="muted">${kind === 'student' ? 'Add the organization when you log hours to see it here.' : 'Places appear once two or more students have served there.'}</p>`}
    </div>
  </div>

  ${data.byGrade?.length ? `
  <h2>By grade</h2>
  <table>
    <thead><tr><th>Grade</th><th class="n">Hours</th><th class="n">Students volunteering</th></tr></thead>
    <tbody>${data.byGrade.map((g) => `<tr><td>${escapeHtml(gradeText(g.name))}</td><td class="n">${num(g.hours)}</td><td class="n">${g.students}</td></tr>`).join('')}</tbody>
  </table>` : ''}

  ${data.schools?.length ? `
  <h2>By school</h2>
  <table>
    <thead><tr><th>School</th><th class="n">Hours</th><th class="n">Value</th><th class="n">Students volunteering</th></tr></thead>
    <tbody>${data.schools.map((s) => `<tr><td>${escapeHtml(s.name)}</td><td class="n">${num(s.hours)}</td><td class="n">${money(s.hours * VALUE_PER_HOUR)}</td><td class="n">${s.activeStudents} of ${s.students}</td></tr>`).join('')}</tbody>
  </table>` : ''}

  <footer>
    Value uses $${VALUE_PER_HOUR.toFixed(2)} per hour (${escapeHtml(VALUE_SOURCE)}).
    Hours include everything logged in VolunTrack except entries a reviewer rejected.
    ${kind === 'student' ? '' : 'This report shows totals only, never individual students.'}
  </footer>
  <script>window.onload=()=>window.print();</script>
</body></html>`)
  w.document.close()
  return true
}
