// Parent weekly progress digest — builds and sends a once-a-week email to each
// parent account summarising what their linked student(s) logged in the
// just-finished Monday–Sunday week. Shared by the cron endpoint
// (POST /api/parent/internal/run-weekly-digest) and the admin manual trigger
// (POST /api/parent/admin/send-weekly-digest) in server/routes/parent.js, so
// the claim/send/record sequence lives in exactly one place.
//
// Dedup is entirely ours (parent_digest_sends) — server/email.js sendEmail
// ignores any idempotency hint. Goals are client-only (no server routes), so
// this digest is hours/activity only, no goal progress.
import { query } from './db.js'
import { sendEmail, emailFooterHtml, emailApiBase } from './email.js'
import { escapeHtml } from './html.js'
import { generateToken } from './ids.js'
import { emailLang, et, emailDate } from './emailStrings.js'

// Skip a parent whose linked students logged nothing in the window — no email,
// and (deliberately) no parent_digest_sends row, so a later child-link +
// re-run still delivers that week.
export const SKIP_IF_NO_ACTIVITY = true
// Cap the per-child entry table; overflow shows as a "…and N more" line.
export const MAX_ENTRIES_PER_CHILD = 20
// A claimed-but-not-delivered row (email_ok NULL/false) is only re-attempted
// once it's this old — long enough that any concurrent run that claimed it has
// certainly finished or crashed, so a client retry (the workflow's curl
// --retry) or an overlapping admin trigger can't fire a duplicate mid-send.
const RETRY_AFTER_MS = 15 * 60 * 1000

const STATUS_LABEL = { none: 'Unverified', pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }

function frontendUrl() {
  return process.env.FRONTEND_URL || 'http://localhost:5173'
}

// pg returns NUMERIC / SUM(...) as strings — always Number() before arithmetic
// or formatting. Number() also drops trailing zeros ("12.00" -> "12", "2.50" -> "2.5").
function fmtHours(n) {
  return String(Number(n))
}

function utcDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
function isoDate(d) {
  return d.toISOString().slice(0, 10)
}
function label(d, withYear, lang = 'en') {
  return emailDate(lang, d, withYear)
}

// The window's "Oct 13" / "Oct 19, 2026" labels in the recipient's language.
function windowLabels(weekStart, lang) {
  const start = utcDay(new Date(`${weekStart}T00:00:00Z`))
  const sunday = utcDay(start)
  sunday.setUTCDate(start.getUTCDate() + 6)
  return { startLabel: label(start, false, lang), endLabel: label(sunday, true, lang) }
}

// The just-finished Mon–Sun week, as 'yyyy-MM-dd' strings. weekEnd is the
// following Monday and is EXCLUSIVE (SQL: date >= weekStart::date AND date <
// weekEnd::date). All math in UTC so it doesn't depend on the server timezone.
export function previousWeekWindow(now = new Date()) {
  const today = utcDay(now)
  const daysSinceMonday = (today.getUTCDay() + 6) % 7 // Mon->0 .. Sun->6
  const thisMonday = utcDay(today)
  thisMonday.setUTCDate(today.getUTCDate() - daysSinceMonday)
  const weekStartDate = utcDay(thisMonday)
  weekStartDate.setUTCDate(thisMonday.getUTCDate() - 7)
  return windowFromStartDate(weekStartDate)
}

// Same shape, for the admin { weekStart } override. Caller validates the
// 'yyyy-MM-dd' format first.
export function weekWindowFromStart(weekStart) {
  return windowFromStartDate(utcDay(new Date(`${weekStart}T00:00:00Z`)))
}

function windowFromStartDate(weekStartDate) {
  const weekEndDate = utcDay(weekStartDate)
  weekEndDate.setUTCDate(weekStartDate.getUTCDate() + 7)
  const sunday = utcDay(weekEndDate)
  sunday.setUTCDate(weekEndDate.getUTCDate() - 1)
  return {
    weekStart: isoDate(weekStartDate),
    weekEnd: isoDate(weekEndDate),
    startLabel: label(weekStartDate, false),
    endLabel: label(sunday, true),
  }
}

// One digest per parent: { parent, children:[{ ...per-child summary }], hasActivity }.
// Opted-out parents are excluded here and nowhere else. All dates compared in
// SQL (::date) and formatted in SQL (to_char) so a raw pg DATE is never
// JSON-serialised (which would shift the day by the server's UTC offset).
export async function buildParentDigests({ weekStart, weekEnd, parentId = null, force = false }) {
  const { rows: parents } = await query(
    `SELECT id, name, email, language FROM users
     WHERE role = 'parent' AND weekly_digest_opt_out = false
       AND ($1::text IS NULL OR id = $1)
     ORDER BY email`,
    [parentId],
  )

  const digests = []
  for (const parent of parents) {
    // Weekly batch: a cheap existence check so parents with nothing to report
    // this week don't trigger the per-child aggregate queries below. Skipped
    // when a specific parent is targeted (an admin may pass force to send a
    // digest even for an inactive week).
    if (!parentId && !force) {
      const { rows: any } = await query(
        `SELECT 1
         FROM logs l
         JOIN parent_child_links pcl ON pcl.child_id = l.user_id
         WHERE pcl.parent_id = $1 AND l.date >= $2::date AND l.date < $3::date
           AND l.created_at >= pcl.created_at
         LIMIT 1`,
        [parent.id, weekStart, weekEnd],
      )
      if (any.length === 0) {
        digests.push({
          parent: { id: parent.id, name: parent.name, email: parent.email, language: parent.language },
          children: [],
          hasActivity: false,
        })
        continue
      }
    }

    const { rows: children } = await query(
      `SELECT u.id, u.name, pcl.created_at AS linked_at
       FROM parent_child_links pcl
       JOIN users u ON u.id = pcl.child_id
       WHERE pcl.parent_id = $1
       ORDER BY u.name`,
      [parent.id],
    )

    const childSummaries = await Promise.all(children.map(async (child) => {
      const [{ rows: agg }, { rows: entryRows }, { rows: allTime }] = await Promise.all([
        query(
          `SELECT COALESCE(SUM(hours) FILTER (WHERE verification_status IS DISTINCT FROM 'rejected'), 0) AS week_hours,
                  COUNT(*)                                                              AS entry_count,
                  COALESCE(SUM(hours) FILTER (WHERE verification_status = 'approved'), 0) AS verified_hours,
                  COALESCE(SUM(hours) FILTER (WHERE verification_status = 'pending'), 0)  AS pending_hours
           FROM logs
           WHERE user_id = $1 AND date >= $2::date AND date < $3::date AND created_at >= $4`,
          [child.id, weekStart, weekEnd, child.linked_at],
        ),
        query(
          `SELECT to_char(date, 'Mon DD') AS date_label, to_char(date, 'YYYY-MM-DD') AS date_iso, activity, hours,
                  verification_status AS status
           FROM logs
           WHERE user_id = $1 AND date >= $2::date AND date < $3::date AND created_at >= $5
           ORDER BY date, created_at
           LIMIT $4`,
          [child.id, weekStart, weekEnd, MAX_ENTRIES_PER_CHILD + 1, child.linked_at],
        ),
        query(
          // "All time" for a parent means since they linked — earlier entries
          // stay private (see logReadScope in server/routes/logs.js).
          `SELECT COALESCE(SUM(hours), 0) AS all_time_hours FROM logs
            WHERE user_id = $1 AND created_at >= $2 AND verification_status IS DISTINCT FROM 'rejected'`,
          [child.id, child.linked_at],
        ),
      ])
      const a = agg[0]
      return {
        id: child.id,
        name: child.name,
        weekHours: Number(a.week_hours),
        verifiedHours: Number(a.verified_hours),
        pendingHours: Number(a.pending_hours),
        entryCount: Number(a.entry_count),
        entries: entryRows.slice(0, MAX_ENTRIES_PER_CHILD).map((e) => ({
          dateLabel: e.date_label,
          date: e.date_iso,
          activity: e.activity || null,
          hours: Number(e.hours),
          status: e.status || 'none',
        })),
        allTimeHours: Number(allTime[0].all_time_hours),
      }
    }))

    digests.push({
      parent: { id: parent.id, name: parent.name, email: parent.email, language: parent.language },
      children: childSummaries,
      hasActivity: childSummaries.some((c) => c.entryCount > 0),
    })
  }
  return digests
}

// Lazily assign a per-parent unsubscribe token on first send. Mirrors the
// retry-on-23505 loop in server/routes/parent.js POST /child-link-code.
export async function ensureDigestUnsubToken(parentId) {
  const existing = await query('SELECT digest_unsub_token FROM users WHERE id = $1', [parentId])
  if (existing.rows[0]?.digest_unsub_token) return existing.rows[0].digest_unsub_token

  for (let i = 0; i < 5; i++) {
    const token = generateToken()
    try {
      const { rows } = await query(
        `UPDATE users SET digest_unsub_token = $1
         WHERE id = $2 AND digest_unsub_token IS NULL
         RETURNING digest_unsub_token`,
        [token, parentId],
      )
      if (rows[0]?.digest_unsub_token) return rows[0].digest_unsub_token
      // Lost a race — another send set it first. Re-read and use theirs.
      const again = await query('SELECT digest_unsub_token FROM users WHERE id = $1', [parentId])
      if (again.rows[0]?.digest_unsub_token) return again.rows[0].digest_unsub_token
    } catch (error) {
      if (error.code !== '23505') throw error
      // Token collision (astronomically unlikely) — retry with a fresh one.
    }
  }
  throw new Error('Could not assign a digest unsubscribe token')
}

// Rendered in the parent's language (users.language; NULL → English). Only
// our own wording is translated — names and activity descriptions are left
// exactly as the student wrote them. `weekStart` lets the date labels follow
// the language; without it the caller's (English) labels are used as given.
export function renderDigestEmail({ parent, children, startLabel, endLabel, weekStart, unsubToken }) {
  const lang = emailLang(parent.language)
  if (weekStart && lang !== 'en') ({ startLabel, endLabel } = windowLabels(weekStart, lang))
  const t = (text, vars) => et(lang, text, vars)
  const subject = t('Weekly volunteer summary: {start} – {end}', { start: startLabel, end: endLabel })

  let body
  if (children.length === 0) {
    body = `<p>${t("You don't have any linked students yet — once you link one, this weekly summary will show their logged hours.")}</p>`
  } else {
    const intro = `<p>${t(children.length === 1
      ? "Here's what your student logged from {start} to {end}:"
      : "Here's what your students logged from {start} to {end}:", { start: escapeHtml(startLabel), end: escapeHtml(endLabel) })}</p>`
    const blocks = children.map((c) => {
      const head = `<h3 style="margin:16px 0 4px">${escapeHtml(c.name)}</h3>`
      if (c.entryCount === 0) return `${head}<p>${t('No hours logged this week.')}</p>`

      const summary = `<p>${t('{week} h this week — {verified} h approved, {pending} h pending verification.', {
        week: fmtHours(c.weekHours), verified: fmtHours(c.verifiedHours), pending: fmtHours(c.pendingHours),
      })}</p>`
      const rows = c.entries.map((e) => {
        const dateLabel = lang !== 'en' && e.date ? emailDate(lang, new Date(`${e.date}T00:00:00Z`)) : e.dateLabel
        const activity = e.activity || t('(no description)')
        return `<tr><td>${escapeHtml(dateLabel)}</td><td>${escapeHtml(activity)}</td><td>${fmtHours(e.hours)}</td><td>${t(STATUS_LABEL[e.status] || 'Unverified')}</td></tr>`
      }).join('')
      const table = `<table cellpadding="4" cellspacing="0"><tr><th align="left">${t('Date')}</th><th align="left">${t('Activity')}</th><th align="left">${t('Hours')}</th><th align="left">${t('Status')}</th></tr>${rows}</table>`
      const overflow = c.entryCount - MAX_ENTRIES_PER_CHILD
      const more = overflow > 0
        ? `<p>${overflow === 1 ? t('…and 1 more entry.') : t('…and {n} more entries.', { n: overflow })}</p>`
        : ''
      return `${head}${summary}${table}${more}<p>${t('All-time total: {n} h.', { n: fmtHours(c.allTimeHours) })}</p>`
    }).join('')
    body = `${intro}${blocks}<p><a href="${frontendUrl()}/parent">${t('View full details on your VolunTrack dashboard')}</a></p>`
  }

  const html = [
    `<p>${t('Hi {name},', { name: escapeHtml(parent.name) })}</p>`,
    body,
    emailFooterHtml(lang),
    `<p style="font-size:12px;color:#888"><a href="${emailApiBase()}/api/parent/digest/unsubscribe/${unsubToken}">${t('Unsubscribe from these weekly emails')}</a></p>`,
  ].join('')

  return { subject, html, lang }
}

// claim -> render -> send -> record for one parent.
// Returns { status: 'sent' | 'skipped' | 'failed', emailId?, error? }.
export async function deliverDigest({ digest, weekStart, startLabel, endLabel, force = false, dryRun = false }) {
  if (!digest.hasActivity && SKIP_IF_NO_ACTIVITY && !force) {
    return { status: 'skipped' }
  }

  if (dryRun) {
    const { subject, html } = renderDigestEmail({ ...digest, startLabel, endLabel, weekStart, unsubToken: 'DRYRUN'.padEnd(64, '0') })
    // Strip CR/LF from the interpolated address so a stored value can't forge
    // extra log lines (same reason server/email.js sanitises before logging).
    const safeTo = String(digest.parent.email).replace(/[\r\n]/g, '')
    console.log(`[digest dry-run] to=${safeTo} subject=${JSON.stringify(subject)}`)
    console.log(html)
    return { status: 'sent' }
  }

  // Claim the (parent, week) slot. RETURNING is empty if a row already exists.
  const claim = await query(
    `INSERT INTO parent_digest_sends (parent_id, week_start)
     VALUES ($1, $2::date)
     ON CONFLICT (parent_id, week_start) DO NOTHING
     RETURNING parent_id`,
    [digest.parent.id, weekStart],
  )
  if (claim.rowCount === 0 && !force) {
    const { rows } = await query(
      `SELECT email_ok, sent_at FROM parent_digest_sends WHERE parent_id = $1 AND week_start = $2::date`,
      [digest.parent.id, weekStart],
    )
    const row = rows[0]
    // Already delivered.
    if (row?.email_ok === true) return { status: 'skipped' }
    // Claimed recently — another run may still be mid-send. Don't risk a
    // duplicate; only re-attempt a row whose last try is old enough that the
    // other run has certainly finished or crashed.
    if (row && Date.now() - new Date(row.sent_at).getTime() < RETRY_AFTER_MS) {
      return { status: 'skipped' }
    }
    // else: a prior attempt failed or stalled long ago — fall through and retry.
  }

  const unsubToken = await ensureDigestUnsubToken(digest.parent.id)
  const { subject, html } = renderDigestEmail({ ...digest, startLabel, endLabel, weekStart, unsubToken })
  const unsubscribeUrl = `${emailApiBase()}/api/parent/digest/unsubscribe/${unsubToken}`
  const result = await sendEmail({ to: digest.parent.email, subject, html, unsubscribeUrl })

  await query(
    `UPDATE parent_digest_sends SET email_ok = $3, sent_at = now()
     WHERE parent_id = $1 AND week_start = $2::date`,
    [digest.parent.id, weekStart, result.sent === true],
  )

  return result.sent
    ? { status: 'sent', emailId: result.id }
    : { status: 'failed', error: result.error }
}

// Build + deliver for every matching parent. Both routes call this.
// `window` is a previousWeekWindow() / weekWindowFromStart() result.
export async function runWeeklyDigest({ weekStart, weekEnd, startLabel, endLabel, parentId = null, force = false, dryRun = false }) {
  const digests = await buildParentDigests({ weekStart, weekEnd, parentId, force })
  let emailsSent = 0
  let skipped = 0
  let failed = 0
  for (const digest of digests) {
    let r
    try {
      r = await deliverDigest({ digest, weekStart, startLabel, endLabel, force, dryRun })
    } catch (error) {
      // One parent's failure must not abort the batch — the others still get
      // their digest, and the failed one is retried next run (its row, if any,
      // stays email_ok != true).
      console.error(`digest delivery failed for parent ${digest.parent.id}:`, error)
      r = { status: 'failed' }
    }
    if (r.status === 'sent') emailsSent += 1
    else if (r.status === 'skipped') skipped += 1
    else failed += 1
  }
  return { emailsSent, emailsTotal: digests.length, skipped, failed }
}
