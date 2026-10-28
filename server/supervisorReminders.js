// Supervisor reminders (#555). When VolunTrack emailed a supervisor to confirm
// a student's hours and they haven't answered, they get a polite reminder 3
// days after the request and a last one 4 days after that (day 7), then
// nothing more: students shouldn't have to chase their supervisors, and a
// supervisor shouldn't be nagged. Driven daily by
// .github/workflows/supervisor-reminders.yml through
// POST /api/progress/internal/run-supervisor-reminders.
//
// Only delivery = 'voluntrack' requests: when the student sent the link
// themselves, the supervisor's address never came to us to remind. Requests
// older than 30 days are left alone. Each reminder is claimed on the row
// (reminders_sent) before sending, so a repeated run mails nobody twice.
// @test.com addresses are claimed but never emailed.
import { query } from './db.js'
import { sendEmail, emailFooterHtml, hasEmail } from './email.js'
import { escapeHtml } from './html.js'

export const MAX_REMINDERS = 2
export const FIRST_AFTER_DAYS = 3
export const GAP_DAYS = 4
export const GIVE_UP_DAYS = 30

function frontendUrl() {
  const first = (process.env.FRONTEND_URL || '').split(',').map((s) => s.trim()).find(Boolean)
  return (first || 'https://volunteer-track-two.vercel.app').replace(/\/$/, '')
}

const isTestAddress = (email) => /@test\.com$/i.test(String(email || ''))

export function reminderHtml({ supervisorName, studentName, hours, activity, loggedOn, verifyUrl, last }) {
  const greeting = supervisorName ? `Hi ${escapeHtml(supervisorName)},` : 'Hi,'
  return `<p>${greeting}</p>
    <p>A quick reminder: <strong>${escapeHtml(studentName)}</strong> is waiting for you to confirm <strong>${escapeHtml(String(hours))}</strong> volunteer hour(s) for “${escapeHtml(activity)}”${loggedOn ? `, logged on ${escapeHtml(loggedOn)}` : ''}.</p>
    <p>It takes a few seconds and you don’t need an account. If these hours aren’t right, you can reject them on the same page.</p>
    <p style="margin-top:24px"><a href="${verifyUrl}" style="display:inline-block;padding:10px 20px;background:#3f8344;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Review these hours</a></p>
    <p style="font-size:13px;color:#666">${last ? 'This is the last reminder we’ll send about these hours.' : 'We’ll send at most one more reminder about these hours.'}</p>
    ${emailFooterHtml()}`
}

export async function runSupervisorReminders({ dryRun = false } = {}) {
  const { rows } = await query(
    `SELECT id, token, supervisor_name, supervisor_email, student_name, activity, hours, reminders_sent,
            to_char(created_at, 'Mon FMDD, YYYY') AS logged_on
       FROM supervisor_verifications
      WHERE status = 'pending'
        AND delivery = 'voluntrack'
        AND reminders_sent < $1
        AND created_at > now() - ($2 || ' days')::interval
        AND (
          (reminders_sent = 0 AND created_at <= now() - ($3 || ' days')::interval)
          OR (reminders_sent > 0 AND last_reminded_at <= now() - ($4 || ' days')::interval)
        )
      ORDER BY created_at
      LIMIT 500`,
    [MAX_REMINDERS, String(GIVE_UP_DAYS), String(FIRST_AFTER_DAYS), String(GAP_DAYS)],
  )
  // Without an email provider nothing is claimed, so the reminders still go
  // out once one is configured.
  if (dryRun || !hasEmail()) return { due: rows.length, sent: 0, skipped: 0, ids: rows.map((r) => r.id) }

  let sent = 0
  let skipped = 0
  for (const r of rows) {
    // Claim first: only the run that moves reminders_sent from what it read
    // sends this one.
    const { rowCount } = await query(
      `UPDATE supervisor_verifications SET reminders_sent = reminders_sent + 1, last_reminded_at = now()
        WHERE id = $1 AND reminders_sent = $2 AND status = 'pending'`,
      [r.id, r.reminders_sent],
    )
    if (rowCount === 0 || isTestAddress(r.supervisor_email)) { skipped += 1; continue }
    const last = r.reminders_sent + 1 >= MAX_REMINDERS
    try {
      const { sent: ok } = await sendEmail({
        to: r.supervisor_email,
        subject: `Reminder: ${r.student_name} is waiting for you to confirm their volunteer hours`,
        html: reminderHtml({
          supervisorName: r.supervisor_name,
          studentName: r.student_name,
          hours: Number(r.hours),
          activity: r.activity,
          loggedOn: r.logged_on,
          verifyUrl: `${frontendUrl()}/verify-hours?token=${encodeURIComponent(r.token)}`,
          last,
        }),
      })
      if (ok) sent += 1
      else skipped += 1
    } catch (error) {
      console.error('supervisor reminder email failed:', error.message)
      skipped += 1
    }
  }
  return { due: rows.length, sent, skipped, ids: rows.map((r) => r.id) }
}
