// Weekly streak on the dashboard (#497): weeks in a row (Mon–Sun) with
// hours logged. Rejected hours don't count, the same rule as badges and goals.
// The week in progress keeps the streak alive: until it ends, a streak that
// ran through last week is "at risk", not broken.
import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek } from 'date-fns'

const weekKey = (d) => format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd')

/**
 * @param logs  the student's logs ({ date: 'yyyy-MM-dd', hours, verificationStatus })
 * @param today defaults to now
 * @returns {{ current: number, best: number, thisWeekLogged: boolean, atRisk: boolean }}
 *   `current` counts this week when it has hours, else runs through last week;
 *   `atRisk` means the streak is alive but this week has nothing yet.
 */
export function weekStreak(logs, today = new Date()) {
  const todayKey = format(today, 'yyyy-MM-dd')
  const weeks = new Set()
  for (const l of logs || []) {
    if ((l.verificationStatus || l.verification_status) === 'rejected') continue
    if (!(Number(l.hours) > 0) || !l.date || l.date > todayKey) continue
    weeks.add(weekKey(parseISO(l.date)))
  }

  // Longest run anywhere in the history.
  let best = 0
  let run = 0
  let prev = null
  for (const w of [...weeks].sort()) {
    run = prev && differenceInCalendarDays(parseISO(w), parseISO(prev)) === 7 ? run + 1 : 1
    best = Math.max(best, run)
    prev = w
  }

  const thisWeek = startOfWeek(today, { weekStartsOn: 1 })
  const thisWeekLogged = weeks.has(weekKey(thisWeek))
  let current = 0
  let cursor = thisWeekLogged ? thisWeek : addDays(thisWeek, -7)
  while (weeks.has(weekKey(cursor))) {
    current += 1
    cursor = addDays(cursor, -7)
  }
  return { current, best, thisWeekLogged, atRisk: !thisWeekLogged && current > 0 }
}
