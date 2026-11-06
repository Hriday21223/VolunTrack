import { useCallback, useEffect, useState } from 'react'
import { ClipboardList, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}`, 'Content-Type': 'application/json' })
const MAX_JOBS = 20

// Jobs at an event (#759), for the organizer on My Tasks: a list of jobs with
// spots and a note for everyone. Approved volunteers claim jobs from their
// badge; here the organizer can also give anyone a job or change it. Jobs and
// the note show in a pop-up when the volunteer checks in, never on the
// public task.
export default function TaskJobsPanel({ task, onMessage }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState({ everyone: '', jobs: [] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const approved = (task.signups || []).filter((s) => s.status === 'approved')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${encodeURIComponent(task.id)}/jobs`, { headers: auth() })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || tr('Could not load the jobs.'))
      setData(d)
      setDraft({ everyone: d.everyone || '', jobs: d.jobs.map((j) => ({ id: j.id, title: j.title, spots: j.spots })) })
    } catch (e) { setError(e.message) }
  }, [task.id])
  useEffect(() => { if (open && !data) load() }, [open, data, load])

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${encodeURIComponent(task.id)}/jobs`, { method: 'PUT', headers: auth(), body: JSON.stringify(draft) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || tr('Could not save the jobs.'))
      await load()
      onMessage?.(tr('Jobs saved'))
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const assign = async (userId, jobId) => {
    setError('')
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${encodeURIComponent(task.id)}/jobs/assign`, { method: 'PUT', headers: auth(), body: JSON.stringify({ userId, jobId: jobId || null }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || tr('Could not assign the job.'))
    } catch (e) { setError(e.message) }
    await load()
  }

  const setJob = (i, patch) => setDraft((d) => ({ ...d, jobs: d.jobs.map((j, n) => (n === i ? { ...j, ...patch } : j)) }))
  const saved = data?.jobs || []
  const dirty = data && JSON.stringify({ everyone: data.everyone || '', jobs: saved.map((j) => ({ id: j.id, title: j.title, spots: j.spots })) }) !== JSON.stringify(draft)

  return (
    <div className="mb-4 rounded-xl border border-earth-200 dark:border-earth-700">
      <button type="button" className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="flex items-center gap-2"><ClipboardList className="w-4 h-4 text-brand-600" />{' '}{tr('Jobs at this event')}{data ? ` (${saved.length})` : ''}</span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3">
          <p className="text-xs text-earth-500">{tr('Approved volunteers pick a job from their badge, or you give them one below. Their job shows when they check in. Jobs aren’t shown on the public event.')}</p>
          {!data ? <p className="text-sm text-earth-500">{tr('Loading…')}</p> : (
            <>
              <div>
                <label className="label text-xs" htmlFor={`everyone-${task.id}`}>{tr('Note for everyone (optional)')}</label>
                <input id={`everyone-${task.id}`} className="input" maxLength={300} placeholder={tr('e.g. Wear the green vest')} value={draft.everyone} onChange={(e) => setDraft((d) => ({ ...d, everyone: e.target.value }))} />
              </div>
              <div className="space-y-2">
                {draft.jobs.map((j, i) => (
                  <div key={j.id || `new-${i}`} className="flex items-center gap-2">
                    <input className="input flex-1" maxLength={120} placeholder={tr('e.g. Sort cans at table 2')} aria-label={tr('Job')} value={j.title} onChange={(e) => setJob(i, { title: e.target.value })} />
                    <input className="input w-20" type="number" min={1} max={200} aria-label={tr('Spots')} value={j.spots} onChange={(e) => setJob(i, { spots: e.target.value })} />
                    <button type="button" className="p-2 rounded-lg text-earth-500 hover:text-red-500" aria-label={tr('Remove job')} onClick={() => setDraft((d) => ({ ...d, jobs: d.jobs.filter((_, n) => n !== i) }))}><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
                {draft.jobs.length < MAX_JOBS && (
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setDraft((d) => ({ ...d, jobs: [...d.jobs, { id: null, title: '', spots: 1 }] }))}>
                    <Plus className="w-4 h-4" />{' '}{tr('Add a job')}
                  </button>
                )}
              </div>
              {dirty && <button type="button" className="btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? tr('Saving…') : tr('Save jobs')}</button>}

              {saved.length > 0 && approved.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-earth-400 uppercase tracking-wider mb-1">{tr('Who does what')}</p>
                  <ul className="space-y-1.5">
                    {approved.map((v) => (
                      <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate">{v.name}</span>
                        <select className="input w-auto max-w-[60%] py-1 text-sm" aria-label={tr('Job for {name}', { name: v.name })} value={data.assigned?.[v.id] || ''} onChange={(e) => assign(v.id, e.target.value)}>
                          <option value="">{tr('No job yet')}</option>
                          {saved.map((j) => <option key={j.id} value={j.id}>{`${j.title} (${j.taken}/${j.spots})`}</option>)}
                        </select>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        </div>
      )}
    </div>
  )
}
