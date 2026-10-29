// Monthly impact email (#573). A school or an organization adds up to five
// people (a principal, a board member) next to its impact report; on the 1st
// of each month each gets last month's numbers and the school year so far,
// counts only, with a link to the full report. Driven by
// .github/workflows/impact-emails.yml through
// POST /api/progress/internal/run-impact-emails. Each recipient has their own
// unsubscribe token; once per school or org per month (impact_report_sends).
import { randomBytes } from 'node:crypto'
import validator from 'validator'
import { query } from './db.js'
import { uid } from './ids.js'
import { impactFor } from './impact.js'
import { sendEmail, emailFooterHtml, emailApiBase, hasEmail } from './email.js'
import { escapeHtml } from './html.js'

export const MAX_RECIPIENTS = 5
const VALUE_PER_HOUR = 36.14 // Independent Sector 2026; keep in step with src/lib/impactReport.js
const isTestAddress = (email) => /@test\.com$/i.test(String(email || ''))
const column = (kind) => (kind === 'school' ? 'school_id' : 'organization_id')

export class RecipientError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

export async function listRecipients(kind, targetId) {
  const { rows } = await query(
    `SELECT id, email, created_at FROM impact_report_recipients WHERE ${column(kind)} = $1 ORDER BY created_at`,
    [targetId],
  )
  return rows.map((r) => ({ id: r.id, email: r.email, addedAt: r.created_at }))
}

export async function addRecipient(kind, targetId, email, addedBy) {
  const clean = String(email || '').trim().toLowerCase()
  if (!validator.isEmail(clean) || clean.length > 254) throw new RecipientError(400, 'Enter a valid email address.')
  const current = await listRecipients(kind, targetId)
  if (current.some((r) => r.email === clean)) throw new RecipientError(409, 'That address is already on the list.')
  if (current.length >= MAX_RECIPIENTS) throw new RecipientError(409, `You can add up to ${MAX_RECIPIENTS} people.`)
  await query(
    `INSERT INTO impact_report_recipients (id, ${column(kind)}, email, token, added_by) VALUES ($1, $2, $3, $4, $5)`,
    [uid('irr'), targetId, clean, randomBytes(32).toString('hex'), addedBy || null],
  )
  return listRecipients(kind, targetId)
}

export async function removeRecipient(kind, targetId, recipientId) {
  await query(`DELETE FROM impact_report_recipients WHERE id = $1 AND ${column(kind)} = $2`, [recipientId, targetId])
  return listRecipients(kind, targetId)
}

/** The month before `now` as { label: 'October 2026', from, to, key: '2026-10' }. */
export function lastMonth(now = new Date(), key = null) {
  const [y, m] = key ? key.split('-').map(Number) : [now.getUTCFullYear(), now.getUTCMonth()] // getUTCMonth is 0-based: this is last month, 1-based
  const year = key ? y : (m === 0 ? y - 1 : y)
  const month = key ? m : (m === 0 ? 12 : m)
  const pad = (n) => String(n).padStart(2, '0')
  const from = `${year}-${pad(month)}-01`
  const to = month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return { key: `${year}-${pad(month)}`, from, to, label }
}

const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
const num = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n)

export function impactEmailHtml({ name, kind, month, monthData, yearData, link }) {
  const stat = (big, small) => `<td style="padding:10px 12px;border:1px solid #d6e3d4;border-radius:8px;background:#f6faf5"><div style="font-size:22px;font-weight:700;color:#27542d">${escapeHtml(big)}</div><div style="font-size:12px;color:#555">${escapeHtml(small)}</div></td>`
  const causes = monthData.byCategory.slice(0, 3).map((c) => `<li>${escapeHtml(c.name)}: ${num(c.hours)} h</li>`).join('')
  return `<p style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#6c502d;margin:0">Volunteer impact · ${escapeHtml(month.label)}</p>
    <h2 style="margin:4px 0 12px;color:#214327">${escapeHtml(name)}</h2>
    ${monthData.hours > 0 ? `
    <table style="border-collapse:separate;border-spacing:6px;width:100%"><tr>
      ${stat(num(monthData.hours), 'volunteer hours')}
      ${stat(money(monthData.hours * VALUE_PER_HOUR), 'value to the community')}
      ${stat(`${monthData.activeStudents}`, monthData.activeStudents === 1 ? 'student volunteered' : 'students volunteered')}
    </tr></table>
    <p>${monthData.entries} ${monthData.entries === 1 ? 'entry was' : 'entries were'} logged${causes ? '. Top causes:' : '.'}</p>
    ${causes ? `<ul>${causes}</ul>` : ''}` : `<p>No volunteer hours were logged in ${escapeHtml(month.label)}.</p>`}
    <p><strong>School year so far:</strong> ${num(yearData.hours)} hours (${money(yearData.hours * VALUE_PER_HOUR)}) from ${yearData.activeStudents} ${yearData.activeStudents === 1 ? 'student' : 'students'}${kind === 'organization' ? ' across all schools' : ''}.</p>
    <p><a href="${link}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#2e7d32;color:#ffffff;text-decoration:none;font-weight:600">Open the full impact report</a></p>
    <p style="font-size:12px;color:#666">Value uses $${VALUE_PER_HOUR.toFixed(2)} an hour, the national value of volunteer time (Independent Sector, 2026). Totals only, never individual students. You get this because ${escapeHtml(name)} added you on VolunTrack.</p>
    ${emailFooterHtml()}`
}

async function targets() {
  const { rows } = await query(
    `SELECT DISTINCT 'school' AS kind, s.id, s.name FROM impact_report_recipients r JOIN schools s ON s.id = r.school_id
     UNION
     SELECT DISTINCT 'organization' AS kind, o.id, o.name FROM impact_report_recipients r JOIN organizations o ON o.id = r.organization_id`,
  )
  return rows
}

async function schoolIdsFor(kind, id) {
  if (kind === 'school') return [id]
  const { rows } = await query('SELECT id FROM schools WHERE organization_id = $1', [id])
  return rows.map((r) => r.id)
}

/** One run for last month (or `month`, 'YYYY-MM'). dryRun counts only. */
export async function runImpactEmails({ dryRun = false, month: monthKey = null, now = new Date() } = {}) {
  const month = lastMonth(now, monthKey)
  const list = await targets()
  const out = { month: month.key, targets: list.length, sent: 0, skipped: 0, ids: list.map((t) => t.id) }
  if (dryRun || !hasEmail()) return out
  for (const t of list) {
    const { rows: claimed } = await query(
      `INSERT INTO impact_report_sends (target_kind, target_id, month) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING RETURNING 1`,
      [t.kind, t.id, month.key],
    )
    if (!claimed[0]) { out.skipped += 1; continue }
    const ids = await schoolIdsFor(t.kind, t.id)
    const [monthData, yearData] = await Promise.all([
      impactFor(ids, 'year', now, { from: month.from, to: month.to }),
      impactFor(ids, 'year', new Date(`${month.to}T00:00:00Z`)),
    ])
    const link = `${emailApiBase()}${t.kind === 'school' ? '/school/dashboard' : '/organization/dashboard'}`
    const { rows: recipients } = await query(
      `SELECT email, token FROM impact_report_recipients WHERE ${column(t.kind)} = $1`,
      [t.id],
    )
    for (const r of recipients) {
      if (isTestAddress(r.email)) continue
      const { sent } = await sendEmail({
        to: r.email,
        subject: `${t.name}: volunteer impact for ${month.label}`,
        html: impactEmailHtml({ name: t.name, kind: t.kind, month, monthData, yearData, link }),
        unsubscribeUrl: `${emailApiBase()}/api/progress/impact-unsubscribe/${r.token}`,
      }).catch(() => ({ sent: false }))
      if (sent) out.sent += 1
    }
  }
  return out
}
