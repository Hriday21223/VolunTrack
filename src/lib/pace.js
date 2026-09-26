// Pace maths for a goal with a deadline.
//
// A goal used to be a title and an hour target, so the dashboard could only
// answer "42 of 100". The question a student actually has is "am I going to
// make it", which needs three more things: when it is due, how fast they have
// been going, and how fast they now have to go.
//
// Pure and dependency-light on purpose — the same numbers are shown for a
// personal goal (client-only, localStorage) and for the school's own
// requirement (server policy, server/requirements.js), and neither path may
// need a network call to render.

import { differenceInCalendarDays, parseISO, addDays, isValid } from 'date-fns'

// How far back "recently" reaches when measuring the rate someone is actually
// logging at. Four weeks is long enough that one quiet week doesn't read as
// stopping, short enough to notice a real change of pace.
const RECENT_WINDOW_DAYS = 28

// How far off the expected line still counts as on track. Hours land in
// lumps — one Saturday shift moves a small goal several percent — so a narrow
// band would flip between "behind" and "ahead" week to week.
const ON_TRACK_TOLERANCE = 0.05

function toDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : parseISO(String(value))
  return isValid(date) ? date : null
}

function sumHours(logs) {
  return logs.reduce((sum, log) => sum + (Number(log.hours) || 0), 0)
}

/**
 * @param {object} input
 * @param {number} input.target      hours the goal is for
 * @param {number} input.total       hours logged toward it
 * @param {string|Date|null} input.deadline  when it is due (YYYY-MM-DD or Date)
 * @param {Array}  [input.logs]      logs, for the recent-rate projection
 * @param {string|Date|null} [input.startedAt] when the clock started; defaults
 *        to the earliest log, so an old account doesn't read as having spent
 *        years on a goal it set last week
 * @param {Date}   [input.now]       injectable for predictable rendering
 */
export function goalPace({ target, total, deadline, logs = [], startedAt = null, now = new Date() }) {
  const targetHours = Number(target) || 0
  const totalHours = Number(total) || 0
  const due = toDate(deadline)
  const remaining = Math.max(0, targetHours - totalHours)
  const met = targetHours > 0 && totalHours >= targetHours

  // No target or no deadline: there is no pace to speak of, and the caller
  // renders the plain progress it always did.
  if (targetHours <= 0 || !due) {
    return { hasDeadline: false, met, remaining, status: met ? 'met' : 'none' }
  }

  const daysLeft = differenceInCalendarDays(due, now)

  if (met) {
    return { hasDeadline: true, met: true, remaining: 0, daysLeft, due, status: 'met' }
  }

  if (daysLeft < 0) {
    return { hasDeadline: true, met: false, remaining, daysLeft, due, status: 'overdue' }
  }

  // The deadline is today or later, so there is at least one day to work with.
  const daysAvailable = Math.max(1, daysLeft)
  const hoursPerWeek = remaining / (daysAvailable / 7)
  const hoursPerDay = remaining / daysAvailable

  // Where the goal should stand today, measured from when the clock started.
  // Without a start there is nothing to measure against, so the goal is only
  // reported as behind once we know how long it has been running.
  const logDates = logs.map((log) => toDate(log.date)).filter(Boolean)
  const earliestLog = logDates.length ? new Date(Math.min(...logDates.map((d) => d.getTime()))) : null
  const start = toDate(startedAt) || earliestLog
  let expected = null
  let delta = null
  if (start && differenceInCalendarDays(due, start) > 0) {
    const span = differenceInCalendarDays(due, start)
    const elapsed = Math.min(span, Math.max(0, differenceInCalendarDays(now, start)))
    expected = targetHours * (elapsed / span)
    delta = totalHours - expected
  }

  // The rate they are actually going at, and where that lands them.
  const windowStart = addDays(now, -RECENT_WINDOW_DAYS)
  const recentHours = sumHours(logs.filter((log) => {
    const date = toDate(log.date)
    return date && date >= windowStart && date <= now
  }))
  const recentPerWeek = recentHours / (RECENT_WINDOW_DAYS / 7)
  const projectedFinish = recentPerWeek > 0
    ? addDays(now, Math.ceil((remaining / recentPerWeek) * 7))
    : null

  let status = 'on-track'
  if (delta !== null) {
    const tolerance = targetHours * ON_TRACK_TOLERANCE
    if (delta < -tolerance) status = 'behind'
    else if (delta > tolerance) status = 'ahead'
  }

  return {
    hasDeadline: true,
    met: false,
    status,
    due,
    daysLeft,
    remaining,
    hoursPerWeek,
    hoursPerDay,
    expected,
    // Positive when ahead of the line, negative when behind it.
    delta,
    recentPerWeek,
    projectedFinish,
    // True only when we can say it: a projection needs a recent rate.
    willMakeIt: projectedFinish ? projectedFinish <= due : null,
  }
}

/** One short line for the dashboard: what to do, not what happened. */
export function paceSummary(pace, { formatHours = (h) => `${Math.round(h * 10) / 10}h` } = {}) {
  if (!pace?.hasDeadline) return null
  if (pace.met) return 'Goal reached'
  if (pace.status === 'overdue') return `Past due — ${formatHours(pace.remaining)} short`
  if (pace.daysLeft === 0) return `Due today — ${formatHours(pace.remaining)} to go`
  // Under a fortnight, a weekly rate reads as stale advice.
  if (pace.daysLeft <= 14) return `${formatHours(pace.hoursPerDay)} a day for ${pace.daysLeft} more day${pace.daysLeft === 1 ? '' : 's'}`
  return `${formatHours(pace.hoursPerWeek)} a week to finish on time`
}

/** The second line: whether they are ahead of, on, or behind the line. */
export function paceStanding(pace, { formatHours = (h) => `${Math.round(h * 10) / 10}h` } = {}) {
  if (!pace?.hasDeadline || pace.met || pace.delta === null || pace.delta === undefined) return null
  if (pace.status === 'behind') return `${formatHours(Math.abs(pace.delta))} behind pace`
  if (pace.status === 'ahead') return `${formatHours(pace.delta)} ahead of pace`
  return 'On pace'
}
