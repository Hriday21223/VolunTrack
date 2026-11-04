import { useCallback, useEffect, useState } from 'react'
import { Users2, ClipboardCheck, X } from 'lucide-react'
import Card from '@/components/Card.jsx'
import ProgressBar from '@/components/ProgressBar.jsx'
import { tr } from '@/lib/i18n.js'
import { fmtDate } from '@/utils/date.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

// A student's clubs (#660) and their hours this school year toward each goal,
// plus their clubs' assignments (#675), where they attach their entries.
export default function MyClubsCard() {
  const [clubs, setClubs] = useState([])
  const [work, setWork] = useState({ assignments: [], recent: [] })
  const [error, setError] = useState('')
  const loadWork = useCallback(() => {
    fetch(`${apiUrl}/clubs/mine/assignments`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : { assignments: [], recent: [] }))
      .then((d) => setWork({ assignments: d.assignments || [], recent: d.recent || [] }))
      .catch(() => {})
  }, [])
  useEffect(() => {
    if (!localStorage.getItem('voluntrack:auth_token')) return
    fetch(`${apiUrl}/clubs/mine`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : { clubs: [] }))
      .then((d) => setClubs(d.clubs || []))
      .catch(() => {})
    loadWork()
  }, [loadWork])
  const change = async (method, aid, logId) => {
    setError('')
    try {
      const res = await fetch(`${apiUrl}/clubs/assignments/${aid}/entries/${logId}`, { method, headers: auth() })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || tr('Something went wrong.'))
      loadWork()
    } catch (e) { setError(e.message) }
  }
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
      {work.assignments.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-2 text-sm font-semibold"><ClipboardCheck className="w-4 h-4 text-brand-500" aria-hidden="true" />{tr('Assignments')}</div>
          <ul className="space-y-3">
            {work.assignments.map((a) => {
              const usedIds = new Set(a.entries.map((e) => e.id))
              const options = work.recent.filter((l) => !usedIds.has(l.id))
              return (
                <li key={a.id} className="rounded-lg border border-earth-100 dark:border-white/10 p-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{a.title}<span className="text-earth-500 font-normal"> · {a.club}</span></span>
                    <span className={a.done ? 'text-emerald-500 whitespace-nowrap' : 'text-earth-400 whitespace-nowrap'}>{a.done ? `✓ ${tr('Done')}` : `${a.attachedHours} / ${a.hours} h`}</span>
                  </div>
                  {a.dueDate && <p className="text-xs text-earth-500">{tr('due {date}', { date: fmtDate(a.dueDate) })}</p>}
                  {a.details && <p className="text-xs text-earth-500 mt-1 whitespace-pre-wrap">{a.details}</p>}
                  {a.needsReflection && !a.reflected && <p className="text-xs text-amber-500 mt-1">{tr('Write a reflection ("What did you learn?") on one of the entries you add.')}</p>}
                  <ProgressBar value={a.attachedHours} target={a.hours} />
                  {a.entries.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {a.entries.map((e) => (
                        <li key={e.id} className="flex justify-between gap-2 text-xs">
                          <span>{fmtDate(e.date)} · {e.activity || tr('Untitled')} · {e.hours}h</span>
                          <button type="button" className="text-earth-400 hover:text-red-400" onClick={() => change('DELETE', a.id, e.id)} aria-label={tr('Remove this entry')}><X className="w-3.5 h-3.5" /></button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {options.length > 0 && (
                    <select className="input text-xs py-1 mt-2" value="" onChange={(e) => e.target.value && change('POST', a.id, e.target.value)} aria-label={tr('Add an entry to {title}', { title: a.title })}>
                      <option value="">{tr('+ Add one of your entries…')}</option>
                      {options.map((l) => <option key={l.id} value={l.id}>{fmtDate(l.date)} · {l.activity || tr('Untitled')} · {l.hours}h</option>)}
                    </select>
                  )}
                </li>
              )
            })}
          </ul>
          {error && <p role="alert" className="text-xs text-red-500 mt-2">{error}</p>}
        </div>
      )}
    </Card>
  )
}
