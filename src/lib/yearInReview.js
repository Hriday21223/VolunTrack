// Year in review: one calendar year of a student's volunteering, worked out on
// the device from the logs it already holds (useData), so it works the same
// for a local-only account and a signed-in one. Pure — no tr(), no storage —
// so the page and its share image read one set of numbers.
//
// Hours a supervisor rejected don't count (countedLogs, as everywhere else);
// pending and unverified hours do, with the approved share reported beside
// them so nobody mistakes the total for what a school has signed off.

import { differenceInCalendarDays, parseISO, startOfWeek, format } from 'date-fns'
import { BADGES, countedLogs, deriveAchievementState } from './achievements.js'

const yearOf = (log) => {
  const y = Number(String(log?.date || '').slice(0, 4))
  return Number.isInteger(y) && y > 1900 ? y : null
}

const statusOf = (log) => log.verificationStatus || log.verification_status || 'none'

/** Years that have at least one counted log, newest first. */
export function yearsWithLogs(logs) {
  const years = new Set()
  for (const l of countedLogs(logs)) {
    const y = yearOf(l)
    if (y) years.add(y)
  }
  return [...years].sort((a, b) => b - a)
}

/**
 * The year to open on: this year — or last year during January, when the
 * year just finished is the one worth looking back on. Falls back to the
 * newest year that has logs if the preferred one has none.
 */
export function defaultReviewYear(years, now = new Date()) {
  const preferred = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  if (years.includes(preferred)) return preferred
  return years[0] ?? preferred
}

/** December and January are when the review is worth a bigger nudge. */
export function isReviewSeason(now = new Date()) {
  return now.getMonth() === 11 || now.getMonth() === 0
}

// "Food Bank " and "food bank" are the same place.
const placeKey = (log) => String(log.orgName || log.location || '').trim().toLowerCase().replace(/\s+/g, ' ')

const round2 = (n) => Math.round(n * 100) / 100

/** Longest run of consecutive calendar weeks (Mon–Sun) with something logged. */
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
 * Badges whose condition first held within `year`: earned by its last day but
 * not by the day before it started. Badge earn dates aren't stored, so this
 * replays the same rules (deriveAchievementState) against the history.
 */
export function badgesEarnedIn(logs, goals, year) {
  const counted = countedLogs(logs).filter((l) => yearOf(l))
  const upTo = (last) => deriveAchievementState(counted.filter((l) => yearOf(l) <= last), goals || [])
  const before = upTo(year - 1)
  const after = upTo(year)
  return BADGES.filter((b) => b.isEarned(after) && !b.isEarned(before)).map((b) => b.id)
}

/**
 * The summary for one year. Returns null when the year has no counted logs.
 */
export function yearInReview(logs, goals, year) {
  const inYear = countedLogs(logs).filter((l) => yearOf(l) === year)
  if (inYear.length === 0) return null

  const hoursOf = (l) => Number(l.hours) || 0
  const totalHours = inYear.reduce((s, l) => s + hoursOf(l), 0)
  const approved = inYear.filter((l) => statusOf(l) === 'approved')
  const approvedHours = approved.reduce((s, l) => s + hoursOf(l), 0)

  const byCategory = new Map()
  for (const l of inYear) {
    const key = l.category || 'Other'
    const cur = byCategory.get(key) || { category: key, hours: 0, sessions: 0 }
    cur.hours += hoursOf(l)
    cur.sessions += 1
    byCategory.set(key, cur)
  }
  const categories = [...byCategory.values()]
    .map((c) => ({ ...c, hours: round2(c.hours), share: totalHours > 0 ? c.hours / totalHours : 0 }))
    .sort((a, b) => b.hours - a.hours || b.sessions - a.sessions || a.category.localeCompare(b.category))

  const months = Array(12).fill(0)
  for (const l of inYear) months[Number(l.date.slice(5, 7)) - 1] += hoursOf(l)
  let busiest = 0
  for (let m = 1; m < 12; m++) if (months[m] > months[busiest]) busiest = m

  const places = new Set(inYear.map(placeKey).filter(Boolean))

  // Oldest first by date, then by when it was entered, so "first" is stable.
  const ordered = [...inYear].sort((a, b) =>
    a.date.localeCompare(b.date) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
  const pick = (l) => ({ date: l.date, activity: l.activity || '', category: l.category || '', hours: hoursOf(l), place: l.orgName || l.location || '' })

  const dates = inYear.map((l) => l.date)

  return {
    year,
    totalHours: round2(totalHours),
    sessions: inYear.length,
    approvedHours: round2(approvedHours),
    approvedSessions: approved.length,
    categories,
    topCategory: categories[0]?.category || null,
    places: places.size,
    months: months.map(round2),
    busiestMonth: { month: busiest, hours: round2(months[busiest]) },
    activeDays: new Set(dates).size,
    longestWeekStreak: longestWeekStreak(dates),
    badges: badgesEarnedIn(logs, goals, year),
    first: pick(ordered[0]),
    latest: pick(ordered[ordered.length - 1]),
  }
}
