import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, Check, Plus, Trash2, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import Card from '@/components/Card.jsx'
import { ACTIVITY_CATEGORIES } from '@/lib/categories.js'
import { tr } from '@/lib/i18n.js'
import { hasAccount, listShifts, shiftsCall, pendingShiftDates, shiftHours, WEEKDAYS } from '@/lib/shifts.js'

const blank = { activity: '', category: ACTIVITY_CATEGORIES[0], orgName: '', location: '', supervisorName: '', weekday: 2, startTime: '16:00', endTime: '18:00' }

// "Repeat my regular shift" (#571): weekly shifts the student saved, and a
// "Did you go?" for each recent one not logged yet. Log it opens Log Hours
// filled in from the shift (/log?shift=…&date=…); Skip remembers that week.
export default function RegularShiftsCard({ logs }) {
  const nav = useNavigate()
  const [shifts, setShifts] = useState(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => { listShifts().then(setShifts).catch(() => setShifts([])) }, [])
  useEffect(() => { if (hasAccount()) load() }, [load])

  const prompts = useMemo(() => (shifts || []).flatMap((s) => pendingShiftDates(s, logs).map((date) => ({ shift: s, date }))), [shifts, logs])

  if (!hasAccount() || shifts === null) return null

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { shift } = await shiftsCall('', { method: 'POST', body: { ...form, weekday: Number(form.weekday) } })
      setShifts((list) => [...list, shift])
      setAdding(false)
      setForm(blank)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const skip = async (shift, date) => {
    try {
      const { shift: next } = await shiftsCall(`/${encodeURIComponent(shift.id)}/skip`, { method: 'POST', body: { date } })
      setShifts((list) => list.map((s) => (s.id === next.id ? next : s)))
    } catch (err) { setError(err.message) }
  }

  const remove = async (shift) => {
    try {
      await shiftsCall(`/${encodeURIComponent(shift.id)}`, { method: 'DELETE' })
      setShifts((list) => list.filter((s) => s.id !== shift.id))
    } catch (err) { setError(err.message) }
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="font-semibold flex items-center gap-2"><CalendarClock className="w-4 h-4 text-brand-400" aria-hidden="true" /> {tr('Regular shifts')}</h3>
        {!adding && shifts.length < 10 && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => setAdding(true)}><Plus className="w-3.5 h-3.5 mr-1" />{tr('Add a shift')}</button>
        )}
      </div>

      {prompts.map(({ shift, date }) => (
        <div key={`${shift.id}-${date}`} className="rounded-xl border border-brand-500/30 bg-brand-500/10 p-3 mb-2">
          <p className="text-sm">
            {tr('Did you go on {day}?', { day: format(parseISO(date), 'EEEE, MMM d') })}{' '}
            <strong>{shift.activity}</strong> · {shift.startTime}–{shift.endTime} ({shiftHours(shift)}h)
          </p>
          <div className="flex gap-2 mt-2">
            <button type="button" className="btn-primary btn-sm" onClick={() => nav(`/log?shift=${encodeURIComponent(shift.id)}&date=${date}`)}>
              <Check className="w-3.5 h-3.5 mr-1" />{tr('Yes, log it')}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => skip(shift, date)}>
              <X className="w-3.5 h-3.5 mr-1" />{tr('I didn’t go')}
            </button>
          </div>
        </div>
      ))}

      {shifts.length === 0 && !adding && (
        <p className="text-sm text-earth-400">{tr('Volunteer at the same time every week? Save it once and we’ll ask after each one, so logging takes one tap.')}</p>
      )}

      {shifts.length > 0 && (
        <ul className="divide-y divide-earth-200 dark:divide-white/10">
          {shifts.map((s) => (
            <li key={s.id} className="py-2 flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{tr('Every {day}', { day: tr(WEEKDAYS[s.weekday]) })} · {s.startTime}–{s.endTime} · {s.activity}{s.orgName ? ` · ${s.orgName}` : ''}</span>
              <button type="button" className="p-1 text-red-400 hover:text-red-300 shrink-0" onClick={() => remove(s)} aria-label={tr('Remove shift')}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <form onSubmit={save} className="space-y-2 mt-2">
          <input className="input" placeholder={tr('What you do, e.g. Reading buddies')} maxLength={200} value={form.activity} onChange={(e) => setForm({ ...form, activity: e.target.value })} required />
          <div className="grid grid-cols-2 gap-2">
            <input className="input" placeholder={tr('Organization')} maxLength={200} value={form.orgName} onChange={(e) => setForm({ ...form, orgName: e.target.value })} />
            <input className="input" placeholder={tr('Location')} maxLength={300} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            <input className="input" placeholder={tr('Supervisor name')} maxLength={100} value={form.supervisorName} onChange={(e) => setForm({ ...form, supervisorName: e.target.value })} />
            <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} aria-label={tr('Category')}>
              {ACTIVITY_CATEGORIES.map((c) => <option key={c} value={c}>{tr(c)}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <select className="input" value={form.weekday} onChange={(e) => setForm({ ...form, weekday: e.target.value })} aria-label={tr('Day of the week')}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>{tr(d)}</option>)}
            </select>
            <input className="input" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} aria-label={tr('Start time')} required />
            <input className="input" type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} aria-label={tr('End time')} required />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary btn-sm" disabled={busy}>{busy ? tr('Saving…') : tr('Save shift')}</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => { setAdding(false); setError('') }}>{tr('Cancel')}</button>
          </div>
        </form>
      )}
      {!adding && error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </Card>
  )
}
