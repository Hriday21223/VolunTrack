// Server-side reminder scheduling.
//
// The client's src/lib/scheduler.js computes fire times in the browser's local
// zone. The server runs in UTC, so it cannot reuse that directly: a 09:00
// reminder must fire at the user's 09:00, not the server's. Each synced
// reminder therefore carries its IANA timezone and we resolve wall-clock times
// in that zone here.
//
// No new dependency — Intl already knows every zone's offset, including DST
// transitions, which a stored numeric offset would get wrong twice a year.

// Offset (ms) that the given instant has in the given zone.
function tzOffsetMs(ts, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = Object.fromEntries(
    dtf.formatToParts(new Date(ts)).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  )
  return asUtc - ts
}

/**
 * The UTC instant at which the given wall-clock time occurs in `timeZone`.
 * Two correction passes converge for every real zone, including the ones with
 * 30/45-minute offsets.
 */
export function zonedWallClockToUtc({ year, month, day, hour, minute }, timeZone) {
  const naive = Date.UTC(year, month - 1, day, hour, minute)
  let ts = naive
  for (let i = 0; i < 2; i += 1) ts = naive - tzOffsetMs(ts, timeZone)
  return ts
}

// The calendar date `n` days after a Y/M/D triple, staying in wall-clock terms.
function addDays({ year, month, day }, n) {
  const d = new Date(Date.UTC(year, month - 1, day + n))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

function wallClockOn(ts, timeZone) {
  const off = tzOffsetMs(ts, timeZone)
  const d = new Date(ts + off)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function parseHm(time) {
  const [h, m] = String(time || '09:00').split(':').map(Number)
  return { hour: Number.isFinite(h) ? h : 9, minute: Number.isFinite(m) ? m : 0 }
}

function dateOnly(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * First occurrence strictly after `afterTs` (ms). Returns null when the
 * reminder is disabled, has ended, or is a one-off already in the past.
 *
 * Deliberately a forward scan over candidate calendar days rather than
 * arithmetic on instants: adding 24h across a DST boundary lands on the wrong
 * wall-clock time, which is exactly the bug this is meant to avoid.
 */
export function nextOccurrenceUtc(reminder, afterTs = Date.now()) {
  if (!reminder || reminder.enabled === false) return null

  const tz = reminder.timezone || 'UTC'
  const { hour, minute } = parseHm(reminder.time)
  const start = dateOnly(reminder.startDate)
  const end = dateOnly(reminder.endDate)

  // Never fire before the start date, and never after the end date.
  const startTs = start ? start.getTime() : -Infinity
  const from = Math.max(afterTs, startTs - 1)

  const kind = reminder.kind
  // A one-off has exactly one candidate; the recurring kinds need at most a
  // couple of months of look-ahead to find their next hit.
  const horizon = kind === 'one-off' ? 1 : kind === 'monthly' ? 70 : 400

  let day = wallClockOn(from, tz)
  if (kind === 'one-off') {
    if (!start) return null
    day = { year: start.getUTCFullYear(), month: start.getUTCMonth() + 1, day: start.getUTCDate() }
  }

  for (let i = 0; i < horizon; i += 1) {
    const candidate = i === 0 ? day : addDays(day, i)

    if (kind === 'weekly') {
      const dow = new Date(Date.UTC(candidate.year, candidate.month - 1, candidate.day)).getUTCDay()
      if (Number.isInteger(reminder.weekday) && dow !== reminder.weekday) continue
    }
    if (kind === 'monthly') {
      const dom = Math.min(
        Math.max(1, Number(reminder.dayOfMonth) || 1),
        daysInMonth(candidate.year, candidate.month),
      )
      if (candidate.day !== dom) continue
    }

    const ts = zonedWallClockToUtc({ ...candidate, hour, minute }, tz)
    if (ts <= afterTs) continue
    if (ts < startTs) continue
    // endDate is inclusive of the whole day, matching the client's
    // startOfDay comparison in src/lib/scheduler.js.
    if (end && ts > end.getTime() + 24 * 60 * 60 * 1000 - 1) return null
    return ts
  }
  return null
}
