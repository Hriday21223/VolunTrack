import { useEffect, useState, useCallback } from 'react'
import { Users, AlertTriangle, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import VerificationBadge from '@/components/VerificationBadge.jsx'
import { fmtDate, fmtHours } from '@/utils/date.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

export default function ParentDashboard() {
  const [children, setChildren] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const headers = { Authorization: `Bearer ${token}` }
      const childRes = await fetch(`${apiUrl}/parent/children`, { headers })
      if (!childRes.ok) throw new Error(`Request failed: ${childRes.status}`)
      const { children: kids } = await childRes.json()

      const logsByChild = await Promise.all(
        (kids || []).map((c) =>
          fetch(`${apiUrl}/logs/${c.id}`, { headers })
            .then((r) => (r.ok ? r.json() : { logs: [] }))
            .catch(() => ({ logs: [] })),
        ),
      )
      setChildren((kids || []).map((c, i) => ({ ...c, logs: logsByChild[i].logs || [] })))
    } catch (err) {
      console.error('Could not load children:', err)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  return (
    <AppLayout title="Family" subtitle="Your linked children's logged hours and verification status.">
      {loading ? (
        <Card><div className="text-sm text-earth-500 dark:text-earth-400">Loading…</div></Card>
      ) : error ? (
        <Card>
          <div className="text-center py-8">
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
            <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
              Couldn&rsquo;t load your family. This is usually a temporary connection issue, not a sign that anything is wrong with your linked children.
            </p>
            <button onClick={loadData} className="btn-secondary inline-flex items-center gap-2">
              <RefreshCw className="w-4 h-4" /> Try again
            </button>
          </div>
        </Card>
      ) : children.length === 0 ? (
        <Card>
          <div className="text-center py-8">
            <Users className="w-10 h-10 text-earth-300 mx-auto mb-3" />
            <h3 className="font-display font-semibold mb-2">Get started</h3>
            <ol className="text-sm text-earth-500 dark:text-earth-400 text-left max-w-sm mx-auto space-y-1.5 list-decimal list-inside">
              <li>Ask your child to open <span className="font-medium text-earth-800 dark:text-earth-100">Settings → Family</span> on their account.</li>
              <li>They&rsquo;ll generate a link code and share it with you.</li>
              <li>Enter that code in <Link to="/settings" className="text-brand-700 dark:text-brand-300 hover:underline font-medium">your own Settings → Family</Link> section.</li>
            </ol>
          </div>
        </Card>
      ) : (
        <div className="space-y-5">
          {children.map((child) => {
            const totalHours = child.logs.reduce((s, l) => s + (Number(l.hours) || 0), 0)
            return (
              <Card key={child.id}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-display font-semibold">{child.name}</h3>
                    <p className="text-xs text-earth-400">{child.email}</p>
                  </div>
                  <div className="text-sm font-medium text-brand-600">{fmtHours(totalHours)} total</div>
                </div>
                {child.logs.length === 0 ? (
                  <p className="text-sm text-earth-500 dark:text-earth-400">No hours logged yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-earth-500 dark:text-earth-400">
                        <tr>
                          <th className="text-left py-2">Date</th>
                          <th className="text-left py-2">Activity</th>
                          <th className="text-left py-2">Status</th>
                          <th className="text-right py-2">Hours</th>
                        </tr>
                      </thead>
                      <tbody>
                        {child.logs.map((l) => (
                          <tr key={l.id} className="border-t border-earth-100 dark:border-[#1f2e25]">
                            <td className="py-2 whitespace-nowrap">{fmtDate(l.date)}</td>
                            <td className="py-2">{l.activity || '—'}</td>
                            <td className="py-2"><VerificationBadge status={l.verification_status} /></td>
                            <td className="py-2 text-right font-medium">{fmtHours(Number(l.hours) || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </AppLayout>
  )
}
