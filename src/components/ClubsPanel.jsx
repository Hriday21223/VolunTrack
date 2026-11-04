import { useCallback, useEffect, useMemo, useState } from 'react'
import { Users2, Plus, Trash2, Download } from 'lucide-react'
import Card from '@/components/Card.jsx'
import ProgressBar from '@/components/ProgressBar.jsx'
import { csvCell } from '@/lib/csv.js'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })
async function call(path, opts = {}) {
  const res = await fetch(`${apiUrl}/clubs${path}`, { headers: headers(), ...opts })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || tr('Something went wrong.'))
  return body
}

// Students → Clubs (#660): clubs inside the school, each with members,
// advisers and an hour goal for the school year.
export default function ClubsPanel({ students = [] }) {
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')

  const load = useCallback(async () => {
    try { setData(await call('')) } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const create = async (e) => {
    e.preventDefault(); setError('')
    try {
      const r = await call('', { method: 'POST', body: JSON.stringify({ name, goalHours: goal === '' ? null : Number(goal) }) })
      setName(''); setGoal(''); await load(); setSelected(r.id)
    } catch (err) { setError(err.message) }
  }

  const club = data?.clubs.find((c) => c.id === selected)
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-2 mb-1">
          <Users2 className="w-5 h-5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
          <h3 className="font-semibold">{tr('Clubs and groups')}</h3>
        </div>
        <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">{tr('NHS, Key Club, a class: each club has its own members, advisers and hour goal for the school year.')}</p>
        {data?.clubs?.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {data.clubs.map((c) => (
              <button key={c.id} type="button" onClick={() => setSelected(c.id)} className={`btn-sm ${selected === c.id ? 'btn-primary' : 'btn-ghost'}`}>
                {c.name} <span className="opacity-70">· {c.members}</span>{c.mine ? ' ★' : ''}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={create} className="flex flex-wrap gap-2 items-end">
          <label className="text-sm flex-1 min-w-[10rem]">
            <span className="block mb-1 text-earth-600 dark:text-earth-300">{tr('New club')}</span>
            <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={tr('e.g. National Honor Society')} required />
          </label>
          <label className="text-sm w-36">
            <span className="block mb-1 text-earth-600 dark:text-earth-300">{tr('Hour goal (optional)')}</span>
            <input className="input" type="number" min="0.5" step="0.5" value={goal} onChange={(e) => setGoal(e.target.value)} />
          </label>
          <button type="submit" className="btn-primary inline-flex items-center gap-1"><Plus className="w-4 h-4" aria-hidden="true" />{tr('Add club')}</button>
        </form>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 mt-2">{error}</p>}
      </Card>
      {club && <ClubDetail key={club.id} club={club} staff={data.staff} students={students} onChanged={load} onDeleted={() => { setSelected(null); load() }} />}
    </div>
  )
}

function ClubDetail({ club, staff, students, onChanged, onDeleted }) {
  const [progress, setProgress] = useState(null)
  const [editing, setEditing] = useState(false)
  const [picked, setPicked] = useState(() => new Set(club.memberIds))
  const [search, setSearch] = useState('')
  const [goal, setGoal] = useState(club.goalHours ?? '')
  const [advisers, setAdvisers] = useState(() => new Set(club.advisers.map((a) => a.id)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadProgress = useCallback(async () => {
    try { setProgress(await call(`/${club.id}/progress`)) } catch (e) { setError(e.message) }
  }, [club.id])
  useEffect(() => { loadProgress() }, [loadProgress])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return students.filter((s) => !q || `${s.name} ${s.email}`.toLowerCase().includes(q))
  }, [students, search])

  const save = async () => {
    setBusy(true); setError('')
    try {
      await call(`/${club.id}/members`, { method: 'PUT', body: JSON.stringify({ userIds: [...picked] }) })
      await call(`/${club.id}`, { method: 'PATCH', body: JSON.stringify({ goalHours: goal === '' ? null : Number(goal), adviserIds: [...advisers] }) })
      setEditing(false); onChanged(); loadProgress()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!window.confirm(tr('Delete the club “{name}”? Members keep their hours.', { name: club.name }))) return
    try { await call(`/${club.id}`, { method: 'DELETE' }); onDeleted() } catch (e) { setError(e.message) }
  }
  const csv = () => {
    const rows = [['Student', 'Email', 'Grade', 'Hours', 'Approved', 'Goal', 'To go'], ...(progress?.members || []).map((m) => [m.name, m.email, m.grade || '', m.hours, m.approved, progress.club.goalHours ?? '', m.remaining ?? ''])]
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }))
    a.download = `${club.name.replace(/[^\w-]+/g, '-').toLowerCase()}-hours.csv`
    a.click()
  }
  const toggle = (set, setter, id) => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); setter(next) }
  const members = progress?.members || []
  const met = progress?.club.goalHours ? members.filter((m) => m.remaining === 0).length : null

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="font-semibold text-lg">{club.name}</h3>
          <p className="text-sm text-earth-500 dark:text-earth-400">
            {tr('{n} members', { n: club.members })}
            {club.goalHours ? <> · {tr('Goal: {n} hours this school year', { n: club.goalHours })}</> : null}
            {met != null && <> · {tr('{n} met it', { n: met })}</>}
            {club.advisers.length > 0 && <> · {tr('Advisers: {names}', { names: club.advisers.map((a) => a.name).join(', ') })}</>}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-sm btn-ghost" onClick={csv} disabled={!members.length}><Download className="w-3.5 h-3.5 mr-1" />CSV</button>
          <button type="button" className="btn-sm btn-secondary" onClick={() => setEditing(!editing)}>{editing ? tr('Close') : tr('Edit club')}</button>
          <button type="button" className="btn-sm btn-ghost text-red-500" onClick={remove} aria-label={tr('Delete club')}><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {editing && (
        <div className="mb-4 space-y-3 rounded-xl border border-earth-200 dark:border-white/10 p-3">
          <label className="text-sm block w-40">
            <span className="block mb-1">{tr('Hour goal (optional)')}</span>
            <input className="input" type="number" min="0.5" step="0.5" value={goal} onChange={(e) => setGoal(e.target.value)} />
          </label>
          <div>
            <p className="text-sm font-medium mb-1">{tr('Advisers')}</p>
            <div className="flex flex-wrap gap-3">
              {staff.map((s) => (
                <label key={s.id} className="text-sm flex items-center gap-1.5">
                  <input type="checkbox" checked={advisers.has(s.id)} onChange={() => toggle(advisers, setAdvisers, s.id)} />{s.name}
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium mb-1">{tr('Members ({n})', { n: picked.size })}</p>
            <input className="input mb-2" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr('Search students')} aria-label={tr('Search students')} />
            <div className="max-h-64 overflow-auto grid sm:grid-cols-2 gap-1">
              {shown.map((s) => (
                <label key={s.id} className="text-sm flex items-center gap-1.5">
                  <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(picked, setPicked, s.id)} />
                  <span className="truncate">{s.name}{s.grade ? ` · ${s.grade}` : ''}</span>
                </label>
              ))}
            </div>
          </div>
          <button type="button" className="btn-primary" onClick={save} disabled={busy}>{busy ? tr('Saving…') : tr('Save club')}</button>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 mb-2">{error}</p>}
      {progress === null && <p className="text-sm text-earth-500">{tr('Loading…')}</p>}
      {progress && members.length === 0 && <p className="text-sm text-earth-500">{tr('No members yet. Use Edit club to add students.')}</p>}
      {members.length > 0 && (
        <ul className="divide-y divide-earth-100 dark:divide-white/5">
          {members.map((m) => (
            <li key={m.id} className="py-2">
              <div className="flex justify-between gap-2 text-sm">
                <span className="font-medium truncate">{m.name}{m.grade ? <span className="text-earth-500 font-normal"> · {m.grade}</span> : null}</span>
                <span>{progress.club.goalHours ? `${m.hours} / ${progress.club.goalHours} h` : `${m.hours} h`}</span>
              </div>
              {progress.club.goalHours ? <ProgressBar value={m.hours} target={progress.club.goalHours} /> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
