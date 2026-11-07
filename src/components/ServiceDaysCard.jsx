import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarHeart } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { fmtDate } from '@/utils/date.js'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

const STATUS = {
  approved: () => tr("You're going"),
  pending: () => tr('Waiting for approval'),
  waitlisted: () => tr('On the waitlist'),
}

// School service days (#784): upcoming days the student's school posted
// (GET /api/school/service-days). Hidden when there are none.
export default function ServiceDaysCard({ className = '' }) {
  const [days, setDays] = useState([])
  useEffect(() => {
    fetch(`${apiUrl}/school/service-days`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : { serviceDays: [] }))
      .then((d) => setDays(d.serviceDays || []))
      .catch(() => setDays([]))
  }, [])
  if (days.length === 0) return null
  return (
    <Card className={className}>
      <h3 className="font-semibold flex items-center gap-2 mb-2"><CalendarHeart className="w-4 h-4 text-amber-500" />{' '}{tr('School service days')}</h3>
      <ul className="divide-y divide-white/10">
        {days.map((d) => (
          <li key={d.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium truncate">{d.title}</p>
              <p className="text-xs text-earth-500">{fmtDate(d.date)}{d.time ? ` · ${d.time}` : ''}{d.location ? ` · ${d.location}` : ''}</p>
            </div>
            {STATUS[d.myStatus]
              ? <span className="text-xs text-emerald-500 dark:text-emerald-300">{STATUS[d.myStatus]()}</span>
              : <Link to={`/opportunities?task=${encodeURIComponent(d.id)}`} className="btn-primary btn-sm">{tr('Sign up')}</Link>}
          </li>
        ))}
      </ul>
    </Card>
  )
}
