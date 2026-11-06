import { useCallback, useEffect, useState } from 'react'
import { ClipboardList, Check, Loader2 } from 'lucide-react'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}`, 'Content-Type': 'application/json' })

// Jobs on the volunteer badge (#759): the organizer's list for this event,
// with spots left. An approved volunteer claims one (or lets it go); the job
// then shows in a pop-up when they check in. Nothing shows if there are no jobs.
export default function BadgeJobs({ taskId }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${encodeURIComponent(taskId)}/jobs`, { headers: auth() })
      if (res.ok) setData(await res.json())
    } catch { /* the badge works without it */ }
  }, [taskId])
  useEffect(() => { load() }, [load])

  if (!data || (!data.jobs?.length && !data.everyone)) return null

  const pick = async (jobId) => {
    setBusy(jobId || 'none')
    setError('')
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${encodeURIComponent(taskId)}/jobs/mine`, { method: 'PUT', headers: auth(), body: JSON.stringify({ jobId }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || tr('Could not save your job.'))
      await load()
    } catch (e) {
      setError(e.message)
      await load()
    } finally {
      setBusy('')
    }
  }

  const mine = data.jobs.find((j) => j.id === data.myJobId)
  return (
    <section className="mt-4 w-full max-w-sm rounded-2xl bg-white/10 p-4 text-left text-white" aria-label={tr('Jobs at this event')}>
      <h2 className="flex items-center gap-2 font-semibold"><ClipboardList className="w-4 h-4" />{' '}{tr('Jobs at this event')}</h2>
      {data.everyone && <p className="mt-2 text-sm"><span className="font-semibold">{tr('For everyone:')}</span>{' '}{data.everyone}</p>}
      {data.jobs.length > 0 && (
        <>
          <p className="mt-2 text-sm text-white/80">
            {mine ? tr('Your job: {job}', { job: mine.title }) : tr('Pick a job. The organizer can change it.')}
          </p>
          <ul className="mt-3 space-y-2">
            {data.jobs.map((j) => {
              const isMine = j.id === data.myJobId
              const full = j.left <= 0 && !isMine
              return (
                <li key={j.id} className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 ${isMine ? 'bg-emerald-500/25 ring-1 ring-emerald-300/60' : 'bg-black/20'}`}>
                  <div className="min-w-0">
                    <p className="font-medium break-words">{j.title}</p>
                    <p className="text-xs text-white/70">{isMine ? tr('Your job') : full ? tr('Full') : j.left === 1 ? tr('1 spot left') : tr('{n} spots left', { n: j.left })}</p>
                  </div>
                  {data.canClaim && (
                    isMine ? (
                      <button type="button" className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/25 disabled:opacity-60" onClick={() => pick(null)} disabled={!!busy}>
                        {busy === 'none' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{' '}{tr('Let go')}
                      </button>
                    ) : (
                      <button type="button" className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-emerald-800 hover:bg-white/90 disabled:opacity-50" onClick={() => pick(j.id)} disabled={full || !!busy}>
                        {busy === j.id ? <Loader2 className="w-4 h-4 animate-spin" /> : tr('Claim')}
                      </button>
                    )
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-200">{error}</p>}
    </section>
  )
}
