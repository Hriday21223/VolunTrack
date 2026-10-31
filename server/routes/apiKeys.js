// Managing API keys (#622) from the app: list, create (the key is shown once),
// revoke. A school's main admin, an organization, or an event organizer
// (Volunteer Task Maker) makes keys for their own account.
import express from 'express'
import rateLimit from 'express-rate-limit'
import { hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { recordAudit, AUDIT } from '../audit.js'
import { keyOwnerFor, listKeys, createKey, revokeKey, ApiKeyError, SCOPES_BY_OWNER } from '../apiKeys.js'

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// school (main admin only, not co-admins), org, and Volunteer Task Makers.
const OWNER_ROLES = ['school', 'org', 'volunteer']

async function owner(req, res) {
  const o = await keyOwnerFor(req.auth)
  if (!o) res.status(403).json({ error: 'This account can’t make API keys.' })
  return o
}

const fail = (res, error, what) => {
  if (error instanceof ApiKeyError) return res.status(error.status).json({ error: error.message })
  console.error(`api keys ${what} failed:`, error)
  return res.status(500).json({ error: 'Could not update your API keys.' })
}

router.get('/', limiter, requireDb, requireAuth(...OWNER_ROLES), async (req, res) => {
  try {
    const o = await owner(req, res)
    if (!o) return
    return res.json({ keys: await listKeys(o), scopes: SCOPES_BY_OWNER[o.ownerType], ownerType: o.ownerType })
  } catch (error) { return fail(res, error, 'list') }
})

// POST { name, scopes, mode? } → { key, apiKey }. `key` is the only copy.
router.post('/', limiter, requireDb, requireAuth(...OWNER_ROLES), async (req, res) => {
  try {
    const o = await owner(req, res)
    if (!o) return
    const out = await createKey(o, req.auth.sub, req.body || {})
    recordAudit(req, {
      action: AUDIT.INTEGRATION_ACCESS_GRANTED,
      schoolId: o.ownerType === 'school' ? o.ownerId : null,
      organizationId: o.ownerType === 'organization' ? o.ownerId : null,
      objectType: 'api_key', objectId: out.apiKey.id,
      meta: { scopes: out.apiKey.scopes, mode: out.apiKey.mode },
    })
    res.set('Cache-Control', 'no-store')
    return res.status(201).json(out)
  } catch (error) { return fail(res, error, 'create') }
})

router.delete('/:id', limiter, requireDb, requireAuth(...OWNER_ROLES), async (req, res) => {
  try {
    const o = await owner(req, res)
    if (!o) return
    const apiKey = await revokeKey(o, req.params.id)
    recordAudit(req, {
      action: AUDIT.INTEGRATION_ACCESS_REVOKED,
      schoolId: o.ownerType === 'school' ? o.ownerId : null,
      organizationId: o.ownerType === 'organization' ? o.ownerId : null,
      objectType: 'api_key', objectId: apiKey.id,
    })
    return res.json({ apiKey })
  } catch (error) { return fail(res, error, 'revoke') }
})

export default router
