import { Plus, Trash2 } from 'lucide-react'
import { MAX_SHIFTS, addHours } from '@/lib/taskShifts.js'

// Shifts within an event (#589), on the organizer's post and edit forms.
// `value` is a list of { id?, label, start: 'HH:MM', end: 'HH:MM', slots };
// the server checks it again (server/taskShifts.js).
export default function ShiftsEditor({ value, onChange, idPrefix = 'shift' }) {
  const shifts = value || []
  const set = (i, patch) => onChange(shifts.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const remove = (i) => onChange(shifts.filter((_, j) => j !== i))
  const add = () => {
    const last = shifts[shifts.length - 1]
    onChange([...shifts, { label: '', start: last?.end || '09:00', end: addHours(last?.end || '09:00', 2), slots: last?.slots || 2 }])
  }
  const total = shifts.reduce((sum, s) => sum + (Number(s.slots) || 0), 0)

  return (
    <div className="space-y-2">
      {shifts.map((s, i) => {
        const bad = s.start && s.end && s.end <= s.start
        return (
          <fieldset key={s.id || i} className="min-w-0 rounded-xl border border-earth-200 dark:border-white/10 p-3">
            <legend className="sr-only">Shift {i + 1}</legend>
            <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
              <div>
                <label className="label text-xs" htmlFor={`${idPrefix}-${i}-label`}>Shift {i + 1} name or role</label>
                <input id={`${idPrefix}-${i}-label`} className="input" maxLength={60} placeholder="e.g. Setup, Serving, Cleanup" value={s.label} onChange={(e) => set(i, { label: e.target.value })} />
              </div>
              <button type="button" className="btn-ghost p-2 mb-0.5" onClick={() => remove(i)} disabled={shifts.length <= 2 || s.filled > 0} aria-label={`Remove shift ${i + 1}`} title={s.filled > 0 ? 'People are signed up for this shift' : shifts.length <= 2 ? 'An event with shifts needs at least two' : 'Remove'}>
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div>
                <label className="label text-xs" htmlFor={`${idPrefix}-${i}-start`}>Starts</label>
                <input id={`${idPrefix}-${i}-start`} type="time" className="input px-2 min-w-0 w-full" value={s.start} onChange={(e) => set(i, { start: e.target.value })} required />
              </div>
              <div>
                <label className="label text-xs" htmlFor={`${idPrefix}-${i}-end`}>Ends</label>
                <input id={`${idPrefix}-${i}-end`} type="time" className="input px-2 min-w-0 w-full" value={s.end} onChange={(e) => set(i, { end: e.target.value })} required aria-invalid={bad || undefined} />
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <label className="label text-xs mb-0" htmlFor={`${idPrefix}-${i}-slots`}>Spots</label>
              <input id={`${idPrefix}-${i}-slots`} type="number" min={Math.max(1, s.filled || 0)} max={1000} className="input w-24" value={s.slots} onChange={(e) => set(i, { slots: e.target.value })} required />
            </div>
            {bad && <p className="text-xs text-red-500 mt-1">This shift must end after it starts.</p>}
            {s.filled > 0 && <p className="text-xs text-earth-500 dark:text-earth-400 mt-1">{s.filled} spot{s.filled === 1 ? '' : 's'} taken</p>}
          </fieldset>
        )
      })}
      <div className="flex items-center justify-between gap-2 text-sm">
        <button type="button" className="btn-ghost" onClick={add} disabled={shifts.length >= MAX_SHIFTS}>
          <Plus className="w-4 h-4" /> Add a shift
        </button>
        <span className="text-earth-500 dark:text-earth-400">{total} volunteer{total === 1 ? '' : 's'} in all</span>
      </div>
    </div>
  )
}
