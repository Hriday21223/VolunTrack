import { useCallback, useEffect, useState } from 'react'
import { CheckCircle, XCircle, RotateCcw, PlusCircle, Trash2, History } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { fmtDate, fmtHours } from '@/utils/date.js'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

const EVENTS = {
  approved: { icon: CheckCircle, label: tr('Approved'), color: 'text-emerald-600 dark:text-emerald-400' },
  rejected: { icon: XCircle, label: tr('Sent back'), color: 'text-red-600 dark:text-red-400' },
  reset: { icon: RotateCcw, label: tr('Changed after a decision'), color: 'text-amber-600 dark:text-amber-400' },
  added_by_school: { icon: PlusCircle, label: tr('Added by the school'), color: 'text-sky-600 dark:text-sky-400' },
  deleted: { icon: Trash2, label: tr('Deleted'), color: 'text-earth-500' },
}

const BY = {
  school: tr('school staff'),
  supervisor: tr('supervisor'),
  organizer: tr('event organizer'),
  student: tr('student'),
}

const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

// Students → Approval history (#638): who approved, sent back or changed
// each entry, and when. Newest first; filter by student and dates.
export default function ApprovalHistoryPanel({ students = [] }) {
  const [events, setEvents] = useState(null)
  const [next, setNext] = useState(null)
  const [studentId, setStudentId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [error, setError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)

  const load = useCallback(async (before = null) => {
    setError('')
    const q = new URLSearchParams()
    if (studentId) q.set('studentId', studentId)
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    if (before) q.set('before', before)
    try {
      const res = await fetch(`${apiUrl}/school/approval-history?${q}`, { headers: auth() })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || tr('Could not load the approval history.'))
      setEvents((prev) => (before ? [...(prev || []), ...body.events] : body.events))
      setNext(body.next)
    } catch (e) {
      setError(e.message)
      if (!before) setEvents([])
    }
  }, [studentId, from, to])

  useEffect(() => { load() }, [load])

  const more = async () => {
    setLoadingMore(true)
    await load(next)
    setLoadingMore(false)
  }

  return (
    <Card>
      <div className="flex items-center gap-2 mb-1">
        <History className="w-5 h-5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
        <h3 className="font-semibold">{tr('Approval history')}</h3>
      </div>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
        {tr('Who approved, sent back or changed each entry, and when.')}
      </p>

      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <label className="text-sm">
          <span className="block mb-1 text-earth-600 dark:text-earth-300">{tr('Student')}</span>
          <select className="input" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">{tr('All students')}</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name || s.email}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block mb-1 text-earth-600 dark:text-earth-300">{tr('From')}</span>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="block mb-1 text-earth-600 dark:text-earth-300">{tr('To')}</span>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
      {events === null && <p className="text-sm text-earth-500">{tr('Loading…')}</p>}
      {events?.length === 0 && !error && (
        <p className="text-sm text-earth-500 dark:text-earth-400">{tr('Nothing yet. Decisions on hour entries show up here.')}</p>
      )}

      {events?.length > 0 && (
        <ul className="divide-y divide-earth-100 dark:divide-[#1f2e25]">
          {events.map((e) => {
            const kind = EVENTS[e.event] || EVENTS.reset
            const Icon = kind.icon
            return (
              <li key={e.id} className="py-3 flex gap-3">
                <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${kind.color}`} aria-hidden="true" />
                <div className="min-w-0 flex-1 text-sm">
                  <p>
                    <span className="font-medium">{kind.label}</span>
                    {' · '}{e.studentName}{' · '}
                    {fmtHours(Number(e.hours) || 0)}{' '}{tr('for')}{' “'}{e.activity || tr('Volunteer activity')}{'”'}
                    {e.logDate && <>{' '}{tr('on')}{' '}{fmtDate(e.logDate)}</>}
                  </p>
                  <p className="text-earth-500 dark:text-earth-400">
                    {tr('By {who}', { who: e.byName ? `${e.byName} (${BY[e.byKind] || e.byKind})` : (BY[e.byKind] || e.byKind) })}
                    {' · '}{when(e.at)}
                  </p>
                  {e.note && <p className="text-earth-600 dark:text-earth-300 mt-0.5">{tr('Note:')}{' '}{e.note}</p>}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {next && (
        <button type="button" className="btn-ghost w-full mt-3" onClick={more} disabled={loadingMore}>
          {loadingMore ? tr('Loading…') : tr('Show older')}
        </button>
      )}
    </Card>
  )
}
