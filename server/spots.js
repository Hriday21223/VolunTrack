// Group sign-ups (#439): a student may bring up to MAX_GUESTS guests to a task
// whose organizer allows it (public_tasks.allow_guests). A sign-up with N
// guests takes 1 + N spots, so every place that compares sign-ups with
// public_tasks.slots_total counts spots through here, never rows.
//
// Guests have no accounts: nothing about them is tracked except how many are
// coming and, optionally, their first names for the organizer's roster.

export const MAX_GUESTS = 3
export const GUEST_NAME_MAX = 40

// Only pending and approved sign-ups hold spots (waitlisted, rejected and
// parent-held ones don't — see promoteFromWaitlist in routes/school.js).
export const HOLDS_SPOT_STATUSES = ['pending', 'approved']

// The spots one sign-up row takes, as SQL over its alias.
export const SIGNUP_SPOTS_SQL = (alias) => `(1 + COALESCE(${alias}.guest_count, 0))`

// The spots taken on a task, as an int SQL expression; `taskExpr` is a column
// (t.id) or a placeholder ($1).
export const SPOTS_USED_SQL = (taskExpr) => `(SELECT COALESCE(SUM(${SIGNUP_SPOTS_SQL('su')}), 0)::int
     FROM public_task_signups su WHERE su.task_id = ${taskExpr} AND su.status IN ('pending', 'approved'))`

// Spots taken on one task, read with `db` (a pool client inside a
// transaction, or the shared query helper's shape { query }).
export async function spotsUsed(db, taskId) {
  const { rows } = await db.query(`SELECT ${SPOTS_USED_SQL('$1')} AS used`, [taskId])
  return Number(rows[0]?.used) || 0
}

// Reads { guestCount, guestNames } from a request body. Absent means no
// guests. Names are optional, first names only, at most one per guest.
export function readGuests(body) {
  const rawCount = body?.guestCount
  if (rawCount == null || rawCount === '') return { ok: true, count: 0, names: [] }
  const count = Number(rawCount)
  if (!['number', 'string'].includes(typeof rawCount) || !Number.isInteger(count) || count < 0 || count > MAX_GUESTS) {
    return { ok: false, error: `You can bring from 0 to ${MAX_GUESTS} guests.` }
  }
  const rawNames = body?.guestNames
  if (rawNames != null && !Array.isArray(rawNames)) return { ok: false, error: 'Guest names must be a list.' }
  const names = []
  for (const raw of rawNames || []) {
    if (raw == null || raw === '') continue
    if (typeof raw !== 'string') return { ok: false, error: 'Guest names must be text.' }
    const name = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!name) continue
    if (name.length > GUEST_NAME_MAX) return { ok: false, error: `Each guest name must be at most ${GUEST_NAME_MAX} characters.` }
    names.push(name)
  }
  if (names.length > count) return { ok: false, error: 'There are more guest names than guests.' }
  return { ok: true, count, names }
}

// "Only 2 spots left — not enough for your group of 4."
export function groupTooBigMessage(left, size) {
  const spots = left === 1 ? '1 spot' : `${left} spots`
  return `Only ${spots} left — not enough for your group of ${size}. Bring fewer guests, or join the waitlist together.`
}
