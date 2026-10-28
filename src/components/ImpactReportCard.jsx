import { useState } from 'react'
import { BarChart3 } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { tr } from '@/lib/i18n.js'
import { printImpactReport, studentImpact, PERIOD_LABELS, VALUE_PER_HOUR } from '@/lib/impactReport.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const ENDPOINT = { school: '/school/impact', organization: '/organization/impact' }

// "Impact report" (#563): a printable page of hours, their value and where
// they went — a student's own (from `logs`), or a school's or organization's
// (counts from the server).
export default function ImpactReportCard({ scope = 'student', name = '', logs = [], className = '' }) {
  const [period, setPeriod] = useState('year')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const open = async () => {
    setBusy(true)
    setError('')
    try {
      let data
      let title = name
      if (scope === 'student') {
        data = studentImpact(logs, period)
      } else {
        let token = null
        try { token = localStorage.getItem('voluntrack:auth_token') } catch { /* private mode */ }
        const res = await fetch(`${apiUrl}${ENDPOINT[scope]}?period=${period}`, { headers: { Authorization: `Bearer ${token}` } })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error || 'Could not build the report.')
        data = body
        title = body.name || name
      }
      if (!printImpactReport({ name: title, kind: scope, data, period })) {
        setError(tr('Allow pop-ups for this site to open the report.'))
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const who = scope === 'student' ? tr('your hours') : scope === 'school' ? tr('your school’s hours') : tr('all your schools’ hours')
  return (
    <Card className={className}>
      <h3 className="font-semibold mb-1 flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-brand-600 dark:text-brand-400" aria-hidden="true" /> {tr('Impact report')}
      </h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">
        {tr('One page on {who}: total hours, what they’re worth (${rate} an hour, the national value of volunteer time), causes, months and places.', { who, rate: VALUE_PER_HOUR.toFixed(2) })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label={tr('Period')}>
          {Object.entries(PERIOD_LABELS).map(([k, label]) => <option key={k} value={k}>{tr(label)}</option>)}
        </select>
        <button type="button" className="btn-secondary" onClick={open} disabled={busy}>
          {busy ? tr('Building…') : tr('Open impact report')}
        </button>
      </div>
      {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
    </Card>
  )
}
