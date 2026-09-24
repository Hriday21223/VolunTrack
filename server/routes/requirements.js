// Tenant-defined requirements: schools and organizations describe how they want
// hours logged, and who may sign in. See server/requirements.js for the policy
// shape and server/policy.js for the lookups.

import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { recordAudit, AUDIT } from '../audit.js'
import { normalizePolicy, goalHoursFor, SECTIONS } from '../requirements.js'
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

export default router
