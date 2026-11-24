// Year in review share links (#1005): the numbers behind a public /y/<slug>
// page. Worked out here from the logs in the database, never from anything
// the device sends, so a link on our domain can't show made-up hours.
//
// Pure (no database), so tests can call it. Mirrors src/lib/yearInReview.js,
// which the server can't import (it pulls in the client's i18n through '@/').
// Only counts leave here: never a place name, activity, note or date of a
// single entry.

import { differenceInCalendarDays, parseISO, startOfWeek, format } from 'date-fns'

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const MAX_CATEGORIES = 5

// "Maria del Carmen" → "Maria". First name only, as on the page's checkbox.
export function firstNameOf(name) {
  return (String(name || '').trim().split(/\s+/)[0] || '').slice(0, 30)
}

export function longestWeekStreak(dates) {
  const weeks = [...new Set(dates.map((d) => format(startOfWeek(parseISO(d), { weekStartsOn: 1 }), 'yyyy-MM-dd')))].sort()
  let best = 0
  let run = 0
  let prev = null
  for (const w of weeks) {
    run = prev && differenceInCalendarDays(parseISO(w), parseISO(prev)) === 7 ? run + 1 : 1
    best = Math.max(best, run)
    prev = w
  }
  return best
}

/**
 * logs: [{ date: 'YYYY-MM-DD', hours, category, verification_status, place }]
 * for one student. Rejected entries don't count, as everywhere else.
 * Returns null when the year has nothing counted.
 */
export function yearShareSummary(logs, year) {
  const inYear = (logs || []).filter((l) =>
    l && l.verification_status !== 'rejected' && String(l.date || '').slice(0, 4) === String(year) && Number(l.hours) > 0)
  if (inYear.length === 0) return null

  const hoursOf = (l) => Number(l.hours) || 0
  const totalHours = inYear.reduce((s, l) => s + hoursOf(l), 0)
  const approvedHours = inYear.filter((l) => l.verification_status === 'approved').reduce((s, l) => s + hoursOf(l), 0)

  const byCategory = new Map()
  for (const l of inYear) {
    const key = l.category || 'Other'
    byCategory.set(key, (byCategory.get(key) || 0) + hoursOf(l))
  }
  const categories = [...byCategory.entries()]
    .map(([category, hours]) => ({ category, hours: round2(hours) }))
    .sort((a, b) => b.hours - a.hours || a.category.localeCompare(b.category))

  const months = Array(12).fill(0)
  for (const l of inYear) months[Number(l.date.slice(5, 7)) - 1] += hoursOf(l)
  let busiest = 0
  for (let m = 1; m < 12; m++) if (months[m] > months[busiest]) busiest = m

  const placeKey = (l) => String(l.place || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const dates = inYear.map((l) => l.date)

  return {
    year: Number(year),
    totalHours: round2(totalHours),
    sessions: inYear.length,
    approvedHours: round2(approvedHours),
    categories: categories.slice(0, MAX_CATEGORIES),
    moreCategories: Math.max(0, categories.length - MAX_CATEGORIES),
    places: new Set(inYear.map(placeKey).filter(Boolean)).size,
    months: months.map(round2),
    busiestMonth: { month: busiest, hours: round2(months[busiest]) },
    longestWeekStreak: longestWeekStreak(dates),
  }
}
