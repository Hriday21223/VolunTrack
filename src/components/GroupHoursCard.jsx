import { useMemo, useState } from 'react'
import { UsersRound } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { ACTIVITY_CATEGORIES } from '@/lib/categories.js'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const today = () => new Date().toISOString().slice(0, 10)

// Students tab → Log hours for a group (#539): after a meeting or event, tick
// who was there and add the same approved hours for all of them at once.
export default function GroupHoursCard({ students = [], onDone }) {
  const [picked, setPicked] = useState(() => new Set())
  const [filter, setFilter] = useState('')
  const [form, setForm] = useState({ date: today(), activity: '', hours: '', category: ACTIVITY_CATEGORIES[0] })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return students.filter((s) => !q || String(s.name || '').toLowerCase().includes(q) || String(s.email || '').toLowerCase().includes(q))
  }, [students, filter])

  if (students.length === 0) return null

  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setMsg('')
    try {
      const res = await fetch(`${apiUrl}/school/group-hours`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` },
        body: JSON.stringify({ ...form, hours: Number(form.hours), studentIds: [...picked] }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not add the hours.')
      setMsg(`Added ${form.hours} hours for ${data.added} student${data.added === 1 ? '' : 's'}.${data.skipped ? ` ${data.skipped} already had this entry.` : ''}`)
      setPicked(new Set())
      setForm((f) => ({ ...f, activity: '', hours: '' }))
      onDone?.()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <Card>
      <h3 className="font-semibold flex items-center gap-2"><UsersRound className="w-4 h-4 text-brand-600" />{' '}{tr('Log hours for a group')}</h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mt-0.5 mb-3">{tr('After a meeting or event, tick who was there. Each student gets the hours already approved, and a notification.')}</p>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid sm:grid-cols-[9.5rem,1fr,6rem] gap-2">
          <input type="date" className="input" value={form.date} max={today()} onChange={(e) => setForm({ ...form, date: e.target.value })} required aria-label={tr('Date')} />
          <input className="input" placeholder={tr('Key Club food drive')} value={form.activity} maxLength={200} onChange={(e) => setForm({ ...form, activity: e.target.value })} required aria-label={tr('Activity')} />
          <input type="number" className="input" min="0.25" max="24" step="0.25" placeholder={tr('Hours')} value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} required aria-label={tr('Hours')} />
        </div>
        <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} aria-label={tr('Category')}>
          {ACTIVITY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <input className="input flex-1" placeholder={tr('Search students')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button type="button" className="btn-ghost btn-sm" onClick={() => setPicked(new Set(shown.map((s) => s.id)))}>{tr('Select all ({n})', { n: shown.length })}</button>
          {picked.size > 0 && <button type="button" className="btn-ghost btn-sm" onClick={() => setPicked(new Set())}>{tr('Clear')}</button>}
        </div>
        <ul className="max-h-60 overflow-y-auto rounded-xl border border-earth-200 dark:border-earth-700 divide-y divide-earth-100 dark:divide-[#1f2e25]">
          {shown.map((s) => (
            <li key={s.id}>
              <label className="flex items-center gap-3 px-3 py-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                <span className="text-sm">{s.name || s.email}{s.grade ? <span className="text-earth-400"> · {s.grade}</span> : null}</span>
              </label>
            </li>
          ))}
        </ul>
        <button type="submit" className="btn-primary" disabled={busy || picked.size === 0}>
          {busy ? tr('Adding…') : `Add hours for ${picked.size} student${picked.size === 1 ? '' : 's'}`}
        </button>
        {msg && <p className="text-sm text-brand-700 dark:text-brand-300">{msg}</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </form>
    </Card>
  )
}
