// Partner sign-off (#676): an organization sends one of its partner
// nonprofits a link (no account) listing the unconfirmed entries its schools'
// students logged at that place. The partner approves them with one typed
// signature, or sends some back with a reason. Only a SHA-256 of the token is
// kept; links last LINK_DAYS and a new one replaces the old.
import { createHash } from 'crypto'
import { query } from './db.js'
import { uid, generateToken } from './ids.js'
import { placeKey } from './requirements.js'

export const LINK_DAYS = 30
export const MAX_ENTRIES = 300

export const hashSignoffToken = (token) => createHash('sha256').update(`voluntrack-partner:${token}`).digest('hex')

export async function createSignoffLink(orgId, partnerId, userId) {
  const { rows } = await query('SELECT id, name, contact_name, contact_email FROM org_partners WHERE id = $1 AND organization_id = $2', [partnerId, orgId])
  const partner = rows[0]
  if (!partner) return null
  const token = generateToken()
  await query('DELETE FROM partner_signoff_links WHERE partner_id = $1', [partnerId])
  await query(
    `INSERT INTO partner_signoff_links (id, partner_id, organization_id, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5), $6)`,
    [uid('psl'), partnerId, orgId, hashSignoffToken(token), LINK_DAYS, userId],
  )
  return { token, partner }
}

// The link's partner, or null if unknown or expired.
export async function partnerForToken(token) {
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(String(token || ''))) return null
  const { rows } = await query(
    `SELECT p.id, p.name, p.organization_id, o.name AS org_name, k.expires_at
       FROM partner_signoff_links k
       JOIN org_partners p ON p.id = k.partner_id
       JOIN organizations o ON o.id = p.organization_id
      WHERE k.token_hash = $1 AND k.expires_at > now()`,
    [hashSignoffToken(token)],
  )
  return rows[0] || null
}

// Unconfirmed entries by the org's students that name this partner's place
// (matched like approved places: case, punctuation and a leading "The"
// ignored). Pending-consent under-13s and @test.com accounts left out.
export async function entriesForPartner(partner) {
  const key = placeKey(partner.name)
  const { rows } = await query(
    `SELECT l.id, to_char(l.date, 'YYYY-MM-DD') AS date, l.activity, l.hours::float8 AS hours, l.org_name,
            u.id AS student_id, u.name AS student_name, s.name AS school_name
       FROM logs l
       JOIN users u ON u.id = l.user_id
       JOIN schools s ON s.id = u.school_id
      WHERE s.organization_id = $1 AND u.role = 'student'
        AND l.verification_status IN ('none', 'pending') AND l.org_name IS NOT NULL
        AND (u.parental_consent_status IS NULL OR u.parental_consent_status <> 'pending')
        AND u.email NOT LIKE '%@test.com'
      ORDER BY l.date DESC, l.id
      LIMIT 2000`,
    [partner.organization_id],
  )
  return rows.filter((r) => placeKey(r.org_name) === key).slice(0, MAX_ENTRIES)
}

// "Maya P." — all a partner needs to recognize a volunteer.
export function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'Student'
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
}

// Hours each partner received from the organization's students (#696), in
// [from, to) (YYYY-MM-DD; to is exclusive). Counts only: no names. Entries
// are matched to partners like approved places; rejected ones are left out.
export async function partnerReport(orgId, from, to) {
  const { rows: partners } = await query('SELECT id, name FROM org_partners WHERE organization_id = $1 ORDER BY name', [orgId])
  const byKey = new Map(partners.map((p) => [placeKey(p.name), { id: p.id, name: p.name, hours: 0, approvedHours: 0, entries: 0, students: new Set() }]))
  const { rows } = await query(
    `SELECT l.org_name, l.hours::float8 AS hours, l.verification_status, l.user_id
       FROM logs l
       JOIN users u ON u.id = l.user_id AND u.role = 'student'
       JOIN schools s ON s.id = u.school_id AND s.organization_id = $1
      WHERE l.org_name IS NOT NULL AND l.verification_status IS DISTINCT FROM 'rejected'
        AND l.date >= $2::date AND l.date < $3::date
        AND u.email NOT LIKE '%@test.com'`,
    [orgId, from, to],
  )
  for (const r of rows) {
    const p = byKey.get(placeKey(r.org_name))
    if (!p) continue
    p.hours += Number(r.hours) || 0
    if (r.verification_status === 'approved') p.approvedHours += Number(r.hours) || 0
    p.entries += 1
    p.students.add(r.user_id)
  }
  const round = (n) => Math.round(n * 100) / 100
  const list = [...byKey.values()].map((p) => ({ id: p.id, name: p.name, hours: round(p.hours), approvedHours: round(p.approvedHours), entries: p.entries, students: p.students.size }))
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name))
  return {
    partners: list,
    totals: { hours: round(list.reduce((n, p) => n + p.hours, 0)), approvedHours: round(list.reduce((n, p) => n + p.approvedHours, 0)), entries: list.reduce((n, p) => n + p.entries, 0) },
  }
}
