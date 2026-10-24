import { useCallback, useEffect, useState } from 'react'
import { GraduationCap, Loader2, Undo2, ArrowRight } from 'lucide-react'
import Card from '@/components/Card.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}`,
})
const fmtDay = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

/**
 * "New school year" (#481): move every student up a grade in one step, with
 * a preview first and an undo for two weeks. School admins only; the server
 * enforces that too. `onChanged` reloads the roster after a move or undo.
 */
export default function GradeRolloverCard({ onChanged, onOpenGraduationReport }) {
  const [plan, setPlan] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [already, setAlready] = useState(null) // last run date when the server asks for force
  const [msg, setMsg] = useState(null) // { ok, text }

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/school/grade-rollover`, { headers: headers() })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not load the preview.')
      setPlan(data)
    } catch (e) {
      setMsg({ ok: false, text: e.message })
    }
  }, [])

  useEffect(() => { load() }, [load])

  const run = async (force = false) => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(`${apiUrl}/school/grade-rollover`, { method: 'POST', headers: headers(), body: JSON.stringify({ force }) })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && data.lastRunAt) { setAlready(data.lastRunAt); return }
      if (!res.ok) throw new Error(data.error || 'Could not move grades up.')
      setConfirming(false)
      setAlready(null)
      setMsg({ ok: true, text: `Moved ${data.moved} ${data.moved === 1 ? 'student' : 'students'} up a grade.${data.skipped ? ` ${data.skipped} left as they were.` : ''}` })
      await load()
      onChanged?.()
    } catch (e) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const undo = async () => {
    if (!plan?.lastRun) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(`${apiUrl}/school/grade-rollover/${encodeURIComponent(plan.lastRun.id)}/undo`, { method: 'POST', headers: headers() })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not undo.')
      setMsg({ ok: true, text: `Undone: ${data.restored} ${data.restored === 1 ? 'grade' : 'grades'} put back.${data.kept ? ` ${data.kept} ${data.kept === 1 ? 'student had' : 'students had'} changed their grade since and kept it.` : ''}` })
      await load()
      onChanged?.()
    } catch (e) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const last = plan?.lastRun
  const graduating = plan?.moves?.find((m) => m.to === 'Graduated')?.count || 0

  return (
    <Card className="mt-4">
      <h3 className="font-semibold mb-1 flex items-center gap-2"><GraduationCap className="w-4 h-4 text-brand-600" /> New school year</h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">
        Move every student up a grade at the start of the year. 12th graders become Graduated. You can undo it for {plan?.undoDays || 14} days.
      </p>

      {msg && (
        <div className={`mb-3 text-sm px-3 py-2 rounded-lg ${msg.ok ? 'text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-300' : 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300'}`} role="status">
          {msg.text}
        </div>
      )}

      {last && !last.undoneAt && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-earth-500 dark:text-earth-400">Last moved up on {fmtDay(last.runAt)} ({last.moved} {last.moved === 1 ? 'student' : 'students'}).</span>
          {last.canUndo && (
            <button type="button" className="btn-sm btn-ghost" onClick={undo} disabled={busy}>
              <Undo2 className="w-3.5 h-3.5" /> Undo
            </button>
          )}
        </div>
      )}

      {!plan ? (
        <p className="text-sm text-earth-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
      ) : plan.moving === 0 ? (
        <p className="text-sm text-earth-500 dark:text-earth-400">
          No students have a grade from Kindergarten to 12th to move up{plan.skipped ? ` (${plan.skipped} with another grade or none)` : ''}.
        </p>
      ) : (
        <>
          <ul className="mb-3 divide-y divide-white/5 rounded-xl border border-earth-200 dark:border-white/10 text-sm">
            {plan.moves.map((m) => (
              <li key={`${m.from}-${m.to}`} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="flex items-center gap-2">{m.from} <ArrowRight className="w-3.5 h-3.5 text-earth-400" /> {m.to}</span>
                <span className="text-earth-500 dark:text-earth-400">{m.count} {m.count === 1 ? 'student' : 'students'}</span>
              </li>
            ))}
          </ul>
          {plan.skipped > 0 && (
            <p className="mb-3 text-xs text-earth-500 dark:text-earth-400">
              {plan.skipped} {plan.skipped === 1 ? 'student stays' : 'students stay'} as they are (College, Graduated, another label, or no grade).
            </p>
          )}
          {graduating > 0 && (
            <p className="mb-3 text-sm p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300">
              Print the graduation report for your seniors first: after this they are listed as Graduated, not 12th grade.{' '}
              {onOpenGraduationReport && (
                <button type="button" className="underline font-medium" onClick={onOpenGraduationReport}>Open the graduation report</button>
              )}
            </p>
          )}

          {already ? (
            <div className="space-y-2">
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Grades were already moved up on {fmtDay(already)}. Doing it again moves every student up another grade.
              </p>
              <div className="flex gap-2">
                <button type="button" className="btn-danger" onClick={() => run(true)} disabled={busy}>Move up again anyway</button>
                <button type="button" className="btn-ghost" onClick={() => { setAlready(null); setConfirming(false) }}>Cancel</button>
              </div>
            </div>
          ) : confirming ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" onClick={() => run(false)} disabled={busy}>
                {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Moving…</> : `Yes, move ${plan.moving} ${plan.moving === 1 ? 'student' : 'students'} up`}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
            </div>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => { setMsg(null); setConfirming(true) }}>
              Move everyone up a grade
            </button>
          )}
        </>
      )}
    </Card>
  )
}
