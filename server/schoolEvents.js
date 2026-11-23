// Events for schools and organizations (#995): sessions VolunTrack runs for
// school staff, districts and nonprofits to see the app. The admin adds them
// in Admin → Invites; the public /events page and the banner on the home and
// For schools pages show the next one only while it is coming up.
//
// Pure, so the admin form and the routes check an event the same way.

export const EVENT_MODES = ['in_person', 'online']
export const EVENT_TIME_ZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix',
  'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
]
const MAX = { title: 120, place: 300, agenda: 1500, offerText: 300, offerCode: 32, rsvpUrl: 500, joinNote: 300 }

const str = (v) => (typeof v === 'string' ? v.trim() : '')

/**
 * The UTC instant for a wall-clock date and time in an IANA time zone, using
 * only Intl (no date library). `date` is YYYY-MM-DD, `time` HH:MM (24-hour).
 * Returns a Date, or null when the input isn't a real date and time.
 */
export function zonedTimeToUtc(date, time, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) return null
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null
  let guess = Date.UTC(y, mo - 1, d, h, mi)
  let fmt
  try {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return null }
  // Twice: once to find the zone's offset, once more in case the offset at
  // the answer differs (a date right next to a daylight-saving change).
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((p) => [p.type, p.value]))
    const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute)
    guess += Date.UTC(y, mo - 1, d, h, mi) - shown
  }
  const out = new Date(guess)
  // A day like Feb 31 rolls over; refuse it rather than move the event.
  const check = Object.fromEntries(fmt.formatToParts(out).map((p) => [p.type, p.value]))
  if (+check.year !== y || +check.month !== mo || +check.day !== d) return null
  return out
}

/** The date (YYYY-MM-DD) and time (HH:MM) of an instant in a time zone, for the admin form. */
export function utcToZoned(instant, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(instant)).map((p) => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

/**
 * Checks what the admin typed. Resolves to { event } with clean values, or
 * { error } naming what to fix.
 */
export function readEvent(body = {}) {
  const title = str(body.title)
  if (!title) return { error: 'Give the event a name.' }
  if (title.length > MAX.title) return { error: `The name is too long (${MAX.title} characters at most).` }

  const timeZone = str(body.timeZone) || 'America/Chicago'
  if (!EVENT_TIME_ZONES.includes(timeZone)) return { error: 'Pick a time zone from the list.' }
  const startsAt = zonedTimeToUtc(str(body.date), str(body.time), timeZone)
  if (!startsAt) return { error: 'Enter the date and start time.' }

  const durationMinutes = Number(body.durationMinutes)
  if (!Number.isInteger(durationMinutes) || durationMinutes < 10 || durationMinutes > 480) return { error: 'The length must be between 10 minutes and 8 hours.' }

  const mode = str(body.mode)
  if (!EVENT_MODES.includes(mode)) return { error: 'Choose in person or online.' }
  const place = str(body.place)
  if (mode === 'in_person' && !place) return { error: 'Add the address for an in-person event.' }
  if (place.length > MAX.place) return { error: 'The place is too long.' }

  const agenda = str(body.agenda)
  if (agenda.length > MAX.agenda) return { error: `The agenda is too long (${MAX.agenda} characters at most).` }
  if (agenda.split('\n').filter((l) => l.trim()).length > 12) return { error: 'Keep the agenda to 12 lines or fewer.' }

  const offerCode = str(body.offerCode).toUpperCase()
  if (offerCode && !/^[A-Z0-9-]{3,32}$/.test(offerCode)) return { error: 'The event code can use letters, numbers and dashes only.' }
  const offerText = str(body.offerText)
  if (offerText.length > MAX.offerText) return { error: 'The offer text is too long.' }

  const rsvpUrl = str(body.rsvpUrl)
  if (rsvpUrl) {
    let u
    try { u = new URL(rsvpUrl) } catch { return { error: 'The RSVP link must be a full https:// address.' } }
    if (u.protocol !== 'https:' || u.username || u.password) return { error: 'The RSVP link must be a full https:// address.' }
    if (rsvpUrl.length > MAX.rsvpUrl) return { error: 'The RSVP link is too long.' }
  }

  return {
    event: {
      title, startsAt, timeZone, durationMinutes, mode,
      place: place || null, agenda: agenda || null,
      offerCode: offerCode || null, offerText: offerText || null,
      rsvpUrl: rsvpUrl || null,
      published: body.published !== false,
    },
  }
}

/** True while the event is published and hasn't ended yet. */
export function isUpcoming(ev, now = new Date()) {
  if (!ev || ev.published === false) return false
  const end = new Date(new Date(ev.startsAt).getTime() + (Number(ev.durationMinutes) || 0) * 60000)
  return end > now
}

/** The agenda as lines: "0:05 The student side — logging and signing" → { time, text }. */
export function agendaLines(agenda) {
  return String(agenda || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(\d{1,2}:\d{2}(?:\s?[ap]m)?)\s+(.*)$/i)
    return m ? { time: m[1], text: m[2] } : { time: null, text: l }
  })
}
