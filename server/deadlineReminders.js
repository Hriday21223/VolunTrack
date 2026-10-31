// Deadline reminders (#533) — when a school's hour deadline is close and a
// student is still short of the requirement, a bell notification and an email
// about 30, 14 and 3 days before. Driven daily by
// .github/workflows/deadline-reminders.yml through
// POST /api/progress/internal/run-deadline (server/routes/progress.js).
//
// The deadline and the target come from the school's requirements
// (schoolProgress(), the same numbers the adviser sees). Each stage is sent at
// most once per student per deadline (deadline_reminder_sends), and the window
// for a stage is a range of days, so a missed cron day still catches up.
// Skips pending-consent under-13s; @test.com get the bell only. The email
// honors the monthly progress opt-out: both are "your hours progress" emails,
// and its unsubscribe link turns both off.
import { query } from './db.js'
import { sendEmail, emailFooterHtml, emailApiBase } from './email.js'
import { et, emailLang } from './emailStrings.js'
import { escapeHtml } from './html.js'
import { ensureDigestUnsubToken } from './digest.js'
import { notify } from './notifications.js'
import { schoolProgress } from './routes/school.js'

// [stage, first day of the window, last day] in days before the deadline.
export const STAGES = [[30, 28, 30], [14, 12, 14], [3, 1, 3]]

export function stageFor(daysLeft) {
  const hit = STAGES.find(([, lo, hi]) => daysLeft >= lo && daysLeft <= hi)
  return hit ? hit[0] : null
}

function daysUntil(deadline, now) {
  const d = Date.parse(`${String(deadline).slice(0, 10)}T00:00:00Z`)
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((d - today) / 86400000)
}

function frontendUrl() {
  const first = (process.env.FRONTEND_URL || '').split(',').map((s) => s.trim()).find(Boolean)
  return (first || 'https://volunteer-track-two.vercel.app').replace(/\/$/, '')
}

const fmt = (n) => String(Math.round(n * 10) / 10)

export function renderDeadlineEmail({ name, schoolName, remaining, target, days, deadline, unsubToken, language = null }) {
  const lang = emailLang(language)
  const t = (text, vars) => et(lang, text, vars)
  const due = new Date(`${String(deadline).slice(0, 10)}T00:00:00Z`).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
  const subject = t('{n} hours to go: due {date}', { n: fmt(remaining), date: due })
  const site = frontendUrl()
  const when = days === 1 ? t('tomorrow') : t('in {n} days', { n: days })
  const html = [
    `<p>${name ? t('Hi {name},', { name: escapeHtml(name) }) : t('Hi there,')}</p>`,
    `<p>${t('{school}’s volunteer hours are due on <strong>{date}</strong>, {when}. You have {done} of {target} hours, so <strong>{left} to go</strong>.', { school: escapeHtml(schoolName), date: due, when, done: fmt(target - remaining), target: fmt(target), left: fmt(remaining) })}</p>`,
    `<p>${t('Already did hours you haven’t logged? Add them now. Looking for something to do? Opportunities lists events near you.')}</p>`,
    `<p><a href="${site}/log" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 16px;border-radius:8px;background:#2e7d32;color:#ffffff;text-decoration:none;font-weight:600">${t('Log hours')}</a><a href="${site}/opportunities" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 16px;border-radius:8px;background:#ffffff;color:#2e7d32;border:1px solid #2e7d32;text-decoration:none;font-weight:600">${t('Find opportunities')}</a></p>`,
    `<p style="font-size:12px;color:#888">${t('Sent because your hours are due soon. <a href="{link}">Stop progress emails</a> or turn them off in Settings.', { link: `${emailApiBase()}/api/progress/unsubscribe/${unsubToken}` })}</p>`,
    emailFooterHtml(lang),
  ].join('')
  return { subject, html }
}

async function claim(userId, deadline, stage) {
  const { rowCount } = await query(
    'INSERT INTO deadline_reminder_sends (user_id, deadline, stage) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [userId, deadline, stage],
  )
  return rowCount === 1
}

/** One daily run. dryRun reports counts and ids only. */
export async function runDeadlineReminders({ dryRun = false, now = new Date() } = {}) {
  const { rows: schools } = await query(
    `SELECT id FROM schools WHERE plan = 'club' OR payment_status = 'paid'`,
  )
  const due = []
  for (const { id } of schools) {
    const progress = await schoolProgress(id).catch(() => null)
    if (!progress?.deadline) continue
    const days = daysUntil(progress.deadline, now)
    const stage = stageFor(days)
    if (!stage) continue
    for (const s of progress.students) {
      if (!s.target || !(s.remaining > 0) || s.consentPending) continue
      due.push({ ...s, schoolName: progress.schoolName, deadline: String(progress.deadline).slice(0, 10), days, stage })
    }
  }
  if (dryRun) return { wouldSend: due.length, students: due.map((s) => s.id) }

  let sent = 0
  let emailed = 0
  for (const s of due) {
    try {
      if (!(await claim(s.id, s.deadline, s.stage))) continue
      sent += 1
      await notify(s.id, {
        kind: 'deadline_reminder',
        title: `${fmt(s.remaining)} hours to go`,
        body: `Your hours for ${s.schoolName} are due in ${s.days} day${s.days === 1 ? '' : 's'}.`,
        link: '/log',
      })
      if (!s.email || /@test\.com$/i.test(s.email)) continue
      const { rows } = await query('SELECT monthly_progress_opt_out, language FROM users WHERE id = $1', [s.id])
      if (rows[0]?.monthly_progress_opt_out) continue
      const unsubToken = await ensureDigestUnsubToken(s.id)
      const { subject, html } = renderDeadlineEmail({ ...s, unsubToken, language: rows[0]?.language })
      const r = await sendEmail({ to: s.email, subject, html, unsubscribeUrl: `${emailApiBase()}/api/progress/unsubscribe/${unsubToken}` }).catch(() => ({ sent: false }))
      if (r.sent) emailed += 1
    } catch (error) {
      console.error('deadline reminder failed:', error.message)
    }
  }
  return { eligible: due.length, sent, emailed }
}
