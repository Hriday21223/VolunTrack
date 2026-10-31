// API keys for the public API (#622). A key belongs to a school (its main
// admin makes it), an organization, or an event organizer, and carries
// scopes saying what it may read.
//
// The key looks like vt_live_<prefix>_<secret> (vt_test_… for test mode). We
// store the prefix (to find the row and to show which key is which) and a
// SHA-256 of the whole key; the key itself is shown once, at creation. The
// secret is 32 random bytes, so a plain hash is enough (no need for a slow
// password hash): it can't be guessed, only leaked.
//
// authenticateApiKey() is the only way into /api/v1. It is separate from the
// app's session auth: a key never works on the app's own routes, and a
// session token never works on /api/v1.
import crypto from 'node:crypto'
import { query } from './db.js'
import { uid } from './ids.js'
import { schoolIsActive } from './plans.js'

export const MAX_KEYS_PER_OWNER = 10
export const OWNER_TYPES = ['school', 'organization', 'organizer']

// What each kind of owner may give a key. Read-only for now (#622 part 2+).
export const SCOPES_BY_OWNER = {
  school: ['students:read', 'hours:read', 'progress:read', 'reports:read'],
  organization: ['students:read', 'hours:read', 'progress:read', 'reports:read'],
  organizer: ['events:read'],
}
export const ALL_SCOPES = [...new Set(Object.values(SCOPES_BY_OWNER).flat())]

const KEY_RE = /^vt_(live|test)_([a-z0-9]{8})_([A-Za-z0-9_-]{43})$/

export class ApiKeyError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

/** A new key: { prefix, key, hash }. The key is returned once and never stored. */
export function generateKey(mode = 'live') {
  const prefix = crypto.randomBytes(8).toString('hex').slice(0, 8)
  const secret = crypto.randomBytes(32).toString('base64url')
  const key = `vt_${mode}_${prefix}_${secret}`
  return { prefix, key, hash: sha256(key) }
}

/**
 * Who the signed-in account can make keys for, from its role:
 * { ownerType, ownerId } or null.
 */
export async function keyOwnerFor(auth) {
  if (!auth?.sub) return null
  if (auth.role === 'school') {
    const { rows } = await query('SELECT school_id FROM users WHERE id = $1', [auth.sub])
    return rows[0]?.school_id ? { ownerType: 'school', ownerId: rows[0].school_id } : null
  }
  if (auth.role === 'org') {
    const { rows } = await query('SELECT organization_id FROM users WHERE id = $1', [auth.sub])
    return rows[0]?.organization_id ? { ownerType: 'organization', ownerId: rows[0].organization_id } : null
  }
  if (auth.role === 'volunteer') return { ownerType: 'organizer', ownerId: auth.sub }
  return null
}

const toApi = (r) => ({
  id: r.id,
  name: r.name,
  prefix: `vt_${r.mode}_${r.prefix}`,
  mode: r.mode,
  scopes: r.scopes,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
  revokedAt: r.revoked_at,
})

export async function listKeys({ ownerType, ownerId }) {
  const { rows } = await query(
    `SELECT * FROM api_keys WHERE owner_type = $1 AND owner_id = $2
      ORDER BY revoked_at IS NOT NULL, created_at DESC LIMIT 50`,
    [ownerType, ownerId],
  )
  return rows.map(toApi)
}

export async function createKey({ ownerType, ownerId }, createdBy, { name, scopes, mode = 'live' } = {}) {
  const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60)
  if (!clean) throw new ApiKeyError('Give the key a name, like "PowerSchool sync".')
  if (!['live', 'test'].includes(mode)) throw new ApiKeyError('mode must be live or test.')
  const allowed = SCOPES_BY_OWNER[ownerType] || []
  const picked = [...new Set(Array.isArray(scopes) ? scopes : [])]
  if (picked.length === 0) throw new ApiKeyError('Pick at least one permission.')
  const bad = picked.filter((s) => !allowed.includes(s))
  if (bad.length) throw new ApiKeyError(`This account can’t give a key: ${bad.join(', ')}.`)
  const { rows: count } = await query(
    'SELECT COUNT(*)::int AS n FROM api_keys WHERE owner_type = $1 AND owner_id = $2 AND revoked_at IS NULL',
    [ownerType, ownerId],
  )
  if (count[0].n >= MAX_KEYS_PER_OWNER) throw new ApiKeyError(`You can have up to ${MAX_KEYS_PER_OWNER} active keys. Revoke one first.`)
  const { prefix, key, hash } = generateKey(mode)
  const { rows } = await query(
    `INSERT INTO api_keys (id, owner_type, owner_id, name, prefix, secret_hash, scopes, mode, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [uid('apik'), ownerType, ownerId, clean, prefix, hash, picked, mode, createdBy],
  )
  return { key, apiKey: toApi(rows[0]) }
}

export async function revokeKey({ ownerType, ownerId }, id) {
  const { rows } = await query(
    `UPDATE api_keys SET revoked_at = now()
      WHERE id = $1 AND owner_type = $2 AND owner_id = $3 AND revoked_at IS NULL RETURNING *`,
    [id, ownerType, ownerId],
  )
  if (!rows[0]) throw new ApiKeyError('Key not found, or already revoked.', 404)
  return toApi(rows[0])
}

/** The v1 error shape: { error: { code, message } }. */
export function apiError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } })
}

/**
 * Middleware for /api/v1: reads `Authorization: Bearer vt_…`, checks the key,
 * and sets req.apiKey = { id, ownerType, ownerId, scopes, mode }. Every check
 * reads the database, so a revoked key or a lapsed school stops at once.
 */
export async function authenticateApiKey(req, res, next) {
  const header = String(req.headers.authorization || '')
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const m = KEY_RE.exec(key)
  if (!m) return apiError(res, 401, 'invalid_key', 'Send an API key as "Authorization: Bearer vt_live_…". Make one in your VolunTrack settings.')
  try {
    const { rows } = await query('SELECT * FROM api_keys WHERE prefix = $1 AND mode = $2', [m[2], m[1]])
    const row = rows[0]
    const given = Buffer.from(sha256(key), 'hex')
    const stored = Buffer.from(row?.secret_hash || '0'.repeat(64), 'hex')
    if (!row || given.length !== stored.length || !crypto.timingSafeEqual(given, stored)) {
      return apiError(res, 401, 'invalid_key', 'That API key is not valid.')
    }
    if (row.revoked_at) return apiError(res, 401, 'revoked_key', 'That API key was revoked.')
    if (row.owner_type === 'school' && row.mode === 'live') {
      const { rows: s } = await query('SELECT plan, payment_status FROM schools WHERE id = $1', [row.owner_id])
      if (!s[0]) return apiError(res, 401, 'invalid_key', 'That API key is not valid.')
      if (!schoolIsActive(s[0])) return apiError(res, 402, 'payment_required', 'This school’s account isn’t active, so its API keys are paused until payment is verified.')
    }
    req.apiKey = { id: row.id, ownerType: row.owner_type, ownerId: row.owner_id, scopes: row.scopes, mode: row.mode, name: row.name }
    // For the audit trail: reads through a key are recorded against the person
    // who made it, with the role 'api_key' (the key id goes in meta).
    req.auth = { sub: row.created_by || null, role: 'api_key' }
    // At most one write a minute per key, so a busy integration doesn't hammer the row.
    query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`, [row.id])
      .catch(() => {})
    next()
  } catch (error) {
    console.error('api key check failed:', error)
    return apiError(res, 500, 'server_error', 'Could not check the API key.')
  }
}

/** Middleware: the key must carry `scope`. */
export function requireScope(scope) {
  return (req, res, next) => {
    if (!req.apiKey?.scopes?.includes(scope)) return apiError(res, 403, 'missing_scope', `This key needs the "${scope}" permission.`)
    next()
  }
}
