// Approval history for an hour entry (#638). recordLogEvent() copies the
// entry's activity, hours and date at that moment, so the history still reads
// right after later edits or a delete. Best effort: it never fails the request
// it's attached to.
import { query, hasDatabase } from './db.js'
import { uid } from './ids.js'

export const LOG_EVENTS = ['approved', 'rejected', 'reset', 'added_by_school', 'deleted']

/**
 * { logId, event, byKind: 'school'|'supervisor'|'organizer'|'student',
 *   byUserId?, byName?, note? }
 */
export async function recordLogEvent({ logId, event, byKind, byUserId = null, byName = null, note = null }) {
  if (!hasDatabase() || !logId || !LOG_EVENTS.includes(event)) return
  try {
    await query(
      `INSERT INTO log_events (id, log_id, student_id, school_id, event, by_kind, by_user_id, by_name, activity, hours, log_date, note)
       SELECT $1, l.id, l.user_id, u.school_id, $3, $4, $5, $6, l.activity, l.hours, l.date, $7
         FROM logs l JOIN users u ON u.id = l.user_id
        WHERE l.id = $2`,
      [uid('lev'), logId, event, byKind, byUserId, byName ? String(byName).slice(0, 120) : null, note ? String(note).slice(0, 500) : null],
    )
  } catch (error) {
    console.error('log history write failed:', error.message)
  }
}
