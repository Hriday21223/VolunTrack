// Daily email budget (#775). Brevo's free plan sends about 300 emails a day;
// past that, sends fail until the next day. So each send is counted per UTC
// day, routine mail stops a little before the limit, and the last few sends are
// kept for the emails people are waiting on (sign-up and sign-in codes,
// password resets, a parent's approval). The admin gets one warning a day once
// 80% is used.
//
// Three levels: 'low' is scheduled bulk mail (digests, nudges, alerts), which
// stops at 60% so a busy sign-up day isn't spent on newsletters; 'normal'
// stops at LIMIT - RESERVE; 'high' (codes, resets, consent) may use it all.
//
// EMAIL_DAILY_LIMIT (default 300) and EMAIL_DAILY_RESERVE (default 40) can be
// raised on Render if the plan changes. With no database it never blocks.
import { query, hasDatabase } from './db.js'

const limit = () => Math.max(1, Number(process.env.EMAIL_DAILY_LIMIT) || 300)
const reserve = () => Math.min(limit() - 1, Math.max(0, Number(process.env.EMAIL_DAILY_RESERVE ?? 40) || 0))
export const warnAt = () => Math.floor(limit() * 0.8)
const bulkCap = () => Math.max(1, Math.min(limit() - reserve(), Math.floor(limit() * 0.6)))

/** The most sends allowed today for this priority. */
export function capFor(priority) {
  if (priority === 'high') return limit()
  if (priority === 'low') return bulkCap()
  return limit() - reserve()
}

let tableReady = false
async function ensureTable() {
  if (tableReady) return
  await query(`
    CREATE TABLE IF NOT EXISTS email_daily (
      day     DATE PRIMARY KEY,
      sent    INTEGER NOT NULL DEFAULT 0,
      warned  BOOLEAN NOT NULL DEFAULT false
    )
  `)
  tableReady = true
}

/**
 * Takes one send from today's budget. `priority: 'high'` may use the reserve;
 * `'low'` (bulk) stops at 60%.
 * Returns { ok, sent, warn } — `warn` is true exactly once per day, for the
 * send that crosses 80%. Fails open (ok: true) if the count can't be read, so
 * a database hiccup never stops a sign-in code.
 */
export async function takeEmailBudget(priority = 'normal') {
  if (!hasDatabase()) return { ok: true, sent: null, warn: false }
  try {
    await ensureTable()
    const cap = capFor(priority)
    const { rows } = await query(
      `INSERT INTO email_daily (day, sent) VALUES ((now() AT TIME ZONE 'UTC')::date, 1)
       ON CONFLICT (day) DO UPDATE SET sent = email_daily.sent + 1 WHERE email_daily.sent < $1
       RETURNING sent`,
      [cap],
    )
    if (!rows[0]) return { ok: false, sent: cap, warn: false }
    let warn = false
    if (rows[0].sent >= warnAt()) {
      const { rows: w } = await query(
        "UPDATE email_daily SET warned = true WHERE day = (now() AT TIME ZONE 'UTC')::date AND NOT warned RETURNING day",
      )
      warn = w.length > 0
    }
    return { ok: true, sent: rows[0].sent, warn }
  } catch (error) {
    console.error('email budget check failed:', error.message)
    return { ok: true, sent: null, warn: false }
  }
}

/** Today's count, for the admin. */
export async function emailBudgetToday() {
  if (!hasDatabase()) return null
  try {
    await ensureTable()
    const { rows } = await query("SELECT sent FROM email_daily WHERE day = (now() AT TIME ZONE 'UTC')::date")
    return { sent: rows[0]?.sent || 0, limit: limit(), reserve: reserve() }
  } catch { return null }
}

export const emailBudgetLimits = () => ({ limit: limit(), reserve: reserve(), warnAt: warnAt(), bulkCap: bulkCap() })
