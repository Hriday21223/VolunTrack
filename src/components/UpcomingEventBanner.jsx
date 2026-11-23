import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ArrowRight } from 'lucide-react'
import { tr } from '@/lib/i18n.js'
import { upcomingEvent, eventWhen, eventPath } from '@/lib/schoolEvents.js'

// The next event for schools and organizations (#995), on the home and For
// schools pages. Renders nothing unless one is coming up.
export default function UpcomingEventBanner({ className = '', tone = 'dark' }) {
  const [ev, setEv] = useState(null)
  useEffect(() => {
    let alive = true
    upcomingEvent().then((e) => { if (alive) setEv(e) })
    return () => { alive = false }
  }, [])
  if (!ev) return null
  const { day, time } = eventWhen(ev, { withWeekday: false })
  const dark = tone === 'dark'
  return (
    <Link
      to={eventPath(ev.id)}
      className={`group inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-2xl border px-4 py-2.5 text-sm text-left transition-colors ${dark ? 'border-amber-300/30 bg-amber-300/10 text-amber-100 hover:bg-amber-300/15' : 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-300/30 dark:bg-amber-300/10 dark:text-amber-100'} ${className}`}
    >
      <CalendarDays className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="font-semibold">{tr('For schools and organizations')}:</span>
      <span className="min-w-0">{ev.title} · {day}, {time}</span>
      <span className="inline-flex items-center gap-1 font-semibold underline-offset-2 group-hover:underline">{tr('See the event')} <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" /></span>
    </Link>
  )
}
