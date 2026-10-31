import { useEffect, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// Organization dashboard → Compare schools (#529): every school side by side,
// most hours this school year first. Counts only.
export default function CompareSchoolsCard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const token = localStorage.getItem('voluntrack:auth_token')
    fetch(`${apiUrl}/organization/schools/compare`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Could not compare schools.'); return d })
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  if (error) return <Card><p className="text-sm text-red-500">{error}</p></Card>
  if (!data || data.schools.length === 0) return null
  const rows = [...data.schools].sort((a, b) => b.yearHours - a.yearHours)
  const max = Math.max(1, ...rows.map((r) => r.yearHours))
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—')
  const since = new Date(`${data.yearStart}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <Card>
      <h3 className="font-display font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4 text-brand-600" />{' '}{tr('Compare schools')}</h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mt-0.5 mb-4">{tr('Hours since {date}. Active means logged hours in the last 30 days.', { date: since })}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-earth-500 dark:text-earth-400 text-left">
            <tr>
              <th className="py-2 pr-3 font-medium">{tr('School')}</th>
              <th className="py-2 pr-3 font-medium w-1/3">{tr('Hours this year')}</th>
              <th className="py-2 pr-3 font-medium text-right">{tr('Students')}</th>
              <th className="py-2 pr-3 font-medium text-right">{tr('Active')}</th>
              <th className="py-2 font-medium text-right">{tr('Met requirement')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-earth-100 dark:border-[#1f2e25]">
                <td className="py-2 pr-3 font-medium">{r.name}</td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full bg-earth-100 dark:bg-earth-800 overflow-hidden min-w-[3rem]">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${(r.yearHours / max) * 100}%` }} />
                    </div>
                    <span className="tabular-nums w-14 text-right">{r.yearHours}</span>
                  </div>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.students}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.active} <span className="text-earth-400">({pct(r.active, r.students)})</span></td>
                <td className="py-2 text-right tabular-nums">{r.withGoal ? <>{r.met} of {r.withGoal} <span className="text-earth-400">({pct(r.met, r.withGoal)})</span></> : <span className="text-earth-400">{tr('No requirement')}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
