// The event volunteer badge (#597) for the signed-in volunteer, shared by the
// on-screen badge (server/routes/school.js) and its wallet ticket (#732,
// server/routes/wallet.js), so both apply the same rules: approved, event not
// cancelled or over. The badge code is made once per sign-up.
import { query } from './db.js'
import { generateToken } from './ids.js'

export const newBadgeCode = () => generateToken().replace(/[^A-Za-z0-9]/g, '').slice(0, 12)

/** { badge } for the volunteer's sign-up to the task, or { status, error }. */
export async function loadBadge(taskId, userId) {
  const { rows } = await query(
    `SELECT s.id, s.status, s.badge_code, s.checked_in_at, s.checked_out_at, u.name,
            t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location, t.is_online, t.creator_name, t.status AS task_status,
            t.latitude, t.longitude, t.date < CURRENT_DATE - 1 AS past
       FROM public_task_signups s JOIN users u ON u.id = s.user_id JOIN public_tasks t ON t.id = s.task_id
      WHERE s.task_id = $1 AND s.user_id = $2`,
    [taskId, userId],
  )
  const b = rows[0]
  if (!b) return { status: 404, error: "You aren't signed up for this event." }
  if (b.status !== 'approved') return { status: 400, error: 'Your badge appears once the organizer approves your sign-up.' }
  if (b.task_status === 'cancelled') return { status: 400, error: 'This event was cancelled.' }
  if (b.past) return { status: 400, error: 'This event is over.' }
  let code = b.badge_code
  if (!code) {
    const { rows: set } = await query(
      'UPDATE public_task_signups SET badge_code = COALESCE(badge_code, $2) WHERE id = $1 RETURNING badge_code',
      [b.id, newBadgeCode()],
    )
    code = set[0].badge_code
  }
  const online = Boolean(b.is_online)
  return {
    badge: {
      code,
      name: b.name,
      title: b.title,
      date: b.date,
      time: b.time,
      location: online ? null : b.location,
      organizer: b.creator_name,
      checkedIn: Boolean(b.checked_in_at),
      // For the badge's "volunteering for" timer (#847): the app counts up from these.
      checkedInAt: b.checked_in_at ? new Date(b.checked_in_at).toISOString() : null,
      checkedOutAt: b.checked_out_at ? new Date(b.checked_out_at).toISOString() : null,
    },
    // Only for the wallet ticket's "near the place" reminder; never sent to the app.
    place: !online && b.latitude != null && b.longitude != null ? { latitude: Number(b.latitude), longitude: Number(b.longitude) } : null,
  }
}
