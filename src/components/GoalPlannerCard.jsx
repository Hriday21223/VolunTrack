import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Route as RouteIcon, CalendarClock } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { tr } from '@/lib/i18n.js'
import { fmtDate } from '@/utils/date.js'
import { format, addDays } from 'date-fns'
import { useFreeTimes } from '@/components/FreeTimesFilter.jsx'
import { hasFreeTimes, taskFitsFreeTimes } from '@/lib/freeTimes.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const round = (n) => Math.round(n * 10) / 10

// Goal planner (#703): what it takes to reach the goal by its deadline, and
// upcoming events in the next three weeks that fit the student's free times
// (or the soonest ones if none are set). `pace` comes from src/lib/pace.js.
export default function GoalPlannerCard({ pace, label }) {
  const { freeTimes } = useFreeTimes()
  const [tasks, setTasks] = useState(null)
  const show = pace?.hasDeadline && !pace.met && pace.status !== 'overdue'
  useEffect(() => {
    if (!show) return
    const token = localStorage.getItem('voluntrack:auth_token')
    fetch(`${apiUrl}/school/public-tasks?maxDistance=80`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
      .then((r) => (r.ok ? r.json() : { tasks: [] }))
      .then((d) => setTasks(d.tasks || []))
      .catch(() => setTasks([]))
  }, [show])
  if (!show) return null
  const today = format(new Date(), 'yyyy-MM-dd')
  const until = format(addDays(new Date(), 21), 'yyyy-MM-dd')
  const useFree = hasFreeTimes(freeTimes)
  const picks = (tasks || [])
    .filter((t) => t.status === 'open' && !t.my_signup_status && !t.my_too_young)
    .filter((t) => { const d = String(t.date).slice(0, 10); return d >= today && d <= until })
    .filter((t) => !useFree || taskFitsFreeTimes(t, freeTimes))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(0, 3)
  const perWeek = pace.daysLeft <= 14 ? null : round(pace.hoursPerWeek)
  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center gap-2 text-sm font-semibold"><RouteIcon className="w-4 h-4 text-brand-500" aria-hidden="true" />{tr('Your plan')}</div>
      <p className="text-sm mt-1">
        {perWeek != null
          ? tr('About {n} hours a week gets you to {goal} by {date}.', { n: perWeek, goal: label, date: fmtDate(format(pace.due, 'yyyy-MM-dd')) })
          : tr('About {n} hours a day for the next {d} days gets you to {goal}.', { n: round(pace.hoursPerDay), d: pace.daysLeft, goal: label })}
        {' '}{tr('{h} hours to go.', { h: round(pace.remaining) })}
      </p>
      <div className="mt-3">
        <p className="text-xs font-medium text-earth-400 flex items-center gap-1">
          <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
          {useFree ? tr('Events in the next 3 weeks that fit when you are free') : tr('Events in the next 3 weeks')}
        </p>
        {tasks === null ? (
          <p className="text-xs text-earth-500 mt-1">{tr('Loading…')}</p>
        ) : picks.length === 0 ? (
          <p className="text-xs text-earth-500 mt-1">{tr('Nothing fits right now. Look on Opportunities for more.')}</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {picks.map((t) => (
              <li key={t.id} className="text-sm flex justify-between gap-2">
                <Link to={`/opportunities?task=${encodeURIComponent(t.id)}`} className="text-brand-400 hover:underline truncate">{t.title}</Link>
                <span className="text-xs text-earth-500 shrink-0">{fmtDate(String(t.date).slice(0, 10))}{t.time ? ` · ${t.time}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
        {!useFree && <Link to="/opportunities" className="mt-2 block text-xs text-brand-400 hover:underline">{tr("Tell us when you're free to see events that fit →")}</Link>}
      </div>
    </Card>
  )
}
