// iCalendar (.ics, RFC 5545) helpers shared by the one-task "Add to calendar"
// file and the subscribable calendar feed (routes/school.js).
//
// A task has a start time but no end, so an event runs two hours; without a
// time it is an all-day event. Times are "floating" (no time zone), so the
// calendar reads them in the device's own.

export const icsText = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1')

// Lines over 75 bytes are folded: a line break and a space (RFC 5545 3.1).
export function icsFold(line) {
  const out = []
  let cur = ''
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) { out.push(cur); cur = '' }
    cur += ch
  }
  out.push(cur)
  return out.join('\r\n ')
}

export const icsLocal = (d) => d.toISOString().replace(/[-:]/g, '').slice(0, 15)
export const icsDay = (d) => d.toISOString().slice(0, 10).replace(/-/g, '')

// "Online", or "Online — <what the organizer wrote>" when they added a note
// such as "Zoom link sent after approval".
const onlineLocation = (loc) => {
  const text = String(loc || '').trim()
  return !text || text.toLowerCase() === 'online' ? 'Online' : `Online — ${text}`
}

// One VEVENT for a task row ({ id, title, description, location, date
// 'YYYY-MM-DD', time, creator_name, latitude, longitude, is_online }). `link` goes at the
// end of the description and in URL; `summaryPrefix` (e.g. "Waitlist: ") is
// put in front of the title; `details` lines (the day-of meeting point and
// contact, only for someone allowed to see them) go after the description.
export function icsEvent(t, { link = '', summaryPrefix = '', now = new Date(), details = [] } = {}) {
  // Built in UTC only as a way to do date arithmetic; written out floating.
  const [y, m, d] = t.date.split('-').map(Number)
  const hm = /^(\d{1,2}):(\d{2})/.exec(t.time || '')
  const lines = [
    'BEGIN:VEVENT',
    `UID:${t.id}@voluntrack`,
    `DTSTAMP:${icsLocal(now)}Z`,
  ]
  // A shift (#589) has a real end time; a task's own time has only a start.
  const endHm = /^(\d{1,2}):(\d{2})/.exec(t.end_time || '')
  if (hm) {
    const start = new Date(Date.UTC(y, m - 1, d, Number(hm[1]), Number(hm[2])))
    const end = endHm ? new Date(Date.UTC(y, m - 1, d, Number(endHm[1]), Number(endHm[2]))) : null
    lines.push(`DTSTART:${icsLocal(start)}`, `DTEND:${icsLocal(end && end > start ? end : new Date(start.getTime() + 2 * 3600e3))}`)
  } else {
    const day = new Date(Date.UTC(y, m - 1, d))
    lines.push(`DTSTART;VALUE=DATE:${icsDay(day)}`, `DTEND;VALUE=DATE:${icsDay(new Date(day.getTime() + 86400e3))}`)
  }
  lines.push(
    `SUMMARY:${icsText(summaryPrefix + t.title)}`,
    // An online task (#426) has no place: LOCATION says so and there's no GEO.
    `LOCATION:${icsText(t.is_online ? onlineLocation(t.location) : t.location)}`,
    `DESCRIPTION:${icsText([t.description, ...details, t.creator_name && `Posted by ${t.creator_name}`, hm && !endHm && 'End time is an estimate. Check with the organizer.', link].filter(Boolean).join('\n\n'))}`,
  )
  if (!t.is_online && t.latitude != null && t.longitude != null) lines.push(`GEO:${Number(t.latitude)};${Number(t.longitude)}`)
  if (link) lines.push(`URL:${link}`)
  lines.push('END:VEVENT')
  return lines
}

// A whole VCALENDAR from VEVENT line arrays, folded, with CRLF line endings.
// `extra` lines go in the calendar header (e.g. X-WR-CALNAME for a feed).
export function icsCalendar(events, extra = []) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//VolunTrack//Tasks//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    ...extra,
    ...events.flat(),
    'END:VCALENDAR',
  ]
  return lines.map(icsFold).join('\r\n') + '\r\n'
}
