import { query } from './db.js'

// Co-hosts (#440, task_cohosts): up to COHOST_MAX other Task Makers who help
// the creator run one public task. They share the day-to-day organizer work —
// sign-up decisions, waitlist, attendance, QR check-in, logging and verifying
// hours, messaging volunteers, stats/report rows — but editing, opening /
// closing, cancelling, managing co-hosts and the thank-you note stay with the
// creator. Every organizer endpoint in routes/school.js asks canManageTask()
// (or filters with MANAGED_BY_SQL) instead of comparing created_by itself.
//
// A co-host whose posting is suspended (server/routes/reports.js) is treated
// as not a co-host until the suspension is lifted.

export const COHOST_MAX = 3

// Roles that can be a co-host: the Volunteer Task Maker, the account that runs
// tasks from My Tasks (src/lib/roleAccess.js). School accounts post from their
// dashboard and have no My Tasks to co-host from; students can't post.
export const COHOST_ROLES = ['volunteer']

// The only refusal an add ever gives for the person themselves, so the form
// can't be used to learn whether an address has an account (or which kind).
export const COHOST_GENERIC_REFUSAL = "We couldn't add that person — they need a VolunTrack Task Maker account."

/**
 * SQL: does `userExpr` organize task `taskAlias` — its creator, or an active
 * co-host? Expressions only (an alias and a $n placeholder), never user input.
 */
export const MANAGED_BY_SQL = (taskAlias, userExpr) => `(${taskAlias}.created_by = ${userExpr}
  OR EXISTS (SELECT 1 FROM task_cohosts tc_c JOIN users tc_u ON tc_u.id = tc_c.user_id
              WHERE tc_c.task_id = ${taskAlias}.id AND tc_c.user_id = ${userExpr}
                AND tc_u.posting_suspended_at IS NULL))`

/**
 * May `userId` act as an organizer of task `taskId`?
 * creatorOnly: only the task's creator passes (edit, cancel, co-hosts, thanks).
 * @returns {Promise<{ found: boolean, allowed: boolean, isCreator: boolean, isCohost: boolean, createdBy: string|null }>}
 */
export async function canManageTask(taskId, userId, { creatorOnly = false } = {}) {
  const { rows } = await query(
    `SELECT t.created_by,
            EXISTS (SELECT 1 FROM task_cohosts c JOIN users u ON u.id = c.user_id
                     WHERE c.task_id = t.id AND c.user_id = $2 AND u.posting_suspended_at IS NULL) AS is_cohost
       FROM public_tasks t WHERE t.id = $1`,
    [String(taskId), String(userId)],
  )
  const row = rows[0]
  if (!row) return { found: false, allowed: false, isCreator: false, isCohost: false, createdBy: null }
  const isCreator = row.created_by === userId
  const isCohost = !isCreator && row.is_cohost
  return { found: true, allowed: isCreator || (!creatorOnly && isCohost), isCreator, isCohost, createdBy: row.created_by }
}

/**
 * Sends the 404/403 for a refused canManageTask() result and returns true, or
 * returns false when the caller may go on.
 */
export function refuseTaskAccess(res, access, forbidden) {
  if (!access.found) { res.status(404).json({ error: 'Task not found.' }); return true }
  if (!access.allowed) { res.status(403).json({ error: forbidden }); return true }
  return false
}
