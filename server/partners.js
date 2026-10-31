// Organization partner list (#611): the nonprofits an organization (a
// district, a network of schools) has approved, kept once for all its schools.
//
//  - Students and advisers at its schools see the list (GET /api/school/partners;
//    the contact person only for advisers).
//  - When the org turns on `organizations.partners_as_places`, the partner
//    names count as approved places at every one of its schools, on top of
//    each school's own list. withPartnerPlaces() adds them to a *resolved*
//    policy at read time and never writes them into a school's own rules, so
//    the school's requirements editor can't save them by accident.
//  - Events posted by an account whose email is a partner's contact email are
//    labelled "District partner" for that org's students (PARTNER_TASK_SQL).
import { query } from './db.js'
import { uid } from './ids.js'
import { placeKey, MAX_APPROVED_PLACES } from './requirements.js'

export const MAX_PARTNERS = 200
export const LIMITS = { name: 120, address: 200, contactName: 100, contactEmail: 200, website: 200, notes: 500, cause: 60 }
export const MAX_CAUSES = 6

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export class PartnerError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** One partner from a request body → a clean row, or a PartnerError. */
export function cleanPartner(input = {}) {
  const name = text(input.name, LIMITS.name)
  if (!name) throw new PartnerError('Give the partner a name.')
  const contactEmail = text(input.contactEmail, LIMITS.contactEmail).toLowerCase()
  if (contactEmail && !EMAIL_RE.test(contactEmail)) throw new PartnerError(`"${contactEmail}" doesn't look like an email address.`)
  let website = text(input.website, LIMITS.website)
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`
  if (website) {
    try {
      const u = new URL(website)
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error('bad')
    } catch { throw new PartnerError(`"${input.website}" isn't a website address.`) }
  }
  const causes = []
  for (const c of Array.isArray(input.causes) ? input.causes : String(input.causes || '').split(/[;|]/)) {
    const v = text(c, LIMITS.cause)
    if (v && !causes.some((x) => x.toLowerCase() === v.toLowerCase())) causes.push(v)
    if (causes.length >= MAX_CAUSES) break
  }
  return {
    name,
    address: text(input.address, LIMITS.address) || null,
    causes,
    contactName: text(input.contactName, LIMITS.contactName) || null,
    contactEmail: contactEmail || null,
    website: website || null,
    notes: text(input.notes, LIMITS.notes) || null,
  }
}

const toApi = (r, { withContact = true } = {}) => ({
  id: r.id,
  name: r.name,
  address: r.address,
  causes: r.causes || [],
  website: r.website,
  ...(withContact ? { contactName: r.contact_name, contactEmail: r.contact_email, notes: r.notes } : {}),
})

export async function listPartners(orgId, opts) {
  const { rows } = await query(
    'SELECT * FROM org_partners WHERE organization_id = $1 ORDER BY LOWER(name)',
    [orgId],
  )
  return rows.map((r) => toApi(r, opts))
}

/** Adds partners (one or an import), skipping names already on the list. */
export async function addPartners(orgId, list) {
  const clean = list.map(cleanPartner)
  const { rows: existing } = await query('SELECT name FROM org_partners WHERE organization_id = $1', [orgId])
  const have = new Set(existing.map((r) => placeKey(r.name)))
  const fresh = []
  for (const p of clean) {
    const k = placeKey(p.name)
    if (have.has(k)) continue
    have.add(k)
    fresh.push(p)
  }
  if (existing.length + fresh.length > MAX_PARTNERS) {
    throw new PartnerError(`An organization can list up to ${MAX_PARTNERS} partners.`)
  }
  for (const p of fresh) {
    await query(
      `INSERT INTO org_partners (id, organization_id, name, address, causes, contact_name, contact_email, website, notes)
       VALUES ($9, $1, $2, $3, $4, $5, $6, $7, $8)`,
      [orgId, p.name, p.address, p.causes, p.contactName, p.contactEmail, p.website, p.notes, uid('prt')],
    )
  }
  return { added: fresh.length, skipped: clean.length - fresh.length }
}

export async function updatePartner(orgId, id, input) {
  const p = cleanPartner(input)
  const { rows: clash } = await query(
    'SELECT id, name FROM org_partners WHERE organization_id = $1 AND id <> $2',
    [orgId, id],
  )
  if (clash.some((r) => placeKey(r.name) === placeKey(p.name))) throw new PartnerError('Another partner already has that name.')
  const { rowCount } = await query(
    `UPDATE org_partners SET name = $3, address = $4, causes = $5, contact_name = $6, contact_email = $7,
            website = $8, notes = $9, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [orgId, id, p.name, p.address, p.causes, p.contactName, p.contactEmail, p.website, p.notes],
  )
  if (rowCount === 0) throw new PartnerError('Partner not found.', 404)
}

export async function removePartner(orgId, id) {
  const { rowCount } = await query('DELETE FROM org_partners WHERE organization_id = $1 AND id = $2', [orgId, id])
  if (rowCount === 0) throw new PartnerError('Partner not found.', 404)
}

/** Partner names an org shares as approved places, or [] when it doesn't. */
export async function partnerPlaces(orgId) {
  if (!orgId) return []
  const { rows } = await query(
    `SELECT p.name FROM org_partners p JOIN organizations o ON o.id = p.organization_id
      WHERE p.organization_id = $1 AND o.partners_as_places = true ORDER BY LOWER(p.name)`,
    [orgId],
  )
  return rows.map((r) => r.name)
}

/**
 * A resolved policy with the org's partner names added to approvedPlaces
 * (deduped with placeKey, capped like the school's own list). Returns the
 * same object when there is nothing to add.
 */
export async function withPartnerPlaces(policy, orgId) {
  const names = await partnerPlaces(orgId)
  if (!policy || names.length === 0) return policy
  const own = policy.logRules?.approvedPlaces || []
  const seen = new Set(own.map(placeKey))
  const merged = [...own]
  for (const n of names) {
    const k = placeKey(n)
    if (!k || seen.has(k)) continue
    seen.add(k)
    merged.push(n)
  }
  return { ...policy, logRules: { ...(policy.logRules || {}), approvedPlaces: merged.slice(0, MAX_APPROVED_PLACES + MAX_PARTNERS) } }
}

// For the task list: whether the task's organizer is a partner of the
// viewer's school's organization ($1 = viewer id, t = public_tasks).
export const PARTNER_TASK_SQL = `EXISTS (
  SELECT 1 FROM org_partners p
    JOIN schools ps ON ps.organization_id = p.organization_id
    JOIN users pv ON pv.school_id = ps.id AND pv.id = $1
    JOIN users pc ON pc.id = t.created_by
   WHERE p.contact_email IS NOT NULL AND p.contact_email = LOWER(pc.email))`
