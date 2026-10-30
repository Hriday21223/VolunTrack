// Shifts within an event (#589): one volunteer task with several time slots or
// roles ("Setup 9–11", "Serving 11–1"), each with its own number of spots.
// A volunteer signs up for one shift. Everything that holds a spot — sign-up,
// the waitlist, a parent's OK, adding guests — counts against that shift's
// spots instead of the task's. The task's own slots_total is kept equal to the
// sum of its shifts, so anything that only asks "is this task full?" (alerts,
// the come-back email, lists) stays right without knowing about shifts: a task
// has room exactly when one of its shifts does.
//
// A task without shifts works as it always has (shift_id is NULL).

import { SIGNUP_SPOTS_SQL, spotsUsed } from './spots.js'
import { uid } from './ids.js'

export const MAX_SHIFTS = 8
export const SHIFT_LABEL_MAX = 60
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

const minutes = (hhmm) => {
  const m = TIME_RE.exec(hhmm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** "09:00" → "9:00 AM". */
export function clockLabel(hhmm) {
  const m = TIME_RE.exec(String(hhmm || ''))
  if (!m) return String(hhmm || '')
  const h = Number(m[1])
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

/** "Setup, 9:00 AM–11:00 AM" — for emails and bells. */
export function shiftText(shift) {
  if (!shift) return ''
  const when = `${clockLabel(shift.start_time ?? shift.start)}–${clockLabel(shift.end_time ?? shift.end)}`
  return shift.label ? `${shift.label}, ${when}` : when
}

/** A shift's length in hours, rounded to a quarter hour. */
export function shiftHours(shift) {
  const a = minutes(shift?.start_time ?? shift?.start)
  const b = minutes(shift?.end_time ?? shift?.end)
  if (a == null || b == null || b <= a) return null
  return Math.round(((b - a) / 60) * 4) / 4
}

/**
 * Reads `shifts` from a request body: absent, null or [] means no shifts.
 * Otherwise 2 to MAX_SHIFTS of { id?, label, start: 'HH:MM', end: 'HH:MM',
 * slots }. Answers { ok, shifts } (null for none) or { ok: false, error }.
 */
export function readShifts(raw) {
  if (raw == null || (Array.isArray(raw) && raw.length === 0)) return { ok: true, shifts: null }
  if (!Array.isArray(raw)) return { ok: false, error: 'Shifts must be a list.' }
  if (raw.length < 2) return { ok: false, error: 'Add at least two shifts, or turn shifts off.' }
  if (raw.length > MAX_SHIFTS) return { ok: false, error: `Up to ${MAX_SHIFTS} shifts per event.` }
  const shifts = []
  const ids = new Set()
  for (const [i, s] of raw.entries()) {
    const n = i + 1
    if (!s || typeof s !== 'object') return { ok: false, error: `Shift ${n} is incomplete.` }
    if (s.label != null && typeof s.label !== 'string') return { ok: false, error: `Shift ${n}'s name must be text.` }
    const label = String(s.label || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
    if (label.length > SHIFT_LABEL_MAX) return { ok: false, error: `Shift ${n}'s name must be at most ${SHIFT_LABEL_MAX} characters.` }
    const start = String(s.start || '')
    const end = String(s.end || '')
    if (minutes(start) == null || minutes(end) == null) return { ok: false, error: `Give shift ${n} a start and end time.` }
    if (minutes(end) <= minutes(start)) return { ok: false, error: `Shift ${n} must end after it starts.` }
    const slots = Number(s.slots)
    if (!['number', 'string'].includes(typeof s.slots) || !Number.isInteger(slots) || slots < 1 || slots > 1000) {
      return { ok: false, error: `Shift ${n} needs between 1 and 1000 volunteers.` }
    }
    const id = s.id == null || s.id === '' ? null : String(s.id)
    if (id && ids.has(id)) return { ok: false, error: 'The same shift is listed twice.' }
    if (id) ids.add(id)
    shifts.push({ id, label, start, end, slots })
  }
  const total = shifts.reduce((sum, s) => sum + s.slots, 0)
  if (total > 1000) return { ok: false, error: 'All shifts together can have at most 1000 volunteers.' }
  return { ok: true, shifts }
}

// Spots taken in one shift, as an int SQL expression over a shift id.
export const SHIFT_SPOTS_USED_SQL = (shiftExpr) => `(SELECT COALESCE(SUM(${SIGNUP_SPOTS_SQL('ss')}), 0)::int
     FROM public_task_signups ss WHERE ss.shift_id = ${shiftExpr} AND ss.status IN ('pending', 'approved'))`

// A task's shifts as a JSON array, in order, with how full each is.
export const SHIFTS_JSON_SQL = (taskExpr) => `(SELECT COALESCE(json_agg(json_build_object(
      'id', sh.id, 'label', sh.label, 'start', sh.start_time, 'end', sh.end_time, 'slots', sh.slots_total,
      'filled', ${SHIFT_SPOTS_USED_SQL('sh.id')},
      'waitlist', (SELECT COUNT(*)::int FROM public_task_signups sw WHERE sw.shift_id = sh.id AND sw.status = 'waitlisted')
    ) ORDER BY sh.position, sh.start_time), '[]'::json)
   FROM public_task_shifts sh WHERE sh.task_id = ${taskExpr})`

/** The task's shifts, in order. `db` is a pool client or { query }. */
export async function taskShifts(db, taskId) {
  const { rows } = await db.query(
    'SELECT id, label, start_time, end_time, slots_total FROM public_task_shifts WHERE task_id = $1 ORDER BY position, start_time',
    [taskId],
  )
  return rows
}

/**
 * The spots and how many are taken for one sign-up's place: its shift's, or
 * the whole task's when it has no shift. `taskSlots` is the task's
 * slots_total, already read under the task's row lock.
 */
export async function capacityFor(db, taskId, shiftId, taskSlots) {
  if (!shiftId) return { slots: Number(taskSlots) || 0, used: await spotsUsed(db, taskId) }
  const { rows } = await db.query(
    `SELECT sh.slots_total, ${SHIFT_SPOTS_USED_SQL('sh.id')} AS used FROM public_task_shifts sh WHERE sh.id = $1 AND sh.task_id = $2`,
    [shiftId, taskId],
  )
  if (!rows[0]) return { slots: 0, used: 0 }
  return { slots: Number(rows[0].slots_total) || 0, used: Number(rows[0].used) || 0 }
}

/**
 * Picks the shift a sign-up asked for. For a task with shifts one is required;
 * for one without, any shiftId is ignored. Answers { ok, shiftId } or
 * { ok: false, error, needsShift }.
 */
export async function chooseShift(db, taskId, requested) {
  const shifts = await taskShifts(db, taskId)
  if (shifts.length === 0) return { ok: true, shiftId: null, shifts }
  const id = requested == null ? '' : String(requested)
  const shift = shifts.find((s) => s.id === id)
  if (!shift) return { ok: false, error: 'Pick a shift.', needsShift: true, shifts }
  return { ok: true, shiftId: shift.id, shift, shifts }
}

/**
 * Saves a task's shifts, inside the caller's transaction (the task row is
 * already locked). `shifts` is readShifts' list, or null to turn shifts off.
 * Existing shifts are matched by id: changed in place, new ones added, missing
 * ones removed. A shift can't be removed while someone holds or waits for a
 * spot in it, and its spots can't go below what's taken. Keeps slots_total
 * and the time (the first shift's start) in step. Answers { ok } or
 * { ok: false, error }.
 */
export async function saveShifts(db, taskId, shifts) {
  const current = await taskShifts(db, taskId)
  const { rows: inUse } = await db.query(
    `SELECT shift_id, COUNT(*)::int AS people,
            COALESCE(SUM(${SIGNUP_SPOTS_SQL('s')}) FILTER (WHERE s.status IN ('pending', 'approved')), 0)::int AS used
       FROM public_task_signups s
      WHERE s.task_id = $1 AND s.shift_id IS NOT NULL AND s.status IN ('pending', 'approved', 'waitlisted', 'parent_pending')
      GROUP BY shift_id`,
    [taskId],
  )
  const usage = new Map(inUse.map((r) => [r.shift_id, r]))
  const next = shifts || []
  const keep = new Set(next.map((s) => s.id).filter(Boolean))
  for (const s of next) {
    if (s.id && !current.some((c) => c.id === s.id)) return { ok: false, error: 'One of these shifts no longer exists. Reload and try again.' }
  }
  for (const c of current) {
    if (keep.has(c.id)) continue
    if (usage.get(c.id)?.people) {
      return { ok: false, error: `People are signed up for "${shiftText(c)}". Move or remove them before deleting that shift.` }
    }
  }
  // Turning shifts on for a task people already signed up for would leave
  // them in no shift at all.
  if (current.length === 0 && next.length > 0) {
    const { rows } = await db.query(
      "SELECT 1 FROM public_task_signups WHERE task_id = $1 AND status IN ('pending', 'approved', 'waitlisted', 'parent_pending') LIMIT 1",
      [taskId],
    )
    if (rows.length) return { ok: false, error: 'People have already signed up, so shifts can only be added to a new event.' }
  }
  for (const s of next) {
    const used = s.id ? usage.get(s.id)?.used || 0 : 0
    if (s.slots < used) return { ok: false, error: `${used} spots are already taken in "${shiftText(s)}", so it needs at least ${used}.` }
  }
  for (const c of current) {
    if (!keep.has(c.id)) await db.query('DELETE FROM public_task_shifts WHERE id = $1', [c.id])
  }
  for (const [position, s] of next.entries()) {
    if (s.id) {
      await db.query(
        'UPDATE public_task_shifts SET label = $2, start_time = $3, end_time = $4, slots_total = $5, position = $6 WHERE id = $1',
        [s.id, s.label, s.start, s.end, s.slots, position],
      )
    } else {
      await db.query(
        'INSERT INTO public_task_shifts (id, task_id, label, start_time, end_time, slots_total, position) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [uid('shift'), taskId, s.label, s.start, s.end, s.slots, position],
      )
    }
  }
  if (next.length) {
    // The task's time is the first shift's start, in the same 24-hour HH:MM
    // every other task uses (calendars, reminders and lists read it that way).
    const firstStart = next.map((s) => s.start).sort()[0]
    await db.query(
      'UPDATE public_tasks SET slots_total = $2, time = $3 WHERE id = $1',
      [taskId, next.reduce((sum, s) => sum + s.slots, 0), firstStart],
    )
  }
  return { ok: true }
}
