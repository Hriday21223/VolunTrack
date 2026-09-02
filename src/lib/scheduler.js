import { addDays, addWeeks, addMonths, isAfter, isBefore, parseISO, set, startOfDay } from 'date-fns'

/**
 * Compute the next time a reminder should fire. Returns ISO string or null.
 * - `kind`: 'one-off' | 'daily' | 'weekly' | 'monthly'
 * - `time`: 'HH:MM' (24h)
 * - `weekday`: 0-6 (Sun=0) — used for weekly
 * - `dayOfMonth`: 1-31 — used for monthly
 * - `startDate`: ISO date string — reminders are dormant before this
 * - `endDate`: optional ISO date string — reminders stop firing after this
 */
export function computeNextAt(r, now = new Date()) {
  if (!r.enabled) return null
  const start = r.startDate ? startOfDay(parseISO(r.startDate)) : null
  if (start && isBefore(now, start)) return combineDateTime(start, r.time).toISOString()

  if (r.endDate) {
    const end = startOfDay(parseISO(r.endDate))
    if (isAfter(startOfDay(now), end)) return null
  }

  const [hh, mm] = (r.time || '09:00').split(':').map(Number)

  switch (r.kind) {
    case 'one-off': {
      const at = combineDateTime(parseISO(r.startDate || new Date().toISOString()), r.time)
      return isAfter(at, now) ? at.toISOString() : null
    }
    case 'daily': {
      let at = combineDateTime(now, r.time)
      if (!isAfter(at, now)) at = combineDateTime(addDays(now, 1), r.time)
      return at.toISOString()
    }
    case 'weekly': {
      const targetDow = Number.isInteger(r.weekday) ? r.weekday : now.getDay()
      let at = set(now, { hours: hh, minutes: mm, seconds: 0, milliseconds: 0 })
      const diff = (targetDow - at.getDay() + 7) % 7
      at = addDays(at, diff)
      if (!isAfter(at, now)) at = addWeeks(at, 1)
      return at.toISOString()
    }
    case 'monthly': {
      const dom = Math.min(31, Math.max(1, Number(r.dayOfMonth) || 1))
      let at = set(now, { date: dom, hours: hh, minutes: mm, seconds: 0, milliseconds: 0 })
      if (!isAfter(at, now)) at = addMonths(at, 1)
      // clamp day for short months
      at = set(at, { date: Math.min(dom, daysInMonth(at)) })
      return at.toISOString()
    }
    default:
      return null
  }
}

function combineDateTime(d, time) {
  const [hh, mm] = (time || '09:00').split(':').map(Number)
  return set(d, { hours: hh, minutes: mm, seconds: 0, milliseconds: 0 })
}

function daysInMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

/** Find reminders that should fire right now (in the window (lastCheck, now]). */
export function dueReminders(reminders, lastCheck, now = new Date()) {
  const out = []
  for (const r of reminders) {
    // computeNextAt() always returns the next occurrence *strictly after* its
    // reference time, so it has to be anchored at lastCheck. Anchoring it at
    // `now` would roll a just-elapsed occurrence forward to the next one — the
    // moment we're trying to catch would be skipped and nothing ever fires.
    const next = computeNextAt(r, lastCheck)
    if (!next) continue
    const nextDate = parseISO(next)
    if (!isAfter(nextDate, now)) {
      out.push({ reminder: r, fireAt: next })
    }
  }
  return out
}
