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

/** True once it has started (and isUpcoming says it hasn't ended). */
export const isUnderWay = (ev, now = new Date()) => new Date(ev.startsAt) <= now
