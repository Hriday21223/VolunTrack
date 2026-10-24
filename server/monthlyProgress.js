// Monthly progress email (#483) — on the 1st, a "nice work" email to every
// student who logged hours last month: what they logged, their total, and how
// far they are from their goal ("22 hours to go by May 1"). Driven by
// .github/workflows/monthly-progress.yml through
// POST /api/progress/internal/run (server/routes/progress.js).
//
// Only students who logged something last month: it's encouragement, not a
// nag — the come-back email (server/comeback.js) is the one for quiet spells,
// so the two never land on the same person for the same reason.
//
// Goal: the school's requirement for the student's grade if there is one
// (policyForUser + goalHoursFor, as the parent dashboard does), else the
// student's own primary goal, else none (the email just reports the month).
//
// Once per student per month: monthly_progress_sends (user_id, month) is
// claimed before sending. Skips monthly_progress_opt_out, @test.com, and an
// under-13 account still waiting on its parent's consent.
import { query } from './db.js'
import { sendEmail, emailFooterHtml, emailApiBase } from './email.js'
import { escapeHtml } from './html.js'
import { ensureDigestUnsubToken } from './digest.js'
import { emailLang, et } from './emailStrings.js'
import { policyForUser } from './policy.js'
import { goalHoursFor } from './requirements.js'

export const SEND_BATCH = 5
export const MAX_PER_RUN = 2000

function frontendUrl() {
  const first = (process.env.FRONTEND_URL || '').split(',').map((s) => s.trim()).find(Boolean)
  return (first || 'https://volunteer-track-two.vercel.app').replace(/\/$/, '')
}

const round = (n) => Math.round((Number(n) || 0) * 10) / 10

/** 'YYYY-MM' of the month before `now` (UTC). */
export function previousMonth(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthBounds(month) {
  const [y, m] = month.split('-').map(Number)
  const start = `${month}-01`
  const next = new Date(Date.UTC(y, m, 1))
  const end = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`
  return { start, end, y, m }
}

function monthName(month, lang) {
  const { y, m } = monthBounds(month)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { month: 'long', timeZone: 'UTC' })
}

function deadlineLabel(iso, lang) {
  if (!iso) return ''
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** Students who logged counted hours in `month`, not yet sent for it. */
export async function findStudents(month, { only = null, limit = MAX_PER_RUN } = {}) {
  const { start, end } = monthBounds(month)
  const params = [start, end, month, limit]
  let onlyClause = ''
  if (only) {
    params.push(only)
    onlyClause = `AND u.id = ANY($${params.length})`
  }
  const { rows } = await query(
    `SELECT u.id, u.email, u.name, u.language,
            SUM(l.hours) FILTER (WHERE l.date >= $1 AND l.date < $2) AS month_hours,
            COUNT(*) FILTER (WHERE l.date >= $1 AND l.date < $2)::int AS month_sessions,
            SUM(l.hours) AS total_hours
       FROM users u
       JOIN logs l ON l.user_id = u.id AND COALESCE(l.verification_status, 'none') <> 'rejected'
      WHERE u.role = 'student' AND u.email IS NOT NULL
        AND NOT u.monthly_progress_opt_out
        AND LOWER(u.email) NOT LIKE '%@test.com'
        AND (u.parental_consent_status IS NULL OR u.parental_consent_status <> 'pending')
        AND NOT EXISTS (SELECT 1 FROM monthly_progress_sends m WHERE m.user_id = u.id AND m.month = $3)
        ${onlyClause}
      GROUP BY u.id
     HAVING COUNT(*) FILTER (WHERE l.date >= $1 AND l.date < $2) > 0
      ORDER BY u.id
      LIMIT $4`,
    params,
  )
  return rows
}

/** { hours, deadline, schoolName } or null — school requirement first, then their own goal. */
export async function goalFor(userId) {
  try {
    const resolved = await policyForUser(userId)
    const hours = resolved ? goalHoursFor(resolved.policy, resolved.grade) : null
    if (hours) return { hours: Number(hours), deadline: resolved.policy?.goals?.deadline || null, schoolName: resolved.schoolName || null }
  } catch { /* fall through to their own goal */ }
  const { rows } = await query(
    `SELECT target, deadline FROM goals WHERE user_id = $1 AND target > 0
      ORDER BY is_primary DESC, target DESC LIMIT 1`,
    [userId],
  )
  return rows[0] ? { hours: Number(rows[0].target), deadline: rows[0].deadline || null, schoolName: null } : null
}

export function renderMonthlyEmail({ name, month, monthHours, sessions, totalHours, goal, unsubToken, language = null }) {
  const lang = emailLang(language)
  const t = (text, vars) => et(lang, text, vars)
  const mName = monthName(month, lang)
  const h = round(monthHours)
  const total = round(totalHours)
  const subject = t(h === 1 ? 'Your {month} volunteer hours: 1 hour' : 'Your {month} volunteer hours: {hours} hours', { month: mName, hours: h })
  const lines = [
    name ? t('Hi {name},', { name: escapeHtml(name) }) : t('Hi there,'),
    t(sessions === 1
      ? 'You logged {hours} hours of volunteering in {month}, in 1 session. Nice work!'
      : 'You logged {hours} hours of volunteering in {month}, across {n} sessions. Nice work!', { hours: h, month: mName, n: sessions }),
  ]
  if (goal?.hours) {
    const left = round(goal.hours - total)
    const due = deadlineLabel(goal.deadline, lang)
    if (left <= 0) {
      lines.push(t("You've reached your {goal}-hour goal, with {total} hours in all.", { goal: round(goal.hours), total }))
    } else {
      lines.push(t(due
        ? "That's {total} of your {goal}-hour goal: {left} hours to go by {date}."
        : "That's {total} of your {goal}-hour goal: {left} hours to go.", { total, goal: round(goal.hours), left, date: due }))
    }
  } else {
    lines.push(t('That brings you to {total} hours in all.', { total }))
  }
  const site = frontendUrl()
  const button = (href, label) => `<a href="${href}" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 16px;border-radius:8px;background:#2e7d32;color:#ffffff;text-decoration:none;font-weight:600">${escapeHtml(label)}</a>`
  const html = [
    ...lines.map((l) => `<p>${l}</p>`),
    `<p>${button(`${site}/`, t('See your progress'))}${button(`${site}/reports`, t('Share my hours'))}</p>`,
    `<p style="font-size:12px;color:#888">${t('You get this once a month after logging hours. {link} or turn it off in Settings.', {
      link: `<a href="${emailApiBase()}/api/progress/unsubscribe/${unsubToken}">${t('Stop these emails')}</a>`,
    })}</p>`,
    emailFooterHtml(lang),
  ].join('')
  return { subject, html }
}

async function claim(userId, month) {
  const { rowCount } = await query(
    'INSERT INTO monthly_progress_sends (user_id, month) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [userId, month],
  )
  return rowCount === 1
}

async function sendOne(s, month) {
  if (!(await claim(s.id, month))) return { status: 'skipped' }
  const goal = await goalFor(s.id)
  const unsubToken = await ensureDigestUnsubToken(s.id)
  const { subject, html } = renderMonthlyEmail({
    name: s.name, month, monthHours: s.month_hours, sessions: s.month_sessions, totalHours: s.total_hours, goal, unsubToken, language: s.language,
  })
  const unsubscribeUrl = `${emailApiBase()}/api/progress/unsubscribe/${unsubToken}`
  const result = await sendEmail({ to: s.email, subject, html, unsubscribeUrl }).catch(() => ({ sent: false }))
  return { status: 'sent', emailed: result.sent === true }
}

/**
 * One run for `month` (default: last month). dryRun reports counts and ids
 * only — the response lands in a GitHub Actions log.
 */
export async function runMonthlyProgress({ dryRun = false, only = null, month = previousMonth() } = {}) {
  const students = await findStudents(month, { only })
  if (dryRun) return { month, wouldSend: students.length, students: students.map((s) => s.id) }
  let sent = 0
  let emailed = 0
  let skipped = 0
  for (let i = 0; i < students.length; i += SEND_BATCH) {
    const batch = students.slice(i, i + SEND_BATCH)
    const results = await Promise.all(batch.map((s) => sendOne(s, month).catch((error) => {
      console.error('monthly progress email failed:', error.message)
      return { status: 'failed' }
    })))
    for (const r of results) {
      if (r.status === 'sent') { sent += 1; if (r.emailed) emailed += 1 } else skipped += 1
    }
  }
  return { month, eligible: students.length, sent, emailed, skipped }
}
