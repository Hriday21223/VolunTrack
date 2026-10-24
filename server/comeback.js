// "Come back" nudge — one friendly bell notification + email to a student who
// has gone a month without volunteering, with up to three open tasks they
// could join. Driven weekly by .github/workflows/comeback-nudges.yml through
// POST /api/comeback/internal/run (server/routes/comeback.js).
//
// Who counts as inactive: a student account at least INACTIVE_DAYS old with no
// log dated in the last INACTIVE_DAYS *and* no log created in that time (so a
// student back-filling last term's hours today isn't nagged).
//
// How often: one nudge per quiet spell. users.comeback_nudged_at is stamped by
// the claim; a student is nudged again only once INACTIVE_DAYS have passed
// since that nudge AND they logged something after it — someone who never
// comes back hears from us once, not every month forever.
//
// Skipped: comeback_opt_out, @test.com fixtures, an under-13 account still
// waiting on its parent's consent (it can't sign in), and — as with every
// organizer-facing list — tasks from a suspended organizer or one the student
// blocked.
import { SPOTS_USED_SQL } from './spots.js'
import { query } from './db.js'
import { sendEmail, emailFooterHtml, emailApiBase } from './email.js'
import { escapeHtml } from './html.js'
import { notify } from './notifications.js'
import { ensureDigestUnsubToken } from './digest.js'
import { emailLang, et } from './emailStrings.js'

export const INACTIVE_DAYS = 30
export const MAX_TASKS = 3
// Sends go out a few at a time, like announcements, so a big list neither
// hits the email provider all at once nor runs one-by-one for an hour.
export const SEND_BATCH = 5
// Ceiling on one run. Anyone left over is still eligible next week.
export const MAX_PER_RUN = 500

function frontendUrl() {
  return (process.env.FRONTEND_URL || 'https://volunteer-track-two.vercel.app').replace(/\/$/, '')
}

// The nudged_at half of eligibility, shared by the listing and the claim so
// the two can never disagree. $1 is INACTIVE_DAYS.
const NUDGE_DUE_SQL = `(
  u.comeback_nudged_at IS NULL
  OR (u.comeback_nudged_at <= now() - make_interval(days => $1)
      AND EXISTS (SELECT 1 FROM logs l2 WHERE l2.user_id = u.id AND l2.created_at > u.comeback_nudged_at))
)`

/** Students who are due a nudge right now. */
export async function findInactiveStudents({ limit = MAX_PER_RUN, only = null } = {}) {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.language
       FROM users u
      WHERE u.role = 'student'
        AND u.email IS NOT NULL AND btrim(u.email) <> ''
        AND u.email NOT ILIKE '%@test.com'
        AND (u.parental_consent_status IS NULL OR u.parental_consent_status <> 'pending')
        AND u.comeback_opt_out = false
        AND u.created_at <= now() - make_interval(days => $1)
        AND NOT EXISTS (
          SELECT 1 FROM logs l
           WHERE l.user_id = u.id
             AND (l.date >= current_date - $1::int OR l.created_at >= now() - make_interval(days => $1))
        )
        AND ${NUDGE_DUE_SQL}
        AND ($3::text[] IS NULL OR u.id = ANY($3::text[]))
      ORDER BY u.created_at ASC
      LIMIT $2`,
    [INACTIVE_DAYS, limit, only],
  )
  return rows
}

/**
 * Up to MAX_TASKS open, upcoming tasks for one student. Students have no
 * stored home location, so "near you" means near where they've volunteered
 * before: the average position of tasks they signed up for or logged hours
 * against. With no such history (or no coordinates), the soonest tasks.
 */
export async function pickTasksFor(userId) {
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

  // Haversine in km; NULL for a task without coordinates, sorted last.
  const distance = near
    ? `CASE WHEN t.latitude IS NULL OR t.longitude IS NULL THEN NULL ELSE
         6371 * 2 * asin(sqrt(
           power(sin(radians((t.latitude::float8 - $2) / 2)), 2)
           + cos(radians($2)) * cos(radians(t.latitude::float8))
             * power(sin(radians((t.longitude::float8 - $3) / 2)), 2)
         )) END`
    : 'NULL::float8'

  const { rows } = await query(
    `SELECT t.id, t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location, t.creator_name,
            ${distance} AS distance_km
       FROM public_tasks t
       JOIN users o ON o.id = t.created_by
      WHERE t.status = 'open'
        AND t.date >= current_date
        AND t.created_by <> $1
        AND o.posting_suspended_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = $1 AND b.blocked_id = t.created_by)
        AND NOT EXISTS (SELECT 1 FROM public_task_signups s WHERE s.task_id = t.id AND s.user_id = $1)
        AND ${SPOTS_USED_SQL('t.id')} < t.slots_total
      ORDER BY ${near ? 'distance_km ASC NULLS LAST, ' : ''}t.date ASC, t.created_at ASC
      LIMIT ${MAX_TASKS}`,
    near ? [userId, lat, lng] : [userId],
  )
  return { tasks: rows, near }
}

// In the student's language (users.language; NULL → English). Task titles,
// places and organizer names are shown as their authors wrote them.
export function renderComebackEmail({ name, tasks, near, unsubToken, language = null }) {
  const lang = emailLang(language)
  const t = (text, vars) => et(lang, text, vars)
  const n = tasks.length
  const subject = n === 1
    ? t(near ? 'We miss you — here is a volunteer task near you' : 'We miss you — here is a volunteer task coming up')
    : t(near ? 'We miss you — here are {n} volunteer tasks near you' : 'We miss you — here are {n} volunteer tasks coming up', { n })
  const items = tasks.map((task) => {
    const when = task.date && task.time ? t('{date} at {time}', { date: task.date, time: task.time }) : (task.date || task.time || '')
    const link = `${frontendUrl()}/opportunities?task=${encodeURIComponent(task.id)}`
    const by = task.creator_name ? ` · ${escapeHtml(task.creator_name)}` : ''
    return `<li style="margin-bottom:8px"><a href="${link}"><strong>${escapeHtml(task.title)}</strong></a><br>${escapeHtml(when)} · ${escapeHtml(task.location || '')}${by}</li>`
  }).join('')
  const intro = `It's been a little while since you logged any volunteer hours on VolunTrack. No pressure — whenever you're ready, here ${n === 1 ? 'is a task' : 'are a few tasks'} you could join${near ? ', close to where you have volunteered before' : ''}:`
  const html = [
    `<p>${name ? t('Hi {name},', { name: escapeHtml(name) }) : t('Hi there,')}</p>`,
    `<p>${t(intro)}</p>`,
    `<ul style="padding-left:18px">${items}</ul>`,
    `<p><a href="${frontendUrl()}/opportunities">${t('See all volunteer opportunities')}</a></p>`,
    `<p>${t('Already volunteering somewhere? {link} so they count.', { link: `<a href="${frontendUrl()}/log">${t('Log your hours')}</a>` })}</p>`,
    emailFooterHtml(lang),
    `<p style="font-size:12px;color:#888">${t('We send this at most once after a month without volunteering. {link} or turn them off in Settings.', {
      link: `<a href="${emailApiBase()}/api/comeback/unsubscribe/${unsubToken}">${t('Stop these emails')}</a>`,
    })}</p>`,
  ].join('')
  return { subject, html, lang }
}

// Stamps comeback_nudged_at only if the student is still due — the same
// predicate as the listing — so two overlapping runs can't both nudge them.
async function claim(userId) {
  const { rowCount } = await query(
    `UPDATE users u SET comeback_nudged_at = now()
      WHERE u.id = $2 AND u.comeback_opt_out = false AND ${NUDGE_DUE_SQL}`,
    [INACTIVE_DAYS, userId],
  )
  return rowCount === 1
}

async function nudgeOne(student, picked) {
  if (!(await claim(student.id))) return { status: 'skipped' }
  const { tasks, near } = picked
  const lang = emailLang(student.language)
  const titles = tasks.map((t) => t.title).join(', ')
  notify(student.id, {
    kind: 'comeback_nudge',
    title: et(lang, 'We miss you!'),
    body: tasks.length === 1
      ? et(lang, 'A volunteer task you could join: {titles}', { titles })
      : et(lang, '{n} volunteer tasks you could join: {titles}', { n: tasks.length, titles }),
    link: '/opportunities',
  })
  const unsubToken = await ensureDigestUnsubToken(student.id)
  const { subject, html } = renderComebackEmail({ name: student.name, tasks, near, unsubToken, language: student.language })
  const unsubscribeUrl = `${emailApiBase()}/api/comeback/unsubscribe/${unsubToken}`
  const result = await sendEmail({ to: student.email, subject, html, unsubscribeUrl }).catch(() => ({ sent: false }))
  return { status: 'nudged', emailed: result.sent === true }
}

/**
 * One run. dryRun reports who would be nudged (ids and task counts only —
 * the response lands in a GitHub Actions log, so no names or addresses).
 * `only` (student ids) narrows a run to those accounts, for a test send; the
 * eligibility rules still apply to them.
 */
export async function runComebackNudges({ dryRun = false, only = null } = {}) {
  const students = await findInactiveStudents({ only })
  const plans = []
  for (const s of students) {
    plans.push({ student: s, picked: await pickTasksFor(s.id) })
  }
  // Nothing to suggest isn't a nudge: leave them unstamped so a later run,
  // once tasks are posted, can still reach them.
  const ready = plans.filter((p) => p.picked.tasks.length > 0)
  const noTasks = plans.length - ready.length

  const summary = (p, extra = {}) => ({ id: p.student.id, tasks: p.picked.tasks.length, near: p.picked.near, ...extra })

  if (dryRun) {
    return { eligible: students.length, noTasks, wouldNudge: ready.length, students: ready.map((p) => summary(p)) }
  }

  let nudged = 0
  let emailed = 0
  let skipped = 0
  const done = []
  for (let i = 0; i < ready.length; i += SEND_BATCH) {
    const batch = ready.slice(i, i + SEND_BATCH)
    const results = await Promise.all(batch.map((p) => nudgeOne(p.student, p.picked).catch((error) => {
      console.error('comeback nudge failed:', error.message)
      return { status: 'failed' }
    })))
    results.forEach((r, j) => {
      if (r.status === 'nudged') {
        nudged += 1
        if (r.emailed) emailed += 1
        done.push(summary(batch[j], { emailed: r.emailed }))
      } else skipped += 1
    })
  }
  return { eligible: students.length, noTasks, nudged, emailed, skipped, students: done }
}
