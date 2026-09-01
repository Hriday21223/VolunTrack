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
import { sendEmail, emailFooterHtml } from './email.js'
import { escapeHtml } from './html.js'
import { generateToken } from './ids.js'

// Skip a parent whose linked students logged nothing in the window — no email,
// and (deliberately) no parent_digest_sends row, so a later child-link +
// re-run still delivers that week.
export const SKIP_IF_NO_ACTIVITY = true
// Cap the per-child entry table; overflow shows as a "…and N more" line.
export const MAX_ENTRIES_PER_CHILD = 20

const STATUS_LABEL = { none: 'Unverified', pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }

function frontendUrl() {
  return process.env.FRONTEND_URL || 'http://localhost:5173'
}

// The unsubscribe route renders its own confirmation page, so the link in the
// email must be an absolute backend URL, not FRONTEND_URL. Hardcoded prod
// fallback matches the convention in server/email.js (contactLink()).
function backendUrl() {
  return process.env.PUBLIC_BACKEND_URL || 'https://voluntrack-backend-frrh.onrender.com'
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
function label(d, withYear) {
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC', ...(withYear ? { year: 'numeric' } : {}),
  })
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
export async function buildParentDigests({ weekStart, weekEnd, parentId = null }) {
  const { rows: parents } = await query(
    `SELECT id, name, email FROM users
     WHERE role = 'parent' AND weekly_digest_opt_out = false
       AND ($1::text IS NULL OR id = $1)
     ORDER BY email`,
    [parentId],
  )

  const digests = []
  for (const parent of parents) {
    const { rows: children } = await query(
      `SELECT u.id, u.name
       FROM parent_child_links pcl
       JOIN users u ON u.id = pcl.child_id
       WHERE pcl.parent_id = $1
       ORDER BY u.name`,
      [parent.id],
    )

    const childSummaries = await Promise.all(children.map(async (child) => {
      const [{ rows: agg }, { rows: entryRows }, { rows: allTime }] = await Promise.all([
        query(
          `SELECT COALESCE(SUM(hours), 0)                                               AS week_hours,
                  COUNT(*)                                                              AS entry_count,
                  COALESCE(SUM(hours) FILTER (WHERE verification_status = 'approved'), 0) AS verified_hours,
                  COALESCE(SUM(hours) FILTER (WHERE verification_status = 'pending'), 0)  AS pending_hours
           FROM logs
           WHERE user_id = $1 AND date >= $2::date AND date < $3::date`,
          [child.id, weekStart, weekEnd],
        ),
        query(
          `SELECT to_char(date, 'Mon DD') AS date_label, activity, hours,
                  verification_status AS status
           FROM logs
           WHERE user_id = $1 AND date >= $2::date AND date < $3::date
           ORDER BY date, created_at
           LIMIT $4`,
          [child.id, weekStart, weekEnd, MAX_ENTRIES_PER_CHILD + 1],
        ),
        query(
          `SELECT COALESCE(SUM(hours), 0) AS all_time_hours FROM logs WHERE user_id = $1`,
          [child.id],
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
          activity: e.activity || '(no description)',
          hours: Number(e.hours),
          status: e.status || 'none',
        })),
        allTimeHours: Number(allTime[0].all_time_hours),
      }
    }))

    digests.push({
      parent: { id: parent.id, name: parent.name, email: parent.email },
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

export function renderDigestEmail({ parent, children, startLabel, endLabel, unsubToken }) {
  const subject = `Weekly volunteer summary: ${startLabel} – ${endLabel}`

  let body
  if (children.length === 0) {
    body = `<p>You don't have any linked students yet — once you link one, this weekly summary will show their logged hours.</p>`
  } else {
    const intro = `<p>Here's what your student${children.length === 1 ? '' : 's'} logged from ${escapeHtml(startLabel)} to ${escapeHtml(endLabel)}:</p>`
    const blocks = children.map((c) => {
      const head = `<h3 style="margin:16px 0 4px">${escapeHtml(c.name)}</h3>`
      if (c.entryCount === 0) return `${head}<p>No hours logged this week.</p>`

      const summary = `<p>${fmtHours(c.weekHours)} h this week — ${fmtHours(c.verifiedHours)} h approved, ${fmtHours(c.pendingHours)} h pending verification.</p>`
      const rows = c.entries.map((e) =>
        `<tr><td>${escapeHtml(e.dateLabel)}</td><td>${escapeHtml(e.activity)}</td><td>${fmtHours(e.hours)}</td><td>${STATUS_LABEL[e.status] || 'Unverified'}</td></tr>`,
      ).join('')
      const table = `<table cellpadding="4" cellspacing="0"><tr><th align="left">Date</th><th align="left">Activity</th><th align="left">Hours</th><th align="left">Status</th></tr>${rows}</table>`
      const overflow = c.entryCount - MAX_ENTRIES_PER_CHILD
      const more = overflow > 0 ? `<p>…and ${overflow} more ${overflow === 1 ? 'entry' : 'entries'}.</p>` : ''
      return `${head}${summary}${table}${more}<p>All-time total: ${fmtHours(c.allTimeHours)} h.</p>`
    }).join('')
    body = `${intro}${blocks}<p><a href="${frontendUrl()}/parent">View full details on your VolunTrack dashboard</a></p>`
  }

  const html = [
    `<p>Hi ${escapeHtml(parent.name)},</p>`,
    body,
    emailFooterHtml(),
    `<p style="font-size:12px;color:#888"><a href="${backendUrl()}/api/parent/digest/unsubscribe/${unsubToken}">Unsubscribe from these weekly emails</a></p>`,
  ].join('')

  return { subject, html }
}

// claim -> render -> send -> record for one parent.
// Returns { status: 'sent' | 'skipped' | 'failed', emailId?, error? }.
export async function deliverDigest({ digest, weekStart, startLabel, endLabel, force = false, dryRun = false }) {
  if (!digest.hasActivity && SKIP_IF_NO_ACTIVITY && !force) {
    return { status: 'skipped' }
  }

  if (dryRun) {
    const { subject, html } = renderDigestEmail({ ...digest, startLabel, endLabel, unsubToken: 'DRYRUN'.padEnd(64, '0') })
    console.log(`[digest dry-run] to=${digest.parent.email} subject=${JSON.stringify(subject)}`)
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
      `SELECT email_ok FROM parent_digest_sends WHERE parent_id = $1 AND week_start = $2::date`,
      [digest.parent.id, weekStart],
    )
    if (rows[0]?.email_ok === true) return { status: 'skipped' }
    // else: a prior attempt is in flight or failed — fall through and retry.
  }

  const unsubToken = await ensureDigestUnsubToken(digest.parent.id)
  const { subject, html } = renderDigestEmail({ ...digest, startLabel, endLabel, unsubToken })
  const result = await sendEmail({ to: digest.parent.email, subject, html })

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
  const digests = await buildParentDigests({ weekStart, weekEnd, parentId })
  let emailsSent = 0
  let skipped = 0
  let failed = 0
  for (const digest of digests) {
    const r = await deliverDigest({ digest, weekStart, startLabel, endLabel, force, dryRun })
    if (r.status === 'sent') emailsSent += 1
    else if (r.status === 'skipped') skipped += 1
    else failed += 1
  }
  return { emailsSent, emailsTotal: digests.length, skipped, failed }
}
