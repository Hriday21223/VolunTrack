import { useEffect, useMemo, useState } from 'react'
import { format, startOfWeek, addDays } from 'date-fns'
import { Users } from 'lucide-react'
import Card from '@/components/Card.jsx'
import ProgressBar from '@/components/ProgressBar.jsx'
import { countedLogs } from '@/lib/achievements.js'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

// Counted hours dated this week (Mon–Sun), up to today.
export function hoursThisWeek(logs) {
  const start = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const end = format(addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), 6), 'yyyy-MM-dd')
  const today = format(new Date(), 'yyyy-MM-dd')
  return countedLogs(logs)
    .filter((l) => { const d = String(l.date || '').slice(0, 10); return d >= start && d <= end && d <= today })
    .reduce((s, l) => s + (Number(l.hours) || 0), 0)
}

function GoalProgress({ done, goal }) {
  const met = done >= goal
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm mb-1">
        <span className="text-earth-500">{tr('This week')}</span>
        {met && <span className="text-emerald-500 dark:text-emerald-300 font-medium">{tr('Goal met! 🎉')}</span>}
      </div>
      <ProgressBar value={done} target={goal} />
    </div>
  )
}

// Parent side (#788): set or change a child's weekly goal, see this week.
export function ParentWeeklyGoal({ child }) {
  const [goal, setGoal] = useState(child.weeklyGoal ?? null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(child.weeklyGoal ?? 2))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const done = useMemo(() => hoursThisWeek(child.logs), [child.logs])

  const save = async (hours) => {
    setBusy(true); setError('')
    try {
      const res = await fetch(`${apiUrl}/parent/children/${encodeURIComponent(child.id)}/weekly-goal`, {
        method: 'PUT', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ hours }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || tr('Could not save the weekly goal.'))
      setGoal(d.weeklyGoal); setEditing(false)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="mb-4 rounded-xl border border-white/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p className="text-sm font-medium flex items-center gap-1.5"><Users className="w-4 h-4 text-brand-600" />{' '}{tr('Weekly family goal')}</p>
        {!editing && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => { setDraft(String(goal ?? 2)); setEditing(true) }}>
            {goal ? tr('Change') : tr('Set a goal')}
          </button>
        )}
      </div>
      {editing ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); save(Number(draft)) }}>
          <input type="number" className="input w-24" min={0.5} max={40} step={0.25} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={tr('Hours each week')} required />
          <span className="text-sm text-earth-500">{tr('hours each week')}</span>
          <button type="submit" className="btn-primary btn-sm" disabled={busy}>{tr('Save')}</button>
          {goal && <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => save(0)}>{tr('Remove')}</button>}
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => setEditing(false)}>{tr('Cancel')}</button>
        </form>
      ) : goal ? (
        <GoalProgress done={done} goal={goal} />
      ) : (
        <p className="text-xs text-earth-500">{tr('Agree on a small number of hours together. You both see how the week is going.')}</p>
      )}
      {error && <p className="text-sm text-red-400 mt-2" role="alert">{error}</p>}
    </div>
  )
}

// Student side (#788): the goal a linked parent set, with this week's hours.
export function StudentWeeklyGoal({ logs, className = '' }) {
  const [goal, setGoal] = useState(null)
  useEffect(() => {
    fetch(`${apiUrl}/parent/my-weekly-goal`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : { weeklyGoal: null }))
      .then((d) => setGoal(d.weeklyGoal || null))
      .catch(() => setGoal(null))
  }, [])
  const done = useMemo(() => hoursThisWeek(logs), [logs])
  if (!goal) return null
  return (
    <Card className={className}>
      <h3 className="font-semibold flex items-center gap-2 mb-2"><Users className="w-4 h-4 text-brand-600" />{' '}{tr('Weekly family goal')}</h3>
      {goal.parentFirstName && <p className="text-xs text-earth-500 mb-2">{tr('Set with {name}', { name: goal.parentFirstName })}</p>}
      <GoalProgress done={done} goal={goal.hours} />
    </Card>
  )
}
