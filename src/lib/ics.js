import { format, parseISO, startOfDay } from 'date-fns'
import { computeNextAt } from '@/lib/scheduler.js'

/**
 * iCalendar (.ics, RFC 5545) export for reminders and public-task signups.
 *
 * Built entirely client-side so it works in localStorage-only mode too; the
 * signups are only included when the caller could fetch them.
 *
 * Times are written as *floating* local times (no TZID, no trailing Z). A
 * reminder is "17:00 wherever I am", which is exactly what floating time means,
 * and it avoids shipping a VTIMEZONE block. Per RFC 5545 an RRULE UNTIL must be
 * floating too when DTSTART is.
 */

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
const YMD = /^\d{4}-\d{2}-\d{2}$/

/** TEXT value escaping (RFC 5545 §3.3.11). */
function escapeText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/**
 * Fold a content line to at most 75 octets (RFC 5545 §3.1). Counts UTF-8 bytes
 * and never splits inside a code point — an emoji in a task title must not
 * become two half-characters.
 */
function fold(line) {
  const encoder = new TextEncoder()
  const out = []
  let current = ''
  let bytes = 0
  for (const ch of line) {
    const n = encoder.encode(ch).length
    // Continuation lines start with a space, which counts toward their 75.
    const limit = out.length === 0 ? 75 : 74
    if (bytes + n > limit) {
      out.push(current)
      current = ''
      bytes = 0
    }
    current += ch
    bytes += n
  }
  out.push(current)
  return out.join('\r\n ')
}

const floating = (d) => format(d, "yyyyMMdd'T'HHmmss")
const utcStamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** `pg` serializes DATE columns as an ISO timestamp; the date part is what we want. */
function dateOnly(value) {
  const s = String(value ?? '').slice(0, 10)
  return YMD.test(s) ? s : null
}

function reminderRule(r) {
  const parts = []
  if (r.kind === 'daily') parts.push('FREQ=DAILY')
  else if (r.kind === 'weekly') {
    const dow = Number.isInteger(r.weekday) ? r.weekday : null
    if (dow === null) return null
    parts.push('FREQ=WEEKLY', `BYDAY=${WEEKDAY_CODES[dow]}`)
  } else if (r.kind === 'monthly') {
    const day = Math.min(31, Math.max(1, Number(r.dayOfMonth) || 1))
    // The in-app scheduler clamps "day 31" to the month's last day; a bare
    // BYMONTHDAY=31 would skip every shorter month, so use -1 (last day), which
    // every client supports. Days 29/30 have no equally portable clamp — the
    // BYMONTHDAY=28,29,30;BYSETPOS=-1 form is valid RFC 5545 but some parsers
    // ignore BYSETPOS and emit three events a month — so those skip the months
    // that lack the day (February) instead: a missed nudge beats duplicates.
    parts.push('FREQ=MONTHLY', `BYMONTHDAY=${day === 31 ? -1 : day}`)
  } else {
    return null
  }
  if (r.endDate && YMD.test(r.endDate)) {
    parts.push(`UNTIL=${r.endDate.replace(/-/g, '')}T235959`)
  }
  return parts.join(';')
}

function reminderEvent(r, now, stamp) {
  if (!r.enabled || !HHMM.test(r.time || '')) return null
  // First occurrence from now on — used as the RRULE's DTSTART, since
  // computeNextAt honours endDate and the monthly clamping. For a recurring
  // reminder that hasn't started yet, computeNextAt returns startDate itself
  // even when that isn't a matching weekday/day; DTSTART must be a real
  // occurrence (clients disagree on what to do otherwise), so anchor there.
  let anchor = now
  if (r.kind !== 'one-off' && r.startDate && YMD.test(r.startDate)) {
    const start = startOfDay(parseISO(r.startDate))
    if (start > anchor) anchor = start
  }
  let next
  try { next = computeNextAt(r, anchor) } catch { return null }
  if (!next) return null
  const start = parseISO(next)
  const lines = [
    'BEGIN:VEVENT',
    `UID:reminder-${r.id}@voluntrack`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${floating(start)}`,
    'DURATION:PT15M',
    `SUMMARY:${escapeText(r.title || 'VolunTrack reminder')}`,
  ]
  if (r.body) lines.push(`DESCRIPTION:${escapeText(r.body)}`)
  if (r.kind !== 'one-off') {
    const rule = reminderRule(r)
    if (!rule) return null
    lines.push(`RRULE:${rule}`)
  }
  lines.push(
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(r.title || 'VolunTrack reminder')}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
  )
  return lines
}

function signupEvent(s, today, stamp) {
  if (s.signup_status === 'rejected') return null
  const date = dateOnly(s.date)
  if (!date || date < today) return null

  const pending = s.signup_status === 'pending'
  const title = `${pending ? '(Pending) ' : ''}${s.title || 'Volunteer shift'}`
  const lines = [
    'BEGIN:VEVENT',
    `UID:task-${s.id}@voluntrack`,
    `DTSTAMP:${stamp}`,
  ]
  if (HHMM.test(s.time || '')) {
    // Tasks have a start time but no end time — block out an hour rather than
    // inventing a length, and alert an hour ahead.
    lines.push(`DTSTART:${date.replace(/-/g, '')}T${s.time.replace(':', '')}00`, 'DURATION:PT1H')
  } else {
    lines.push(`DTSTART;VALUE=DATE:${date.replace(/-/g, '')}`)
  }
  lines.push(`SUMMARY:${escapeText(title)}`)
  if (s.location) lines.push(`LOCATION:${escapeText(s.location)}`)
  const desc = [
    s.creator_name ? `Posted by ${s.creator_name}` : null,
    pending ? 'Your signup is awaiting organizer approval.' : null,
  ].filter(Boolean).join('\n')
  if (desc) lines.push(`DESCRIPTION:${escapeText(desc)}`)
  if (pending) lines.push('STATUS:TENTATIVE')
  if (HHMM.test(s.time || '')) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(title)}`,
      'TRIGGER:-PT1H',
      'END:VALARM',
    )
  }
  lines.push('END:VEVENT')
  return lines
}

/**
 * Build the .ics text. `signups` is the `/school/public-tasks/signups/mine`
 * row shape. Returns `{ ics, reminderCount, signupCount }`.
 */
export function buildCalendar({ reminders = [], signups = [], now = new Date() } = {}) {
  const stamp = utcStamp(now)
  const today = format(now, 'yyyy-MM-dd')

  const reminderEvents = reminders.map((r) => reminderEvent(r, now, stamp)).filter(Boolean)
  const signupEvents = signups.map((s) => signupEvent(s, today, stamp)).filter(Boolean)

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VolunTrack//Calendar export//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:VolunTrack',
    ...reminderEvents.flat(),
    ...signupEvents.flat(),
    'END:VCALENDAR',
  ]
  return {
    ics: lines.map(fold).join('\r\n') + '\r\n',
    reminderCount: reminderEvents.length,
    signupCount: signupEvents.length,
  }
}
