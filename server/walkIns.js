// Walk-ins (#765): someone who didn't sign up scans the event's QR code and
// joins on the spot. They're added as an approved volunteer and then check in
// like everyone else (the 4-digit code from the organizer's screen proves
// they're there), so their hours go to the organizer to sign.
//
// Only for the simple case. Anything the sign-up form has to ask first sends
// them to the organizer instead: a waiver, shifts, a minimum age, a parent who
// must come along (K–5), an under-13 account (a parent approves their events),
// a blocked or suspended organizer, or a full event. The organizer can turn
// walk-ins off per event (public_tasks.allow_walkins).
import { getPool } from './db.js'
import { uid } from './ids.js'
import { SPOTS_USED_SQL } from './spots.js'
import { isYoungGrade } from './requirements.js'

const ASK = 'Ask the organizer to add you.'

/**
 * Adds `userId` to `taskId` as an approved walk-in when allowed. Returns
 * { ok: true } or { ok: false, error }. With `dryRun` it only checks.
 */
export async function joinAsWalkIn(taskId, userId, { dryRun = false } = {}) {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT t.id, t.status, t.slots_total, t.created_by, t.allow_walkins, t.min_age, t.young_need_parent, t.waiver_text,
              EXISTS (SELECT 1 FROM public_task_shifts sh WHERE sh.task_id = t.id) AS has_shifts,
              EXISTS (SELECT 1 FROM task_cohosts c WHERE c.task_id = t.id AND c.user_id = $2) AS is_cohost,
              (SELECT posting_suspended_at IS NOT NULL FROM users WHERE id = t.created_by) AS host_suspended,
              EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = $2 AND b.blocked_id = t.created_by) AS host_blocked
         FROM public_tasks t WHERE t.id = $1 FOR UPDATE`,
      [taskId, userId],
    )
    const t = rows[0]
    const refuse = async (error) => { await client.query('ROLLBACK'); return { ok: false, error } }
    if (!t || t.status === 'cancelled') return refuse('This event isn’t taking walk-ins.')
    if (t.created_by === userId || t.is_cohost) return refuse('You’re running this event, so you don’t check in to it.')
    if (!t.allow_walkins) return refuse(`This event doesn’t take walk-ins. ${ASK}`)
    if (t.host_suspended || t.host_blocked) return refuse('This event isn’t available.')
    if (t.waiver_text) return refuse(`This event needs a signed waiver first. ${ASK}`)
    if (t.has_shifts) return refuse(`This event has shifts to pick from. ${ASK}`)
    if (t.min_age != null) return refuse(`This event has an age limit. ${ASK}`)
    const { rows: who } = await client.query('SELECT role, grade, under_13, parental_consent_status FROM users WHERE id = $1', [userId])
    const u = who[0]
    if (!u || !['student', 'volunteer'].includes(u.role)) return refuse('Only students and volunteers can join as walk-ins.')
    if (u.under_13 || u.parental_consent_status === 'pending') return refuse(`A parent needs to approve your events first. ${ASK}`)
    if (t.young_need_parent && u.role === 'student' && isYoungGrade(u.grade)) return refuse(`A parent or guardian has to come with you to this event. ${ASK}`)
    const { rows: mine } = await client.query('SELECT id, status FROM public_task_signups WHERE task_id = $1 AND user_id = $2', [taskId, userId])
    const existing = mine[0]
    if (existing && ['rejected', 'parent_pending', 'parent_declined'].includes(existing.status)) return refuse(ASK)
    // Already approved: nothing to join, they just check in.
    if (existing && existing.status === 'approved') { await client.query('ROLLBACK'); return { ok: true, alreadyApproved: true } }
    const { rows: used } = await client.query(`SELECT ${SPOTS_USED_SQL('$1')} AS n`, [taskId])
    // A pending sign-up already holds its spot; a waitlisted one doesn't.
    const holdsSpot = existing && existing.status === 'pending'
    if (!holdsSpot && used[0].n >= t.slots_total) return refuse(`This event is full. ${ASK}`)
    if (dryRun) { await client.query('ROLLBACK'); return { ok: true } }
    if (existing) {
      await client.query("UPDATE public_task_signups SET status = 'approved', walk_in = true WHERE id = $1", [existing.id])
    } else {
      await client.query(
        "INSERT INTO public_task_signups (id, task_id, user_id, status, walk_in) VALUES ($1, $2, $3, 'approved', true)",
        [uid('psig'), taskId, userId],
      )
    }
    await client.query('COMMIT')
    return { ok: true }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
