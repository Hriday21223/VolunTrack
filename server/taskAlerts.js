// New opportunity alerts (#543) — once a week, a student who
// turned alerts on gets the new volunteer tasks (posted in the last 7 days)
// in the causes they picked (users.interests), nearest first to where they've
// volunteered before (the same centre comeback.js uses), else soonest. A bell
// notification and an email. Off until they turn it on (task_alerts_opt_in).
// Driven by .github/workflows/task-alerts.yml through
// POST /api/interests/internal/run-alerts (server/routes/interests.js).
//
// Same filters as every other task list: open, upcoming, not full, not their
// own, not already signed up, no blocked or suspended organizer. Once per user
// per week (task_alert_sends). @test.com get the bell only; pending-consent
// under-13s are skipped.
import { query } from './db.js'
import { sendEmail, emailFooterHtml, emailApiBase } from './email.js'
import { et, emailLang } from './emailStrings.js'
import { escapeHtml } from './html.js'
import { ensureDigestUnsubToken } from './digest.js'
import { notify } from './notifications.js'
import { SPOTS_USED_SQL } from './spots.js'
import { weekStart } from './adviserDigest.js'

const MAX_TASKS = 5

function frontendUrl() {
  const first = (process.env.FRONTEND_URL || '').split(',').map((s) => s.trim()).find(Boolean)
  return (first || 'https://volunteer-track-two.vercel.app').replace(/\/$/, '')
}

export async function findSubscribers({ only = null } = {}) {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.interests, u.language
       FROM users u
      WHERE u.role = 'student' AND u.task_alerts_opt_in
        AND cardinality(u.interests) > 0
        AND (u.parental_consent_status IS NULL OR u.parental_consent_status <> 'pending')
        AND NOT EXISTS (SELECT 1 FROM task_alert_sends a WHERE a.user_id = u.id AND a.week_start = $1)
        AND ($2::text[] IS NULL OR u.id = ANY($2::text[]))
      ORDER BY u.id`,
    [weekStart(), only],
  )
  return rows
}

export async function newTasksFor(userId, interests) {
  const { rows: centre } = await query(
    `SELECT AVG(t.latitude)::float8 AS lat, AVG(t.longitude)::float8 AS lng
       FROM public_tasks t
      WHERE t.latitude IS NOT NULL AND t.longitude IS NOT NULL
        AND t.id IN (
          SELECT s.task_id FROM public_task_signups s WHERE s.user_id = $1
          UNION
          SELECT l.task_id FROM logs l WHERE l.user_id = $1 AND l.task_id IS NOT NULL
        )`,
    [userId],
  )
  const lat = centre[0]?.lat
  const lng = centre[0]?.lng
  const near = Number.isFinite(lat) && Number.isFinite(lng)
  const distance = near
    ? `CASE WHEN t.latitude IS NULL OR t.longitude IS NULL THEN NULL ELSE
         6371 * 2 * asin(sqrt(
           power(sin(radians((t.latitude::float8 - $3) / 2)), 2)
           + cos(radians($3)) * cos(radians(t.latitude::float8))
             * power(sin(radians((t.longitude::float8 - $4) / 2)), 2)
         )) END`
    : 'NULL::float8'
  const { rows } = await query(
    `SELECT t.id, t.title, t.category, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location, t.creator_name,
            ${distance} AS distance_km
       FROM public_tasks t
       JOIN users o ON o.id = t.created_by
      WHERE t.status = 'open'
        AND t.date >= current_date
        AND t.created_at >= now() - interval '7 days'
        AND t.category = ANY($2::text[])
        AND t.created_by <> $1
        AND o.posting_suspended_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = $1 AND b.blocked_id = t.created_by)
        AND NOT EXISTS (SELECT 1 FROM public_task_signups s WHERE s.task_id = t.id AND s.user_id = $1)
        AND ${SPOTS_USED_SQL('t.id')} < t.slots_total
      ORDER BY ${near ? 'distance_km ASC NULLS LAST, ' : ''}t.date ASC
      LIMIT ${MAX_TASKS}`,
    near ? [userId, interests, lat, lng] : [userId, interests],
  )
  return rows
}

export function renderAlertEmail({ name, tasks, unsubToken, language = null }) {
  const lang = emailLang(language)
  const t = (text, vars) => et(lang, text, vars)
  const n = tasks.length
  const subject = n === 1 ? t('New volunteer opportunity: {title}', { title: tasks[0].title }) : t('{n} new volunteer opportunities for you', { n })
  const items = tasks.map((task) => {
    const link = `${frontendUrl()}/opportunities?task=${encodeURIComponent(task.id)}`
    const when = [task.date, task.time].filter(Boolean).join(` ${t('at')} `)
    return `<li style="margin-bottom:8px"><a href="${link}"><strong>${escapeHtml(task.title)}</strong></a><br>${escapeHtml(when)}${task.location ? ` · ${escapeHtml(task.location)}` : ''}${task.category ? ` · ${escapeHtml(task.category)}` : ''}</li>`
  }).join('')
  const html = [
    `<p>${name ? t('Hi {name},', { name: escapeHtml(name) }) : t('Hi there,')}</p>`,
    `<p>${n === 1 ? t('A new task was posted this week in the causes you follow:') : t('New tasks were posted this week in the causes you follow:')}</p>`,
    `<ul style="padding-left:18px">${items}</ul>`,
    `<p><a href="${frontendUrl()}/opportunities">${t('See all opportunities')}</a></p>`,
    `<p style="font-size:12px;color:#888">${t('You turned on new opportunity alerts. <a href="{link}">Stop these emails</a> or change your causes on Opportunities.', { link: `${emailApiBase()}/api/interests/alerts/unsubscribe/${unsubToken}` })}</p>`,
    emailFooterHtml(lang),
  ].join('')
  return { subject, html }
}

export async function runTaskAlerts({ dryRun = false, only = null } = {}) {
  const week = weekStart()
  const users = await findSubscribers({ only })
  const due = []
  for (const u of users) {
    const tasks = await newTasksFor(u.id, u.interests)
    if (tasks.length) due.push({ ...u, tasks })
  }
  if (dryRun) return { week, subscribers: users.length, wouldSend: due.length, users: due.map((u) => u.id) }
  let sent = 0
  let emailed = 0
  for (const u of due) {
    try {
      const { rowCount } = await query('INSERT INTO task_alert_sends (user_id, week_start) VALUES ($1, $2) ON CONFLICT DO NOTHING', [u.id, week])
      if (!rowCount) continue
      sent += 1
      await notify(u.id, {
        kind: 'task_alert',
        title: u.tasks.length === 1 ? `New: ${u.tasks[0].title}` : `${u.tasks.length} new opportunities for you`,
        body: 'In the causes you follow.',
        link: '/opportunities',
      })
      if (!u.email || /@test\.com$/i.test(u.email)) continue
      const unsubToken = await ensureDigestUnsubToken(u.id)
      const { subject, html } = renderAlertEmail({ name: u.name, tasks: u.tasks, unsubToken, language: u.language })
      const r = await sendEmail({ to: u.email, subject, html, unsubscribeUrl: `${emailApiBase()}/api/interests/alerts/unsubscribe/${unsubToken}` }).catch(() => ({ sent: false }))
      if (r.sent) emailed += 1
    } catch (error) {
      console.error('task alert failed:', error.message)
    }
  }
  return { week, subscribers: users.length, eligible: due.length, sent, emailed }
}
