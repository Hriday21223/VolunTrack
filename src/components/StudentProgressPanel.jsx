import { useCallback, useEffect, useMemo, useState } from 'react'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import { Mail, Target } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { printSchoolCertificates } from '@/lib/export.js'
import { fmtDate } from '@/utils/date.js'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

// Behind on hours and nothing logged (dated) in the last 30 days (#782).
const QUIET_DAYS = 30
const isQuiet = (s) => Boolean(s.target && s.remaining > 0 && !s.consentPending
  && (!s.lastLogDate || differenceInCalendarDays(new Date(), parseISO(s.lastLogDate)) >= QUIET_DAYS))

// Students tab → Hours progress: each linked student's hours against the
// school's requirement (Setup → Requirements → goals), most hours to go first,
// with a reminder email (server: GET /students/progress, POST /students/remind).
export default function StudentProgressPanel({ onSetRequirement }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [behindOnly, setBehindOnly] = useState(true)
  const [quietOnly, setQuietOnly] = useState(false)
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
    const list = (data?.students || []).filter((s) => (quietOnly ? isQuiet(s) : !behindOnly || (s.target && s.remaining > 0)))
    return [...list].sort((a, b) => (b.remaining ?? -1) - (a.remaining ?? -1) || String(a.name).localeCompare(String(b.name)))
  }, [data, behindOnly, quietOnly])

  if (error) return <Card><p className="text-sm text-red-400">{error}</p></Card>
  if (!data) return <Card><p className="text-sm text-earth-500 py-6 text-center">{tr('Loading…')}</p></Card>

  const students = data.students
  const withGoal = students.filter((s) => s.target)
  const behind = withGoal.filter((s) => s.remaining > 0)
  const quiet = students.filter(isQuiet)
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
        <p className="font-medium">{tr('No hour requirement set yet')}</p>
        <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">{tr('Set how many hours your students need (one total, or per grade) to see who is behind.')}</p>
        {onSetRequirement && <button onClick={onSetRequirement} className="btn-primary btn-sm mt-4">{tr('Set the requirement')}</button>}
      </Card>
    )
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Target className="w-4 h-4 text-brand-600" />{' '}{tr('Hours progress')}</h3>
          <p className="text-sm text-earth-500 dark:text-earth-400">
            {tr('{n} of {total} students still have hours to go', { n: behind.length, total: withGoal.length })}
            {data.deadline && <> · {tr('due {date}', { date: fmtDate(data.deadline) })}{daysLeft != null && (daysLeft >= 0 ? ` ${tr('({n} days left)', { n: daysLeft })}` : ` ${tr('(past due)')}`)}</>}
          </p>
        </div>
        {withGoal.length > behind.length && (
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              const done = withGoal.filter((s) => s.remaining <= 0).sort((a, b) => String(a.name).localeCompare(String(b.name)))
              if (!printSchoolCertificates({ schoolName: data.schoolName, students: done, certificate: data.certificate })) window.alert(tr('Allow pop-ups for this site to print the certificates.'))
            }}
          >
            {tr('Print certificates ({n})', { n: withGoal.length - behind.length })}
          </button>
        )}
        <label className="flex items-center gap-2 text-sm text-earth-300">
          <input type="checkbox" checked={behindOnly} disabled={quietOnly} onChange={(e) => setBehindOnly(e.target.checked)} />{' '}{tr('Only students with hours to go')}
        </label>
      </div>

      {quiet.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 flex flex-wrap items-center justify-between gap-2" role="status">
          <p className="text-sm text-amber-200">
            {quiet.length === 1
              ? tr("1 student is behind and hasn't logged anything in {n} days.", { n: QUIET_DAYS })
              : tr("{count} students are behind and haven't logged anything in {n} days.", { count: quiet.length, n: QUIET_DAYS })}
          </p>
          <button type="button" className="btn-secondary btn-sm" onClick={() => { setQuietOnly((q) => !q); setPicked(new Set()) }}>
            {quietOnly ? tr('Show everyone') : tr('Show them')}
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-emerald-400 py-6 text-center">{tr('Everyone has met their hours. 🎉')}</p>
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
                    <span className="font-medium truncate">
                      {s.name}{s.grade ? <span className="text-xs text-earth-500"> · {tr('Grade {grade}', { grade: s.grade })}</span> : null}
                      {s.award && <span className="ml-2 text-[0.6875rem] px-1.5 py-0.5 rounded-full bg-brand-600/15 text-brand-600 dark:text-brand-300">{s.award}</span>}
                    </span>
                    <span className="text-sm whitespace-nowrap">
                      {s.target ? <>{s.hours} / {s.target} h{s.remaining > 0 && <span className="text-amber-300"> · {tr('{n} to go', { n: s.remaining })}</span>}</> : <span className="text-earth-500">{tr('No goal for this grade')}</span>}
                    </span>
                  </div>
                  {s.target ? (
                    <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div className={`h-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                  ) : null}
                  <p className="text-xs text-earth-500 mt-1">
                    {data?.term && s.termHours != null && (
                      <span className={s.termHours >= data.term.hours ? 'text-emerald-400' : 'text-amber-300'}>
                        {tr('{term}: {done} of {target} h', { term: data.term.name, done: s.termHours, target: data.term.hours })}{' · '}
                      </span>
                    )}
                    {s.lastLogDate ? tr('Last logged {date}', { date: fmtDate(s.lastLogDate) }) : tr('Nothing logged yet')}
                    {weeksLeft && s.remaining > 0 ? ` · ${tr('needs {n} h/week', { n: Math.ceil((s.remaining / weeksLeft) * 4) / 4 })}` : ''}
                    {s.categoryShort?.length > 0 && <span className="text-amber-300">{` · ${tr('still needs')} `}{s.categoryShort.map((c) => `${c.remaining} h ${c.category}`).join(', ')}</span>}
                    {s.consentPending ? ` · ${tr('waiting for parent approval')}` : recentlyReminded(s) ? ` · ${tr('reminded {date}', { date: fmtDate(String(s.remindedAt).slice(0, 10)) })}` : ''}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {remindable.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-3 flex flex-wrap items-center gap-2">
          <button onClick={() => setPicked(new Set(remindable.map((s) => s.id)))} className="btn-ghost btn-sm">{tr('Select all ({n})', { n: remindable.length })}</button>
          {confirming ? (
            <>
              <span className="text-sm text-earth-300">{chosen.length === 1 ? tr('Email 1 student how many hours they have left?') : tr('Email {n} students how many hours they have left?', { n: chosen.length })}</span>
              <button onClick={send} disabled={sending} className="btn-primary btn-sm">{sending ? tr('Sending…') : tr('Yes, send')}</button>
              <button onClick={() => setConfirming(false)} disabled={sending} className="btn-ghost btn-sm">{tr('No')}</button>
            </>
          ) : (
            <button onClick={() => { setResult(null); setConfirming(true) }} disabled={chosen.length === 0} className="btn-primary btn-sm inline-flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" />{' '}{tr('Email reminder')}{chosen.length ? ` (${chosen.length})` : ''}
            </button>
          )}
          <p className="w-full text-xs text-earth-500">{tr('Each student gets at most one reminder every {n} days.', { n: gapDays })}</p>
        </div>
      )}
      {result && <p className={`text-sm mt-2 ${result.ok ? 'text-emerald-300' : 'text-red-400'}`} role="status">{result.text}</p>}
    </Card>
  )
}
