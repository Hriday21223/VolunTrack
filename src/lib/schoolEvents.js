// Events for schools and organizations (#995): the next one, fetched once per
// page load, and how its date and time read. The rules live in
// server/schoolEvents.js (shared through the @schoolEvents alias).
import { isUpcoming, agendaLines } from '@schoolEvents'
import { language } from '@/lib/i18n.js'

export { agendaLines }

const apiUrl = import.meta.env.VITE_API_URL || '/api'
let pending = null

/** The next event still to come, or null (also when the server can't be reached). */
export function upcomingEvent() {
  if (!pending) {
    pending = fetch(`${apiUrl}/events/upcoming`)
      .then((r) => (r.ok ? r.json() : { event: null }))
      .then((d) => (d?.event && isUpcoming(d.event) ? d.event : null))
      .catch(() => null)
  }
  return pending
}

const locale = () => language || 'en'

/** "Tuesday, December 1 · 4:00 PM CST" in the event's own time zone. */
export function eventWhen(ev, { withWeekday = true } = {}) {
  const at = new Date(ev.startsAt)
  try {
    const day = new Intl.DateTimeFormat(locale(), { timeZone: ev.timeZone, ...(withWeekday ? { weekday: 'long' } : {}), month: 'long', day: 'numeric' }).format(at)
    const time = new Intl.DateTimeFormat(locale(), { timeZone: ev.timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(at)
    return { day, time }
  } catch {
    return { day: at.toDateString(), time: at.toLocaleTimeString() }
  }
}

/**
 * One event by id, for /events?id=…: { event } (it may have ended), or
 * { event: null, missing: true } when there's no such published event.
 */
export async function eventById(id) {
  if (!/^sev_[A-Za-z0-9_]{4,60}$/.test(String(id || ''))) return { event: null, missing: true }
  try {
    const r = await fetch(`${apiUrl}/events/one/${encodeURIComponent(id)}`)
    if (r.status === 404) return { event: null, missing: true }
    if (!r.ok) return { event: null, missing: false }
    return { event: (await r.json()).event || null, missing: false }
  } catch {
    return { event: null, missing: false }
  }
}

/** The address to share for one event. */
export const eventPath = (id) => `/events?id=${encodeURIComponent(id)}`

export { isUpcoming }

/** True once it has started (and isUpcoming says it hasn't ended). */
export const isUnderWay = (ev, now = new Date()) => new Date(ev.startsAt) <= now
