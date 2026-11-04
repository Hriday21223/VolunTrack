// "When I'm free" (#672): the days and parts of the day a student or
// volunteer is usually free, and whether a task fits them. Pure, shared with
// the app (src/lib/freeTimes.js) so the saved shape and the filter agree.

export const FREE_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export const FREE_PARTS = ['morning', 'afternoon', 'evening']

// Morning is before noon, afternoon noon–5 PM, evening 5 PM on.
export function partOfDay(time) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time || ''))
  if (!m) return null
  const h = Number(m[1])
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

// { mon: ['morning'], sat: ['afternoon', 'evening'] } — unknown days and parts
// dropped, each list in order, empty days left out.
export function cleanFreeTimes(value) {
  const out = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const day of FREE_DAYS) {
    const parts = Array.isArray(value[day]) ? FREE_PARTS.filter((p) => value[day].includes(p)) : []
    if (parts.length > 0) out[day] = parts
  }
  return out
}

export function hasFreeTimes(free) {
  return Object.keys(cleanFreeTimes(free)).length > 0
}

// The weekday of a YYYY-MM-DD date, as a FREE_DAYS key (no timezone shift).
export function dayKey(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ''))
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return FREE_DAYS[(d.getUTCDay() + 6) % 7]
}

// A task fits when it's on a free day and starts in a free part of it. A task
// with shifts fits when any shift does; one with no time fits on the day.
export function taskFitsFreeTimes(task, free) {
  const clean = cleanFreeTimes(free)
  const parts = clean[dayKey(task?.date)]
  if (!parts) return false
  const starts = Array.isArray(task.shifts) && task.shifts.length > 0
    ? task.shifts.map((s) => s.start_time || s.start)
    : [task.time]
  return starts.some((t) => {
    const part = partOfDay(t)
    return part === null || parts.includes(part)
  })
}
