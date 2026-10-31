import { useCallback, useEffect, useState } from 'react'
import { Flag } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })
const fmtDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

// Group challenge (#531): one shared hour goal for the whole school. Students
// see the progress bar and their own share; advisers (`manage`) can start one
// or end the running one. Only counts are shown, never who logged what.
export default function ChallengeCard({ manage = false, className = '' }) {
  const [challenge, setChallenge] = useState(undefined)
  const [form, setForm] = useState({ title: '', goalHours: '', endsOn: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    fetch(`${apiUrl}/school/challenge`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : { challenge: null }))
      .then((d) => setChallenge(d.challenge || null))
      .catch(() => setChallenge(null))
  }, [])
  useEffect(() => { load() }, [load])

  if (challenge === undefined) return null
  if (!challenge && !manage) return null

  const start = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/school/challenge`, {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: form.title, goalHours: Number(form.goalHours), endsOn: form.endsOn }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not start the challenge.')
      setChallenge(data.challenge)
      setForm({ title: '', goalHours: '', endsOn: '' })
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const end = async () => {
    if (!window.confirm(tr('End this challenge now? Students will stop seeing it.'))) return
    setBusy(true)
    try {
      await fetch(`${apiUrl}/school/challenge/${challenge.id}`, { method: 'DELETE', headers: auth() })
      setChallenge(null)
    } finally { setBusy(false) }
  }

  if (!challenge) {
    return (
      <Card className={className}>
        <h3 className="font-semibold flex items-center gap-2"><Flag className="w-4 h-4 text-brand-600" />{' '}{tr('Start a group challenge')}</h3>
        <p className="text-sm text-earth-500 dark:text-earth-400 mt-0.5 mb-3">{tr('A shared goal for all your students, like “500 hours together by Dec 1”. Everyone sees one progress bar fill up as anyone logs hours.')}</p>
        <form onSubmit={start} className="grid sm:grid-cols-[1fr,8rem,10rem,auto] gap-2">
          <input className="input" placeholder={tr('Fall food drive')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={120} />
          <input className="input" type="number" min="1" placeholder={tr('Hours')} value={form.goalHours} onChange={(e) => setForm({ ...form, goalHours: e.target.value })} required />
          <input className="input" type="date" value={form.endsOn} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} required aria-label={tr('End date')} />
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? tr('Starting…') : tr('Start')}</button>
        </form>
        {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
      </Card>
    )
  }

  const pct = Math.min(100, (challenge.hours / challenge.goalHours) * 100)
  const done = challenge.hours >= challenge.goalHours
  return (
    <Card className={className}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400 flex items-center gap-1.5"><Flag className="w-3.5 h-3.5" /> {tr('Group challenge')}</p>
          <h3 className="font-display font-semibold mt-0.5 truncate">{challenge.title}</h3>
        </div>
        {manage && <button type="button" className="btn-ghost btn-sm shrink-0" onClick={end} disabled={busy}>{tr('End')}</button>}
      </div>
      <div className="mt-3 h-3 rounded-full bg-earth-100 dark:bg-earth-800 overflow-hidden">
        <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-sm">
        <strong>{tr('{h} of {g} hours together', { h: challenge.hours, g: challenge.goalHours })}</strong>
        {done ? ` · ${tr('Goal reached! 🎉')}` : ` · ${tr('ends {date}', { date: fmtDate(challenge.endsOn) })}`}
      </p>
      <p className="text-xs text-earth-500 dark:text-earth-400 mt-0.5">
        {tr('{n} students taking part', { n: challenge.participants })}
        {challenge.myHours != null && ` · ${challenge.myHours > 0 ? tr('you added {h} hours', { h: challenge.myHours }) : tr('log hours to add yours')}`}
      </p>
    </Card>
  )
}
