import { useCallback, useEffect, useState } from 'react'
import { Trophy } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

async function call(path, { method = 'GET', body } = {}) {
  let token = null
  try { token = localStorage.getItem('voluntrack:auth_token') } catch { /* private mode */ }
  if (!token) throw new Error('Sign in again.')
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Something went wrong.')
  return data
}

const num = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n)
const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' }

function Board({ challenge, board, mySchoolId }) {
  const perStudent = challenge.metric === 'per_student'
  return (
    <ol className="space-y-1.5">
      {board.map((row) => {
        const mine = row.schoolId === mySchoolId
        return (
          <li key={row.schoolId} className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${mine ? 'bg-brand-600/20 border border-brand-500/40' : 'bg-earth-100/60 dark:bg-white/5'}`}>
            <span className="flex items-center gap-2 min-w-0">
              <span className="w-6 text-center shrink-0">{MEDAL[row.rank] || row.rank}</span>
              <span className="truncate font-medium">{row.name}{mine ? ` · ${tr('your school')}` : ''}</span>
            </span>
            <span className="shrink-0 text-right">
              <strong>{num(perStudent ? row.perStudent : row.hours)}</strong>
              <span className="text-xs text-earth-500"> {perStudent ? tr('h per student') : tr('hours')}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * School vs school challenge (#575). `manage`: the organization's own card,
 * with start/end. Otherwise the view for its schools' students and advisers,
 * shown only while there is one.
 */
export default function SchoolVsSchoolCard({ manage = false, className = '' }) {
  const [data, setData] = useState(null)
  const [form, setForm] = useState({ title: '', metric: 'per_student', startsOn: '', endsOn: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const path = manage ? '/organization/challenge' : '/school/org-challenge'

  const load = useCallback(() => { call(path).then(setData).catch(() => setData({ challenge: null })) }, [path])
  useEffect(() => { load() }, [load])

  if (!data) return null
  const { challenge } = data
  if (!manage && !challenge) return null

  const start = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try { setData(await call('/organization/challenge', { method: 'POST', body: form })) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const end = async () => {
    try { await call(`/organization/challenge/${encodeURIComponent(challenge.id)}/end`, { method: 'POST' }); load() } catch (err) { setError(err.message) }
  }

  return (
    <Card className={className}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Trophy className="w-4 h-4 text-amber-500" aria-hidden="true" />
            {challenge ? challenge.title : tr('School vs school challenge')}
          </h3>
          {challenge ? (
            <p className="text-xs text-earth-500 dark:text-earth-400">
              {!manage && data.organizationName ? `${data.organizationName} · ` : ''}
              {fmt(challenge.startsOn)}–{fmt(challenge.endsOn)} · {challenge.metric === 'per_student' ? tr('ranked by hours per student') : tr('ranked by total hours')}
              {challenge.finished ? ` · ${tr('Final results')}` : ''}
            </p>
          ) : (
            <p className="text-sm text-earth-500">{tr('Rank your schools by the hours their students log, e.g. “Most hours in November”. Students and advisers see school names and totals, never individual students.')}</p>
          )}
        </div>
        {manage && challenge && <button type="button" className="btn-ghost btn-sm shrink-0" onClick={end}>{challenge.finished ? tr('Clear') : tr('End now')}</button>}
      </div>

      {challenge && <Board challenge={challenge} board={data.scoreboard || []} mySchoolId={data.mySchoolId} />}

      {manage && !challenge && (
        <form onSubmit={start} className="space-y-2">
          <input className="input" placeholder={tr('Most hours in November')} maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <div className="grid sm:grid-cols-3 gap-2">
            <select className="input" value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })} aria-label={tr('Rank by')}>
              <option value="per_student">{tr('Hours per student (fair for small schools)')}</option>
              <option value="total">{tr('Total hours')}</option>
            </select>
            <input className="input" type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} aria-label={tr('Starts')} required />
            <input className="input" type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} aria-label={tr('Ends')} required />
          </div>
          <button type="submit" className="btn-primary btn-sm" disabled={busy}>{busy ? tr('Starting…') : tr('Start the challenge')}</button>
        </form>
      )}
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </Card>
  )
}
