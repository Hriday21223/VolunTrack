import { useCallback, useEffect, useMemo, useState } from 'react'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import { Mail, Target } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { printSchoolCertificates } from '@/lib/export.js'
import { fmtDate } from '@/utils/date.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

// Students tab → Hours progress: each linked student's hours against the
// school's requirement (Setup → Requirements → goals), most hours to go first,
// with a reminder email (server: GET /students/progress, POST /students/remind).
export default function StudentProgressPanel({ onSetRequirement }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [behindOnly, setBehindOnly] = useState(true)
  const [picked, setPicked] = useState(() => new Set())
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/school/students/progress`, { headers: auth() })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not load student progress.')
      setData(body)
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const gapDays = data?.reminderGapDays || 7
  const recentlyReminded = (s) => s.remindedAt && Date.now() - new Date(s.remindedAt).getTime() < gapDays * 864e5
  const canRemind = (s) => s.target && s.remaining > 0 && !s.consentPending && !recentlyReminded(s)

  const rows = useMemo(() => {
    const list = (data?.students || []).filter((s) => !behindOnly || (s.target && s.remaining > 0))
    return [...list].sort((a, b) => (b.remaining ?? -1) - (a.remaining ?? -1) || String(a.name).localeCompare(String(b.name)))
  }, [data, behindOnly])

  if (error) return <Card><p className="text-sm text-red-400">{error}</p></Card>
  if (!data) return <Card><p className="text-sm text-earth-500 py-6 text-center">Loading…</p></Card>

  const students = data.students
  const withGoal = students.filter((s) => s.target)
  const behind = withGoal.filter((s) => s.remaining > 0)
  const daysLeft = data.deadline ? differenceInCalendarDays(parseISO(data.deadline), new Date()) : null
  const weeksLeft = daysLeft != null && daysLeft > 0 ? daysLeft / 7 : null
  const remindable = rows.filter(canRemind)
  const chosen = [...picked].filter((id) => remindable.some((s) => s.id === id))

  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const send = async () => {
    setSending(true)
    try {
      const res = await fetch(`${apiUrl}/school/students/remind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ studentIds: chosen }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not send reminders.')
      setResult({ ok: true, text: `${body.sent} reminder${body.sent === 1 ? '' : 's'} sent${body.skipped ? `, ${body.skipped} skipped` : ''}.` })
      setPicked(new Set())
      load()
    } catch (e) {
      setResult({ ok: false, text: e.message })
    } finally {
      setSending(false)
      setConfirming(false)
    }
  }

  if (withGoal.length === 0) {
    return (
      <Card className="text-center py-8">
        <Target className="w-8 h-8 mx-auto text-earth-500 mb-2" />
        <p className="font-medium">No hour requirement set yet</p>
        <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">Set how many hours your students need (one total, or per grade) to see who is behind.</p>
        {onSetRequirement && <button onClick={onSetRequirement} className="btn-primary btn-sm mt-4">Set the requirement</button>}
      </Card>
    )
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Target className="w-4 h-4 text-brand-600" /> Hours progress</h3>
          <p className="text-sm text-earth-500 dark:text-earth-400">
            {behind.length} of {withGoal.length} students still have hours to go
            {data.deadline && <> · due {fmtDate(data.deadline)}{daysLeft != null && (daysLeft >= 0 ? ` (${daysLeft} days left)` : ' (past due)')}</>}
          </p>
        </div>
        {withGoal.length > behind.length && (
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              const done = withGoal.filter((s) => s.remaining <= 0).sort((a, b) => String(a.name).localeCompare(String(b.name)))
              if (!printSchoolCertificates({ schoolName: data.schoolName, students: done, certificate: data.certificate })) window.alert('Allow pop-ups for this site to print the certificates.')
            }}
          >
            Print certificates ({withGoal.length - behind.length})
          </button>
        )}
        <label className="flex items-center gap-2 text-sm text-earth-300">
          <input type="checkbox" checked={behindOnly} onChange={(e) => setBehindOnly(e.target.checked)} /> Only students with hours to go
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-emerald-400 py-6 text-center">Everyone has met their hours. 🎉</p>
      ) : (
        <ul className="divide-y divide-white/10">
          {rows.map((s) => {
            const pct = s.target ? Math.min(100, Math.round((s.hours / s.target) * 100)) : 0
            return (
              <li key={s.id} className="py-3 flex items-center gap-3">
                <input
                  type="checkbox"
                  aria-label={`Select ${s.name}`}
                  disabled={!canRemind(s)}
                  checked={picked.has(s.id)}
                  onChange={() => toggle(s.id)}
                  className="shrink-0 disabled:opacity-30"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-medium truncate">{s.name}{s.grade ? <span className="text-xs text-earth-500"> · Grade {s.grade}</span> : null}</span>
                    <span className="text-sm whitespace-nowrap">
                      {s.target ? <>{s.hours} / {s.target} h{s.remaining > 0 && <span className="text-amber-300"> · {s.remaining} to go</span>}</> : <span className="text-earth-500">No goal for this grade</span>}
                    </span>
                  </div>
                  {s.target ? (
                    <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div className={`h-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                  ) : null}
                  <p className="text-xs text-earth-500 mt-1">
                    {s.lastLogDate ? `Last logged ${fmtDate(s.lastLogDate)}` : 'Nothing logged yet'}
                    {weeksLeft && s.remaining > 0 ? ` · needs ${Math.ceil((s.remaining / weeksLeft) * 4) / 4} h/week` : ''}
                    {s.categoryShort?.length > 0 && <span className="text-amber-300">{' · still needs '}{s.categoryShort.map((c) => `${c.remaining} h ${c.category}`).join(', ')}</span>}
                    {s.consentPending ? ' · waiting for parent approval' : recentlyReminded(s) ? ` · reminded ${fmtDate(String(s.remindedAt).slice(0, 10))}` : ''}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {remindable.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-3 flex flex-wrap items-center gap-2">
          <button onClick={() => setPicked(new Set(remindable.map((s) => s.id)))} className="btn-ghost btn-sm">Select all ({remindable.length})</button>
          {confirming ? (
            <>
              <span className="text-sm text-earth-300">Email {chosen.length} student{chosen.length === 1 ? '' : 's'} how many hours they have left?</span>
              <button onClick={send} disabled={sending} className="btn-primary btn-sm">{sending ? 'Sending…' : 'Yes, send'}</button>
              <button onClick={() => setConfirming(false)} disabled={sending} className="btn-ghost btn-sm">No</button>
            </>
          ) : (
            <button onClick={() => { setResult(null); setConfirming(true) }} disabled={chosen.length === 0} className="btn-primary btn-sm inline-flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" /> Email reminder{chosen.length ? ` (${chosen.length})` : ''}
            </button>
          )}
          <p className="w-full text-xs text-earth-500">Each student gets at most one reminder every {gapDays} days.</p>
        </div>
      )}
      {result && <p className={`text-sm mt-2 ${result.ok ? 'text-emerald-300' : 'text-red-400'}`} role="status">{result.text}</p>}
    </Card>
  )
}
