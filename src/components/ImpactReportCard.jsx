import { useEffect, useState } from 'react'
import { BarChart3, Mail, X, Download } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { tr } from '@/lib/i18n.js'
import { printImpactReport, studentImpact, PERIOD_LABELS, VALUE_PER_HOUR, presetRange, impactCsv } from '@/lib/impactReport.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const ENDPOINT = { school: '/school/impact', organization: '/organization/impact' }

// "Impact report" (#563): a printable page of hours, their value and where
// they went — a student's own (from `logs`), or a school's or organization's
// (counts from the server).
export default function ImpactReportCard({ scope = 'student', name = '', logs = [], className = '' }) {
  const [period, setPeriod] = useState('year')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // 'year' and 'all' are the server's own periods; every other choice is a
  // date range (#610), both days included.
  const range = period === 'custom'
    ? (customFrom && customTo ? { from: customFrom, to: customTo } : null)
    : presetRange(period)

  const load = async () => {
    if (period === 'custom' && !range) throw new Error(tr('Pick a start and an end date.'))
    if (range && range.from > range.to) throw new Error(tr('The start date must be on or before the end date.'))
    if (scope === 'student') return { data: studentImpact(logs, range ? 'range' : period, new Date(), range), title: name }
    let token = null
    try { token = localStorage.getItem('voluntrack:auth_token') } catch { /* private mode */ }
    const qs = range ? `from=${range.from}&to=${range.to}` : `period=${period}`
    const res = await fetch(`${apiUrl}${ENDPOINT[scope]}?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || 'Could not build the report.')
    return { data: body, title: body.name || name }
  }

  const run = (action) => async () => {
    setBusy(true)
    setError('')
    try {
      const { data, title } = await load()
      if (action === 'csv') {
        const blob = new Blob([impactCsv({ name: title, kind: scope, data })], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `impact-${range ? `${range.from}-to-${range.to}` : period}.csv`
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      } else if (!printImpactReport({ name: title, kind: scope, data, period })) {
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
        <button type="button" className="btn-secondary" onClick={run('print')} disabled={busy}>
          {busy ? tr('Building…') : tr('Open impact report')}
        </button>
        <button type="button" className="btn-ghost" onClick={run('csv')} disabled={busy}>
          <Download className="w-4 h-4" aria-hidden="true" />{' '}{tr('Download CSV')}
        </button>
      </div>
      {period === 'custom' && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <label className="text-sm flex items-center gap-1.5">{tr('From')}
            <input type="date" className="input w-auto" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} />
          </label>
          <label className="text-sm flex items-center gap-1.5">{tr('To')}
            <input type="date" className="input w-auto" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} />
          </label>
        </div>
      )}
      {range && period !== 'custom' && (
        <p className="text-xs text-earth-500 dark:text-earth-400 mt-2">{tr('{from} to {to}, compared with the same dates last year.', { from: range.from, to: range.to })}</p>
      )}
      {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
      {scope !== 'student' && <MonthlyRecipients scope={scope} />}
    </Card>
  )
}

// Who gets this report by email on the 1st of each month (#573). Only the
// main school or org account manages the list; anyone else sees nothing.
function MonthlyRecipients({ scope }) {
  const path = `${apiUrl}${scope === 'school' ? '/school' : '/organization'}/impact-recipients`
  const [list, setList] = useState(null)
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const call = async (url, opts = {}) => {
    let token = null
    try { token = localStorage.getItem('voluntrack:auth_token') } catch { /* private mode */ }
    const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw Object.assign(new Error(body.error || 'Something went wrong.'), { status: res.status })
    return body.recipients || []
  }
  useEffect(() => { call(path).then(setList).catch(() => setList(false)) }, [path])
  // null while loading; false when this account may not manage the list.
  if (!list) return null

  const add = async (e) => {
    e.preventDefault()
    setError('')
    try { setList(await call(path, { method: 'POST', body: JSON.stringify({ email }) })); setEmail('') } catch (err) { setError(err.message) }
  }
  const remove = async (id) => {
    try { setList(await call(`${path}/${encodeURIComponent(id)}`, { method: 'DELETE' })) } catch (err) { setError(err.message) }
  }
  return (
    <div className="mt-4 border-t border-earth-200 dark:border-white/10 pt-3">
      <p className="text-sm font-medium flex items-center gap-2"><Mail className="w-4 h-4" aria-hidden="true" />{' '}{tr('Email it every month')}</p>
      <p className="text-xs text-earth-500 dark:text-earth-400 mb-2">{tr('On the 1st, each person here gets last month’s numbers and the school year so far, with a link to the full report. Up to 5 people; each can unsubscribe.')}</p>
      {list.length > 0 && (
        <ul className="mb-2 space-y-1">
          {list.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{r.email}</span>
              <button type="button" className="p-1 text-red-400 hover:text-red-300" onClick={() => remove(r.id)} aria-label={`Remove ${r.email}`}><X className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      {list.length < 5 && (
        <form onSubmit={add} className="flex gap-2">
          <input className="input flex-1" type="email" placeholder="principal@school.org" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button type="submit" className="btn-secondary btn-sm">{tr('Add')}</button>
        </form>
      )}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}
