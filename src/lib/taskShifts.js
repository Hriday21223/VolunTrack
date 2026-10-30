// Shifts within an event (#589) — the browser's side of server/taskShifts.js.
import { tr } from '@/lib/i18n.js'

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** "09:00" → "9:00 AM". */
export function clockLabel(hhmm) {
  const m = TIME_RE.exec(String(hhmm || ''))
  if (!m) return String(hhmm || '')
  const h = Number(m[1])
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

/** "9:00 AM–11:00 AM". */
export const shiftTime = (s) => `${clockLabel(s?.start)}–${clockLabel(s?.end)}`

/** "Setup · 9:00 AM–11:00 AM", or just the time for an unnamed shift. */
export const shiftText = (s) => (s?.label ? `${s.label} · ${shiftTime(s)}` : shiftTime(s))

/** A shift's length in hours, to the quarter hour, or null. */
export function shiftHours(s) {
  const a = TIME_RE.exec(String(s?.start || ''))
  const b = TIME_RE.exec(String(s?.end || ''))
  if (!a || !b) return null
  const mins = (Number(b[1]) * 60 + Number(b[2])) - (Number(a[1]) * 60 + Number(a[2]))
  return mins > 0 ? Math.round((mins / 60) * 4) / 4 : null
}

/** Spots left in a shift. */
export const shiftLeft = (s) => Math.max(0, (Number(s?.slots) || 0) - (Number(s?.filled) || 0))

/** "2 spots left" / "Full". */
export function shiftLeftText(s) {
  const left = shiftLeft(s)
  if (left === 0) return tr('Full')
  return left === 1 ? tr('1 spot left') : tr('{n} spots left', { n: left })
}

// --- The organizer's form (ShiftsEditor) ---

export const MAX_SHIFTS = 8

export const addHours = (hhmm, h) => {
  const [a, b] = String(hhmm || '09:00').split(':').map(Number)
  const total = Math.min(23 * 60 + 59, (a || 0) * 60 + (b || 0) + h * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Two starter shifts, back to back from `start` (the form's time, if set). */
export function starterShifts(start) {
  const s = /^\d{2}:\d{2}$/.test(start || '') ? start : '09:00'
  return [
    { label: 'Setup', start: s, end: addHours(s, 2), slots: 2 },
    { label: '', start: addHours(s, 2), end: addHours(s, 4), slots: 2 },
  ]
}

/** A task row's shifts as the form's value. */
export function shiftsFromRow(t) {
  return Array.isArray(t?.shifts) && t.shifts.length
    ? t.shifts.map((s) => ({ id: s.id, label: s.label || '', start: s.start, end: s.end, slots: s.slots, filled: s.filled || 0 }))
    : null
}

/** The form's shifts as the API wants them. */
export function shiftsPayload(shifts) {
  if (!shifts || shifts.length === 0) return null
  return shifts.map(({ id, label, start, end, slots }) => ({ ...(id ? { id } : {}), label: String(label || '').trim(), start, end, slots: Number(slots) }))
}
