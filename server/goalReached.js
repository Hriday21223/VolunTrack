// Goal reached (#607): the first time a student's counted hours meet their
// school's requirement. The app asks (POST /api/progress/requirement-met)
// when the Dashboard sees the requirement met; the server checks the hours
// itself, so a student can't announce a goal they haven't reached.
//
// One row per student per school (requirement_completions), claimed with
// ON CONFLICT DO NOTHING: only the request that inserts it tells the parents,
// so a second device, a reload or an entry edited down and back up never
// sends anything twice.
import { query } from './db.js'
import { policyForUser } from './policy.js'
import { requirementShortfall } from './requirements.js'
import { notify } from './notifications.js'
import { sendEmail, emailFooterHtml, emailApiBase } from './email.js'
import { escapeHtml } from './html.js'
import { et, emailLang } from './emailStrings.js'

const round = (n) => Math.round((Number(n) || 0) * 100) / 100
const fmt = (n) => String(round(n)).replace(/\.0+$/, '')
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || ''

/** { met, target, hours, schoolId, schoolName } for one student, from the server's own data. */
export async function requirementStatus(userId) {
  const resolved = await policyForUser(userId)
  if (!resolved?.schoolId) return { met: false, target: null }
  const { rows } = await query(
    `SELECT COALESCE(category, '') AS category, SUM(hours)::float AS hours
       FROM logs WHERE user_id = $1 AND verification_status IS DISTINCT FROM 'rejected'
      GROUP BY COALESCE(category, '')`,
    [userId],
  )
  const byCategory = {}
  let hours = 0
  for (const r of rows) { byCategory[r.category] = r.hours; hours += r.hours }
  hours = round(hours)
  const { target, remaining } = requirementShortfall(resolved.policy, resolved.grade, hours, byCategory)
  return {
    met: target != null && remaining <= 0,
    target,
    hours,
    schoolId: resolved.schoolId,
    schoolName: resolved.schoolName || '',
  }
}

export function renderParentEmail({ lang, parentName, childName, hours, schoolName }) {
  const l = emailLang(lang)
  const child = escapeHtml(firstName(childName) || childName || '')
  const subject = et(l, '{name} reached {hours} volunteer hours 🎉', { name: firstName(childName) || childName, hours: fmt(hours) })
  const html = [
    `<p>${parentName ? et(l, 'Hi {name},', { name: escapeHtml(firstName(parentName)) }) : et(l, 'Hi there,')}</p>`,
    `<p>${et(l, '{name} has met the volunteer hour requirement at {school}, with {hours} hours logged. That took real commitment, so it might be a good moment to say well done.', {
      name: child, school: escapeHtml(schoolName), hours: fmt(hours),
    })}</p>`,
    `<p><a href="${emailApiBase()}/parent" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#2e7d32;color:#ffffff;text-decoration:none;font-weight:600">${escapeHtml(et(l, 'See their hours'))}</a></p>`,
    emailFooterHtml(l),
  ].join('')
  return { subject, html }
}

// Bell for every linked parent; email too unless they turned off our emails
// (weekly_digest_opt_out is the parent's one email switch). Never @test.com.
async function tellParents(userId, status) {
  const { rows } = await query(
    `SELECT p.id, p.name, p.email, p.language, p.weekly_digest_opt_out, c.name AS child_name
       FROM parent_child_links k
       JOIN users p ON p.id = k.parent_id
       JOIN users c ON c.id = k.child_id
      WHERE k.child_id = $1`,
    [userId],
  )
  for (const p of rows) {
    const who = firstName(p.child_name) || 'Your child'
    notify(p.id, {
      kind: 'goal_reached',
      title: `${who} reached ${fmt(status.hours)} hours 🎉`,
      body: `They met ${status.schoolName || 'their school'}'s volunteer hour requirement.`,
      link: '/parent',
    })
    if (p.weekly_digest_opt_out || !p.email || /@test\.com$/i.test(p.email)) continue
    const { subject, html } = renderParentEmail({
      lang: p.language, parentName: p.name, childName: p.child_name, hours: status.hours, schoolName: status.schoolName,
    })
    sendEmail({ to: p.email, subject, html }).catch((error) => console.error('goal reached email failed:', error.message))
  }
}

/**
 * Records the requirement as met if it is, and tells the parents the first
 * time. Returns { met, first, parents, target, hours, schoolName }; `parents`
 * is how many linked parents were told (only on the first time).
 */
export async function recordRequirementMet(userId) {
  const status = await requirementStatus(userId)
  if (!status.met) return { met: false, first: false, target: status.target, hours: status.hours ?? 0 }
  const { rowCount } = await query(
    `INSERT INTO requirement_completions (user_id, school_id, target, hours)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [userId, status.schoolId, status.target, status.hours],
  )
  const first = rowCount > 0
  let parents = 0
  if (first) {
    const { rows } = await query('SELECT COUNT(*)::int AS n FROM parent_child_links WHERE child_id = $1', [userId])
    parents = rows[0]?.n || 0
    if (parents) tellParents(userId, status).catch((error) => console.error('goal reached notify failed:', error.message))
  }
  return { met: true, first, parents, target: status.target, hours: status.hours, schoolName: status.schoolName }
}

/** How many students first met the school's requirement in the past 7 days. */
export async function completionsThisWeek(schoolId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM requirement_completions
      WHERE school_id = $1 AND reached_at >= now() - interval '7 days'`,
    [schoolId],
  )
  return rows[0]?.n || 0
}
