// Weekly adviser email (#527) — every Monday, each school's admins and
// co-advisers get one summary: documents waiting for their review, transfer
// requests, students behind on their hour requirement, and the hours logged
// in the past week. Driven by .github/workflows/adviser-digest.yml through
// POST /api/adviser-digest/internal/run (server/routes/adviserDigest.js).
//
// Only active schools (a free club, or a paid school) with at least one
// student. Once per adviser per week: adviser_digest_sends (user_id,
// week_start) is claimed before sending. Skips adviser_digest_opt_out and
// @test.com. Names of students are never in the email — only counts.
import { query } from './db.js'
import { sendEmail, emailFooterHtml, emailApiBase } from './email.js'
import { escapeHtml } from './html.js'
import { ensureDigestUnsubToken } from './digest.js'
import { schoolProgress } from './routes/school.js'

export const SEND_BATCH = 5

function frontendUrl() {
  const first = (process.env.FRONTEND_URL || '').split(',').map((s) => s.trim()).find(Boolean)
  return (first || 'https://volunteer-track-two.vercel.app').replace(/\/$/, '')
}

const round = (n) => Math.round((Number(n) || 0) * 10) / 10

/** Monday (UTC) of the week `now` is in, as YYYY-MM-DD. */
export function weekStart(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** Counts for one school. */
export async function schoolSummary(schoolId) {
  const [{ rows: docs }, { rows: transfers }, { rows: week }, progress] = await Promise.all([
    query(`SELECT COUNT(*)::int AS n FROM pdf_uploads WHERE school_id = $1 AND status = 'pending'`, [schoolId]),
    query(`SELECT COUNT(*)::int AS n FROM school_transfers WHERE to_school_id = $1 AND status = 'pending'`, [schoolId]),
    query(
      `SELECT COALESCE(SUM(l.hours), 0)::float AS hours, COUNT(DISTINCT l.user_id)::int AS students
         FROM logs l JOIN users u ON u.id = l.user_id
        WHERE u.school_id = $1 AND u.role = 'student'
          AND COALESCE(l.verification_status, 'none') <> 'rejected'
          AND l.created_at >= now() - interval '7 days'`,
      [schoolId],
    ),
    schoolProgress(schoolId),
  ])
  const students = progress.students
  const withGoal = students.filter((s) => s.target)
  return {
    pendingDocs: docs[0].n,
    pendingTransfers: transfers[0].n,
    weekHours: round(week[0].hours),
    weekStudents: week[0].students,
    students: students.length,
    withGoal: withGoal.length,
    behind: withGoal.filter((s) => s.remaining > 0).length,
    deadline: progress.deadline,
  }
}

export function renderAdviserEmail({ name, schoolName, summary: s, unsubToken }) {
  const site = frontendUrl()
  const todo = []
  if (s.pendingDocs) todo.push(`${s.pendingDocs} document${s.pendingDocs === 1 ? '' : 's'} waiting for your review`)
  if (s.pendingTransfers) todo.push(`${s.pendingTransfers} transfer request${s.pendingTransfers === 1 ? '' : 's'} to accept or decline`)
  const subject = todo.length
    ? `${schoolName}: ${todo[0]}${todo.length > 1 ? ' and more' : ''}`
    : `${schoolName}: your week on VolunTrack`

  const lines = [
    `<p>${name ? `Hi ${escapeHtml(name)},` : 'Hi there,'}</p>`,
    `<p>Here's ${escapeHtml(schoolName)} this week.</p>`,
    '<ul>',
    ...todo.map((t) => `<li><strong>${escapeHtml(t)}</strong></li>`),
    `<li>${s.weekStudents} student${s.weekStudents === 1 ? '' : 's'} logged ${s.weekHours} hour${s.weekHours === 1 ? '' : 's'} in the past 7 days.</li>`,
    s.withGoal
      ? `<li>${s.behind} of ${s.withGoal} student${s.withGoal === 1 ? ' is' : 's are'} still short of your hour requirement${s.deadline ? ` (due ${escapeHtml(String(s.deadline).slice(0, 10))})` : ''}.</li>`
      : '<li>You haven\'t set an hour requirement yet, so we can\'t tell who is behind. You can set one under School setup → Requirements.</li>',
    '</ul>',
  ]
  if (s.behind) lines.push('<p>You can send the students who are behind a reminder from the Students tab.</p>')
  const button = (href, label) => `<a href="${href}" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 16px;border-radius:8px;background:#2e7d32;color:#ffffff;text-decoration:none;font-weight:600">${escapeHtml(label)}</a>`
  const html = [
    ...lines,
    `<p>${button(`${site}/school/dashboard`, 'Open your dashboard')}</p>`,
    `<p style="font-size:12px;color:#888">You get this every Monday as an adviser at ${escapeHtml(schoolName)}. <a href="${emailApiBase()}/api/adviser-digest/unsubscribe/${unsubToken}">Stop these emails</a> or turn them off in Settings.</p>`,
    emailFooterHtml('en'),
  ].join('')
  return { subject, html }
}

/** Advisers to email this week, grouped by school. */
export async function findAdvisers(week, { only = null } = {}) {
  const params = [week]
  let onlyClause = ''
  if (only) {
    params.push(only)
    onlyClause = `AND u.id = ANY($${params.length})`
  }
  const { rows } = await query(
    `SELECT u.id, u.email, u.name, s.id AS school_id, s.name AS school_name
       FROM users u JOIN schools s ON s.id = u.school_id
      WHERE u.role IN ('school', 'school_staff') AND u.email IS NOT NULL
        AND NOT u.adviser_digest_opt_out
        AND LOWER(u.email) NOT LIKE '%@test.com'
        AND (s.plan = 'club' OR s.payment_status = 'paid')
        AND EXISTS (SELECT 1 FROM users st WHERE st.school_id = s.id AND st.role = 'student')
        AND NOT EXISTS (SELECT 1 FROM adviser_digest_sends d WHERE d.user_id = u.id AND d.week_start = $1)
        ${onlyClause}
      ORDER BY s.id, u.id`,
    params,
  )
  return rows
}

async function claim(userId, week) {
  const { rowCount } = await query(
    'INSERT INTO adviser_digest_sends (user_id, week_start) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [userId, week],
  )
  return rowCount === 1
}

/** One run for this week. dryRun reports counts and ids only (it lands in an Actions log). */
export async function runAdviserDigest({ dryRun = false, only = null, now = new Date() } = {}) {
  const week = weekStart(now)
  const advisers = await findAdvisers(week, { only })
  if (dryRun) return { week, wouldSend: advisers.length, advisers: advisers.map((a) => a.id) }
  const summaries = new Map()
  let sent = 0
  let emailed = 0
  let skipped = 0
  for (let i = 0; i < advisers.length; i += SEND_BATCH) {
    const batch = advisers.slice(i, i + SEND_BATCH)
    const results = await Promise.all(batch.map(async (a) => {
      try {
        if (!(await claim(a.id, week))) return { status: 'skipped' }
        if (!summaries.has(a.school_id)) summaries.set(a.school_id, schoolSummary(a.school_id))
        const summary = await summaries.get(a.school_id)
        const unsubToken = await ensureDigestUnsubToken(a.id)
        const { subject, html } = renderAdviserEmail({ name: a.name, schoolName: a.school_name, summary, unsubToken })
        const unsubscribeUrl = `${emailApiBase()}/api/adviser-digest/unsubscribe/${unsubToken}`
        const result = await sendEmail({ to: a.email, subject, html, unsubscribeUrl }).catch(() => ({ sent: false }))
        return { status: 'sent', emailed: result.sent === true }
      } catch (error) {
        console.error('adviser digest failed:', error.message)
        return { status: 'failed' }
      }
    }))
    for (const r of results) {
      if (r.status === 'sent') { sent += 1; if (r.emailed) emailed += 1 } else skipped += 1
    }
  }
  return { week, eligible: advisers.length, sent, emailed, skipped }
}
