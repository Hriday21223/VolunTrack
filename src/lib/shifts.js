// A student's regular weekly shifts (#571). server/routes/shifts.js.
import { format, subDays, parseISO } from 'date-fns'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function token() {
  try { return localStorage.getItem('voluntrack:auth_token') } catch { return null }
}

export async function shiftsCall(path = '', { method = 'GET', body } = {}) {
  const t = token()
  if (!t) throw new Error('Sign in to save regular shifts.')
  const res = await fetch(`${apiUrl}/shifts${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.')
  return data
}

export const hasAccount = () => Boolean(token())
export const listShifts = () => shiftsCall().then((d) => d.shifts || [])

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const LOOK_BACK_DAYS = 14

/**
 * The recent days a shift happened that still need an answer: on its weekday,
 * not before it was saved, up to today, not skipped, and with no entry that
 * day for the same activity. Newest first, at most two.
 */
export function pendingShiftDates(shift, logs, today = new Date()) {
  const created = format(parseISO(String(shift.createdAt)), 'yyyy-MM-dd')
  const todayStr = format(today, 'yyyy-MM-dd')
  const skipped = new Set(shift.skipped || [])
  const activity = String(shift.activity || '').trim().toLowerCase()
  const logged = new Set((logs || [])
    .filter((l) => String(l.activity || '').trim().toLowerCase() === activity)
    .map((l) => String(l.date).slice(0, 10)))
  const out = []
  for (let i = 0; i <= LOOK_BACK_DAYS && out.length < 2; i++) {
    const d = subDays(today, i)
    if (d.getDay() !== shift.weekday) continue
    const ds = format(d, 'yyyy-MM-dd')
    // Today counts only once the shift has ended.
    if (ds === todayStr && format(today, 'HH:mm') < shift.endTime) continue
    if (ds < created || skipped.has(ds) || logged.has(ds)) continue
    out.push(ds)
  }
  return out
}

export function shiftHours(shift) {
  const [sh, sm] = shift.startTime.split(':').map(Number)
  const [eh, em] = shift.endTime.split(':').map(Number)
  return Math.round(((eh * 60 + em) - (sh * 60 + sm)) / 15) / 4
}
