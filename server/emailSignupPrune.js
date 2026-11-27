import { query } from './db.js'

// Sign-ups without an account (routes/emailSignups.js) hold a name and email,
// which the Privacy Policy says are deleted 30 days after the event. Run on
// every such sign-up and by the daily after-event job
// (POST /api/school/public-tasks/internal/run-attendance-nudges), so it
// happens even when nobody signs up for a while. Never throws.
export const EMAIL_SIGNUP_KEEP_DAYS = 30

export async function pruneEmailSignups() {
  try {
    const { rowCount } = await query(
      `DELETE FROM public_task_email_signups es USING public_tasks t
        WHERE t.id = es.task_id AND t.date < CURRENT_DATE - ${EMAIL_SIGNUP_KEEP_DAYS}`,
    )
    return rowCount || 0
  } catch (error) {
    console.error('email sign-up prune failed:', error.message)
    return 0
  }
}
