import { useCallback, useEffect, useState } from 'react'
import { Send, CheckCircle, XCircle, Clock } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { fmtDate } from '@/utils/date.js'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const SHOWN = 5

const STATUS = {
  pending: { icon: Clock, label: 'Waiting for review', className: 'text-amber-600 dark:text-amber-400' },
  approved: { icon: CheckCircle, label: 'Approved', className: 'text-emerald-600 dark:text-emerald-400' },
  rejected: { icon: XCircle, label: 'Sent back', className: 'text-red-600 dark:text-red-400' },
}

// Reports → "Sent to your school" (#583): the reports a student submitted and
// what the school decided, with the school's note. `refreshKey` changes after
// a new submission so the list picks it up.
export default function SentReportsCard({ refreshKey }) {
  const [reports, setReports] = useState(null)
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async () => {
    let token = null
    try { token = localStorage.getItem('voluntrack:auth_token') } catch { /* private mode */ }
    if (!token) { setReports([]); return }
    try {
      const res = await fetch(`${apiUrl}/school/pdfs`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setReports(Array.isArray(data.pdfs) ? data.pdfs : [])
    } catch {
      setReports([])
    }
  }, [])

  useEffect(() => { load() }, [load, refreshKey])

  if (!reports || reports.length === 0) return null
  const shown = showAll ? reports : reports.slice(0, SHOWN)

  return (
    <Card className="mb-6">
      <h3 className="font-semibold mb-3 flex items-center gap-2"><Send className="w-4 h-4 text-brand-600" />{' '}{tr('Sent to your school')}</h3>
      <ul className="space-y-3">
        {shown.map((r) => {
          const s = STATUS[r.status] || STATUS.pending
          const Icon = s.icon
          return (
            <li key={r.id} className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-earth-500 dark:text-earth-400">{fmtDate(new Date(r.created_at).toLocaleDateString('en-CA'))}</span>
                <span className={`flex items-center gap-1 font-medium ${s.className}`}><Icon className="w-4 h-4" />{' '}{tr(s.label)}</span>
              </div>
              {r.notes && (
                <p className="mt-1 rounded-lg bg-earth-100 dark:bg-white/5 px-3 py-2 text-earth-700 dark:text-earth-200">
                  <span className="font-medium">{r.status === 'rejected' ? tr('Why:') : tr('Note:')}</span>{' '}{r.notes}
                </p>
              )}
              {r.status === 'rejected' && (
                <p className="mt-1 text-xs text-earth-500 dark:text-earth-400">{tr('Fix what they asked for, then submit a new report.')}</p>
              )}
            </li>
          )
        })}
      </ul>
      {reports.length > SHOWN && (
        <button type="button" className="btn-ghost text-sm mt-2" onClick={() => setShowAll((v) => !v)}>
          {showAll ? tr('Show fewer') : tr('Show all ({n})', { n: reports.length })}
        </button>
      )}
    </Card>
  )
}
