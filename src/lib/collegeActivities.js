// Turns a student's logs into Common App-style activity entries (#508):
// one entry per organization, with the numbers the form asks for. Pure, so
// it can be checked without the page. Nothing here is stored or sent.

import { countedLogs } from '@/lib/achievements.js'

// Common App's character limits for an activity.
export const LIMITS = { position: 50, organization: 100, description: 150 }

const SUMMER_MONTHS = new Set([6, 7, 8])

// Monday of the week a YYYY-MM-DD date falls in, as YYYY-MM-DD.
function weekKey(date) {
  const d = new Date(`${date}T00:00:00Z`)
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day)
  return d.toISOString().slice(0, 10)
}

// School year label for a date: Aug–Dec belongs to the year starting then.
export function schoolYear(date) {
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  const start = m >= 8 ? y : y - 1
  return `${start}–${String(start + 1).slice(2)}`
}

// Cut to `max` characters on a word boundary where possible.
export function clip(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, '')}…`
}

const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const fmt = (n) => (Math.round(n * 10) / 10).toString()

function draftDescription({ activities, category, hours, sessions }) {
  const count = `${fmt(hours)} hours over ${sessions} session${sessions === 1 ? '' : 's'}`
  if (activities.length === 0) {
    const cause = category && category !== 'Other' && category !== 'Community Service' ? ` (${category.toLowerCase()})` : ''
    return clip(`Volunteer work${cause}: ${count}.`, LIMITS.description)
  }
  const what = activities.slice(0, 3).join(', ')
  return clip(`${what[0].toUpperCase()}${what.slice(1)}. ${count}.`, LIMITS.description)
}

// Groups the logs by organization and returns entries, most hours first.
// Rejected logs and logs with no date or hours are left out.
export function buildActivities(logs) {
  const groups = new Map()
  for (const log of countedLogs(logs)) {
    const hours = Number(log.hours) || 0
    if (!log.date || hours <= 0) continue
    const name = tidy(log.orgName) || tidy(log.location) || tidy(log.activity) || 'Volunteer work'
    const key = name.toLowerCase()
    if (!groups.has(key)) groups.set(key, { name, logs: [] })
    groups.get(key).logs.push({ ...log, hours })
  }

  return [...groups.values()].map(({ name, logs: list }) => {
    const hours = list.reduce((s, l) => s + l.hours, 0)
    const weeks = new Set(list.map((l) => weekKey(l.date)))
    const years = [...new Set(list.map((l) => schoolYear(l.date)))].sort()
    const months = list.map((l) => Number(l.date.slice(5, 7)))
    const inSummer = months.some((m) => SUMMER_MONTHS.has(m))
    const inSchool = months.some((m) => !SUMMER_MONTHS.has(m))

    const counts = (field) => {
      const m = new Map()
      for (const l of list) {
        const v = tidy(l[field])
        if (!v) continue
        const k = v.toLowerCase()
        const cur = m.get(k) || { v, h: 0 }
        cur.h += l.hours
        m.set(k, cur)
      }
      return [...m.values()].sort((a, b) => b.h - a.h).map((x) => x.v)
    }
    const activities = counts('activity').filter((a) => a.toLowerCase() !== name.toLowerCase())
    const category = counts('category')[0] || ''

    return {
      key: name.toLowerCase(),
      type: 'Community Service (Volunteer)',
      position: 'Volunteer',
      organization: clip(name, LIMITS.organization),
      description: draftDescription({ activities, category, hours, sessions: list.length }),
      totalHours: hours,
      sessions: list.length,
      // Common App asks for typical hours per week and weeks per year while
      // taking part: averaged over the weeks they actually volunteered.
      hoursPerWeek: Math.max(1, Math.round(hours / weeks.size)),
      weeksPerYear: Math.max(1, Math.round(weeks.size / years.length)),
      timing: inSchool && inSummer ? 'All year' : inSummer ? 'During school break' : 'During school year',
      schoolYears: years,
      first: list.reduce((a, l) => (l.date < a ? l.date : a), list[0].date),
      last: list.reduce((a, l) => (l.date > a ? l.date : a), list[0].date),
    }
  }).sort((a, b) => b.totalHours - a.totalHours)
}

// Plain text for the clipboard, in the order the form asks for it.
export function activityText(a) {
  return [
    `Activity type: ${a.type}`,
    `Position/Leadership: ${a.position}`,
    `Organization: ${a.organization}`,
    `Description: ${a.description}`,
    `School years: ${a.schoolYears.join(', ')}`,
    `Timing: ${a.timing}`,
    `Hours per week: ${a.hoursPerWeek}`,
    `Weeks per year: ${a.weeksPerYear}`,
  ].join('\n')
}
