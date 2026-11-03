import { useEffect, useState } from 'react'
import { Users2 } from 'lucide-react'
import Card from '@/components/Card.jsx'
import ProgressBar from '@/components/ProgressBar.jsx'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// A student's clubs (#660) and their hours this school year toward each goal.
export default function MyClubsCard() {
  const [clubs, setClubs] = useState([])
  useEffect(() => {
    const token = localStorage.getItem('voluntrack:auth_token')
    if (!token) return
    fetch(`${apiUrl}/clubs/mine`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : { clubs: [] }))
      .then((d) => setClubs(d.clubs || []))
      .catch(() => {})
  }, [])
  if (clubs.length === 0) return null
  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center gap-2 mb-2 text-sm font-semibold"><Users2 className="w-4 h-4 text-brand-500" aria-hidden="true" />{tr('My clubs')}</div>
      <ul className="space-y-2">
        {clubs.map((c) => (
          <li key={c.id}>
            <div className="flex justify-between text-sm"><span>{c.name}</span><span className="text-earth-400">{c.goalHours ? tr('{done} of {target} hours', { done: c.hours, target: c.goalHours }) : tr('{n} hours this year', { n: c.hours })}</span></div>
            {c.goalHours ? <ProgressBar value={c.hours} target={c.goalHours} /> : null}
          </li>
        ))}
      </ul>
    </Card>
  )
}
