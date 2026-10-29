// Tenant-defined requirements: schools and organizations describe how they want
// hours logged, and who may sign in. See server/requirements.js for the policy
// shape and server/policy.js for the lookups.

import express from 'express'
import { createHash, randomBytes } from 'node:crypto'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { uid } from '../ids.js'
import { recordAudit, AUDIT } from '../audit.js'
import { normalizePolicy, goalHoursFor, SECTIONS, isSignaturePng } from '../requirements.js'
import { policyForUser, policyForSchool } from '../policy.js'

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// A PUT body carries every section. A section sent as null is an explicit
// "inherit", which is stored as the key being absent — the two have to stay
// distinguishable, or a school could never go back to following its org.
function policyFromBody(body) {
  const submitted = {}
  for (const section of SECTIONS) {
    if (body[section] === undefined || body[section] === null) continue
    submitted[section] = body[section]
  }
  return normalizePolicy(submitted)
}

// ---------------------------------------------------------------------------
// The student's view: what do I have to do?
// ---------------------------------------------------------------------------

// Read-only, and only ever about the caller's own tenant. The Log Hours form
// calls this on mount; an unlinked account gets the permissive defaults, which
// is exactly how the form behaved before any of this existed.
router.get('/mine', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const resolved = await policyForUser(req.auth.sub)
    if (!resolved) return res.status(404).json({ error: 'Account not found.' })
    return res.json({
      policy: resolved.policy,
      sources: resolved.sources,
      schoolName: resolved.schoolName,
      organizationName: resolved.orgName,
      // Resolved server-side because the grade it depends on lives on the user
      // row, which the client does not necessarily have fresh.
      goalHours: goalHoursFor(resolved.policy, resolved.grade),
      grade: resolved.grade,
    })
  } catch (error) {
    console.error('requirements lookup failed:', error)
    return res.status(500).json({ error: 'Could not load your school requirements.' })
  }
})

// ---------------------------------------------------------------------------
// School
// ---------------------------------------------------------------------------

async function callerSchoolId(req) {
  const { rows } = await query('SELECT school_id FROM users WHERE id = $1', [req.auth.sub])
  return rows[0]?.school_id || null
}

// Staff may read the rules they enforce; only the school admin may change them,
// matching how SSO, storage and staff management are already gated.
router.get('/school', limiter, requireDb, requireAuth('school', 'school_staff'), async (req, res) => {
  try {
    const schoolId = await callerSchoolId(req)
    if (!schoolId) return res.status(404).json({ error: 'School not found.' })
    const resolved = await policyForSchool(schoolId)
    if (!resolved) return res.status(404).json({ error: 'School not found.' })
    return res.json(resolved)
  } catch (error) {
    console.error('school requirements lookup failed:', error)
    return res.status(500).json({ error: 'Could not load requirements.' })
  }
})

router.put('/school', limiter, requireDb, requireAuth('school'), async (req, res) => {
  try {
    const schoolId = await callerSchoolId(req)
    if (!schoolId) return res.status(404).json({ error: 'School not found.' })
    const policy = policyFromBody(req.body || {})
    await query('UPDATE schools SET requirements = $1 WHERE id = $2', [JSON.stringify(policy), schoolId])

    // Worth a trail: these rules decide whose hours count, so "when did this
    // stop accepting entries without proof?" needs an answer that isn't the
    // current value of the column.
    recordAudit(req, {
      action: AUDIT.REQUIREMENTS_CHANGED,
      schoolId,
      objectType: 'school',
      objectId: schoolId,
      meta: { sections: Object.keys(policy).filter((k) => k !== 'version') },
    })

    const resolved = await policyForSchool(schoolId)
    return res.json(resolved)
  } catch (error) {
    console.error('school requirements save failed:', error)
    return res.status(500).json({ error: 'Could not save requirements.' })
  }
})

// ---------------------------------------------------------------------------
// Organization defaults
// ---------------------------------------------------------------------------

async function callerOrgId(req) {
  const { rows } = await query('SELECT organization_id FROM users WHERE id = $1', [req.auth.sub])
  return rows[0]?.organization_id || null
}

router.get('/organization', limiter, requireDb, requireAuth('org'), async (req, res) => {
  try {
    const organizationId = await callerOrgId(req)
    if (!organizationId) return res.status(404).json({ error: 'Organization not found.' })
    const { rows } = await query(
      `SELECT o.name, o.requirements,
              (SELECT COUNT(*) FROM schools WHERE organization_id = o.id) AS school_count,
              (SELECT COUNT(*) FROM schools
                WHERE organization_id = o.id AND requirements IS NOT NULL) AS overriding_count
         FROM organizations o WHERE o.id = $1`,
      [organizationId],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Organization not found.' })
    return res.json({
      organizationName: rows[0].name,
      own: normalizePolicy(rows[0].requirements),
      schoolCount: Number(rows[0].school_count) || 0,
      // An org admin should know their defaults do not reach every school —
      // a school that overrode a section keeps its own.
      overridingSchoolCount: Number(rows[0].overriding_count) || 0,
    })
  } catch (error) {
    console.error('org requirements lookup failed:', error)
    return res.status(500).json({ error: 'Could not load requirements.' })
  }
})

router.put('/organization', limiter, requireDb, requireAuth('org'), async (req, res) => {
  try {
    const organizationId = await callerOrgId(req)
    if (!organizationId) return res.status(404).json({ error: 'Organization not found.' })
    const policy = policyFromBody(req.body || {})
    await query('UPDATE organizations SET requirements = $1 WHERE id = $2', [JSON.stringify(policy), organizationId])

    recordAudit(req, {
      action: AUDIT.REQUIREMENTS_CHANGED,
      organizationId,
      objectType: 'organization',
      objectId: organizationId,
      meta: { sections: Object.keys(policy).filter((k) => k !== 'version') },
    })

    return res.json({ own: policy })
  } catch (error) {
    console.error('org requirements save failed:', error)
    return res.status(500).json({ error: 'Could not save requirements.' })
  }
})

// ---------------------------------------------------------------------------
// Requirement templates (#577): an organization's named rule sets, like
// "Middle schools" and "High schools". A school assigned to one follows it for
// any section it hasn't set itself, ahead of the org's defaults.
// ---------------------------------------------------------------------------

const MAX_TEMPLATES = 10

async function ownTemplate(orgId, id) {
  const { rows } = await query('SELECT id, name, requirements FROM requirement_templates WHERE id = $1 AND organization_id = $2', [id, orgId])
  return rows[0] || null
}

router.get('/organization/templates', limiter, requireDb, requireAuth('org'), async (req, res) => {
  try {
    const orgId = await callerOrgId(req)
    if (!orgId) return res.status(404).json({ error: 'Organization not found.' })
    const { rows } = await query(
      `SELECT t.id, t.name, (SELECT COUNT(*)::int FROM schools s WHERE s.requirement_template_id = t.id) AS school_count
         FROM requirement_templates t WHERE t.organization_id = $1 ORDER BY t.created_at`,
      [orgId],
    )
    return res.json({ templates: rows.map((r) => ({ id: r.id, name: r.name, schoolCount: r.school_count })) })
  } catch (error) {
    console.error('templates list failed:', error)
    return res.status(500).json({ error: 'Could not load templates.' })
  }
})

router.post('/organization/templates', limiter, requireDb, requireAuth('org'), async (req, res) => {
  const name = String(req.body?.name || '').trim()
  if (!name || name.length > 60) return res.status(400).json({ error: 'Name the template (up to 60 characters).' })
  try {
    const orgId = await callerOrgId(req)
    if (!orgId) return res.status(404).json({ error: 'Organization not found.' })
    const { rows: count } = await query('SELECT COUNT(*)::int AS n FROM requirement_templates WHERE organization_id = $1', [orgId])
    if (count[0].n >= MAX_TEMPLATES) return res.status(409).json({ error: `You can have up to ${MAX_TEMPLATES} templates.` })
    const id = uid('rtpl')
    await query('INSERT INTO requirement_templates (id, organization_id, name) VALUES ($1, $2, $3)', [id, orgId, name])
    return res.status(201).json({ template: { id, name, schoolCount: 0 } })
  } catch (error) {
    console.error('template create failed:', error)
    return res.status(500).json({ error: 'Could not create the template.' })
  }
})

// Same shape as GET /organization, so the editor treats a template like the
// org's defaults.
router.get('/organization/templates/:id', limiter, requireDb, requireAuth('org'), async (req, res) => {
  try {
    const orgId = await callerOrgId(req)
    const t = orgId && await ownTemplate(orgId, req.params.id)
    if (!t) return res.status(404).json({ error: 'Template not found.' })
    return res.json({ templateName: t.name, own: normalizePolicy(t.requirements) })
  } catch (error) {
    console.error('template read failed:', error)
    return res.status(500).json({ error: 'Could not load the template.' })
  }
})

router.put('/organization/templates/:id', limiter, requireDb, requireAuth('org'), async (req, res) => {
  try {
    const orgId = await callerOrgId(req)
    const t = orgId && await ownTemplate(orgId, req.params.id)
    if (!t) return res.status(404).json({ error: 'Template not found.' })
    const policy = policyFromBody(req.body || {})
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim().slice(0, 60) : t.name
    await query('UPDATE requirement_templates SET requirements = $1, name = $2 WHERE id = $3', [JSON.stringify(policy), name, t.id])
    recordAudit(req, {
      action: AUDIT.REQUIREMENTS_CHANGED,
      organizationId: orgId,
      objectType: 'requirement_template',
      objectId: t.id,
      meta: { sections: Object.keys(policy).filter((k) => k !== 'version') },
    })
    return res.json({ own: policy, templateName: name })
  } catch (error) {
    console.error('template save failed:', error)
    return res.status(500).json({ error: 'Could not save the template.' })
  }
})

// Deleting one sends its schools back to the org's defaults (ON DELETE SET NULL).
router.delete('/organization/templates/:id', limiter, requireDb, requireAuth('org'), async (req, res) => {
  try {
    const orgId = await callerOrgId(req)
    const { rowCount } = await query('DELETE FROM requirement_templates WHERE id = $1 AND organization_id = $2', [req.params.id, orgId])
    if (rowCount === 0) return res.status(404).json({ error: 'Template not found.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('template delete failed:', error)
    return res.status(500).json({ error: 'Could not delete the template.' })
  }
})

// PUT /organization/schools/:schoolId/template { templateId | null }
router.put('/organization/schools/:schoolId/template', limiter, requireDb, requireAuth('org'), async (req, res) => {
  try {
    const orgId = await callerOrgId(req)
    if (!orgId) return res.status(404).json({ error: 'Organization not found.' })
    const templateId = req.body?.templateId || null
    if (templateId && !(await ownTemplate(orgId, templateId))) return res.status(404).json({ error: 'Template not found.' })
    const { rowCount } = await query(
      'UPDATE schools SET requirement_template_id = $1 WHERE id = $2 AND organization_id = $3',
      [templateId, req.params.schoolId, orgId],
    )
    if (rowCount === 0) return res.status(404).json({ error: 'School not found.' })
    recordAudit(req, { action: AUDIT.REQUIREMENTS_CHANGED, organizationId: orgId, schoolId: req.params.schoolId, objectType: 'school', objectId: req.params.schoolId, meta: { template: templateId } })
    return res.json({ ok: true })
  } catch (error) {
    console.error('template assign failed:', error)
    return res.status(500).json({ error: 'Could not change the school’s template.' })
  }
})

// ---------------------------------------------------------------------------
// Signing a certificate on a phone (#548)
//
// Drawing a signature with a mouse is awkward, so the Certificates settings
// show a QR code for a one-time link. Whoever signs (often the principal)
// opens it on their phone, draws with a finger, and the settings page polls
// for the result. Nothing is saved to the policy until the admin presses
// Save, so a stray signature on a leaked link changes nothing by itself.
// ---------------------------------------------------------------------------

const SIGN_LINK_MINUTES = 15
const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex')

const signLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

router.post('/certificate-sign', limiter, requireDb, requireAuth('school', 'org'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT COALESCE(s.name, o.name) AS tenant_name
         FROM users u
         LEFT JOIN schools s ON s.id = u.school_id AND u.role = 'school'
         LEFT JOIN organizations o ON o.id = u.organization_id AND u.role = 'org'
        WHERE u.id = $1`,
      [req.auth.sub],
    )
    await query(`DELETE FROM certificate_sign_requests WHERE created_by = $1 OR expires_at < now() - interval '1 day'`, [req.auth.sub])
    const token = randomBytes(24).toString('base64url')
    const signerName = typeof req.body?.signerName === 'string' ? req.body.signerName.trim().slice(0, 80) : ''
    const { rows: created } = await query(
      `INSERT INTO certificate_sign_requests (token_hash, created_by, signer_name, tenant_name, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval)
       RETURNING expires_at`,
      [hashToken(token), req.auth.sub, signerName || null, rows[0]?.tenant_name || null, String(SIGN_LINK_MINUTES)],
    )
    return res.json({ token, expiresAt: created[0].expires_at })
  } catch (error) {
    console.error('certificate sign link failed:', error)
    return res.status(500).json({ error: 'Could not make a signing link.' })
  }
})

// The settings page asking whether the phone has signed yet.
router.get('/certificate-sign/:token/status', limiter, requireDb, requireAuth('school', 'org'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT signature, expires_at < now() AS expired FROM certificate_sign_requests WHERE token_hash = $1 AND created_by = $2`,
      [hashToken(req.params.token), req.auth.sub],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Signing link not found.' })
    return res.json({ signed: Boolean(rows[0].signature), signatureImage: rows[0].signature || '', expired: rows[0].expired })
  } catch (error) {
    console.error('certificate sign status failed:', error)
    return res.status(500).json({ error: 'Could not check the signature.' })
  }
})

// The phone: who is being asked to sign, for whom. No sign-in; the link is the key.
router.get('/certificate-sign/:token', signLimiter, requireDb, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT signer_name, tenant_name, signature IS NOT NULL AS signed, expires_at < now() AS expired
         FROM certificate_sign_requests WHERE token_hash = $1`,
      [hashToken(req.params.token)],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'This signing link isn’t valid. Make a new QR code on the computer.' })
    const r = rows[0]
    return res.json({ signerName: r.signer_name || '', tenantName: r.tenant_name || '', signed: r.signed, expired: r.expired })
  } catch (error) {
    console.error('certificate sign lookup failed:', error)
    return res.status(500).json({ error: 'Could not open the signing link.' })
  }
})

router.post('/certificate-sign/:token', signLimiter, requireDb, async (req, res) => {
  try {
    const image = req.body?.signatureImage
    if (!isSignaturePng(image)) return res.status(400).json({ error: 'Draw your signature first.' })
    const { rows } = await query(
      `UPDATE certificate_sign_requests SET signature = $2, signed_at = now()
        WHERE token_hash = $1 AND signature IS NULL AND expires_at > now()
        RETURNING 1`,
      [hashToken(req.params.token), image],
    )
    if (rows.length === 0) return res.status(410).json({ error: 'This signing link has expired or was already used. Make a new QR code on the computer.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('certificate sign failed:', error)
    return res.status(500).json({ error: 'Could not save the signature.' })
  }
})

export default router
