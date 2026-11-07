import { useCallback, useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })
const monthName = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

// Volunteer of the month (#786), school side: pick one student this month with
// a short note, or undo this month's pick.
export default function SpotlightPickCard({ className = '' }) {
  const [data, setData] = useState(null)
  const [students, setStudents] = useState([])
  const [studentId, setStudentId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    fetch(`${apiUrl}/school/spotlight`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => setData(null))
  }, [])
  useEffect(() => {
    load()
    fetch(`${apiUrl}/school/students`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : { students: [] }))
      .then((d) => setStudents((d.students || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))))
      .catch(() => setStudents([]))
  }, [load])

  if (!data) return null

  const pick = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const res = await fetch(`${apiUrl}/school/spotlight`, {
        method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId, note }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || tr('Could not save volunteer of the month.'))
      setStudentId(''); setNote(''); load()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const undo = async () => {
    if (!window.confirm(tr('Undo this month’s volunteer of the month?'))) return
    setBusy(true)
    try { await fetch(`${apiUrl}/school/spotlight/${data.current.id}`, { method: 'DELETE', headers: auth() }); load() } finally { setBusy(false) }
  }

  return (
    <Card className={className}>
      <h3 className="font-semibold flex items-center gap-2"><Star className="w-4 h-4 text-amber-500" />{' '}{tr('Volunteer of the month')}</h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mt-0.5 mb-3">{tr('Give one student a shout-out. They and their parents get a notification and a certificate. Only they and your school see it.')}</p>
      {data.current ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
          <div>
            <p className="font-medium">🌟 {data.current.name} <span className="text-xs text-earth-500">· {monthName(data.current.month)}</span></p>
            {data.current.note && <p className="text-sm text-earth-400">“{data.current.note}”</p>}
          </div>
          <button type="button" onClick={undo} disabled={busy} className="btn-ghost btn-sm">{tr('Undo')}</button>
        </div>
      ) : (
        <form onSubmit={pick} className="space-y-2">
          <select className="input" value={studentId} onChange={(e) => setStudentId(e.target.value)} required aria-label={tr('Student')}>
            <option value="">{tr('Choose a student')}</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}{s.grade ? ` · ${tr('Grade {grade}', { grade: s.grade })}` : ''}</option>)}
          </select>
          <input className="input" maxLength={300} placeholder={tr('Why? (optional, they will see it)')} value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="submit" className="btn-primary btn-sm" disabled={busy || !studentId}>{busy ? tr('Saving…') : tr('Give shout-out')}</button>
        </form>
      )}
      {error && <p className="text-sm text-red-400 mt-2" role="alert">{error}</p>}
      {data.recent?.length > 0 && (
        <p className="text-xs text-earth-500 mt-3">{tr('Earlier:')}{' '}{data.recent.map((r) => `${monthName(r.month)}: ${r.name}`).join(' · ')}</p>
      )}
    </Card>
  )
}
