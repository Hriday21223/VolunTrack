import express from 'express'
import rateLimit from 'express-rate-limit'
import validator from 'validator'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { encryptSecret, decryptSecret, hasEncryptionKey } from '../secrets.js'
import { uid } from '../ids.js'
import { checkRoundTrip, checkCors } from '../storage/s3.js'

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

// A round trip talks to a third-party bucket on our dyno, so it gets a much
// tighter budget than the read/write config endpoints.
const testLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many storage tests. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// Same posture as the SSO routes: without APP_ENCRYPTION_KEY we cannot store
// a secret access key safely, so the feature is off rather than degraded.
function requireKey(_req, res, next) {
  if (!hasEncryptionKey()) {
    return res.status(503).json({ error: 'Storage is not available: APP_ENCRYPTION_KEY is not configured.' })
  }
  next()
}

// Only the S3 API is implemented. The column accepts gcs/azure_blob so the
// schema doesn't need a migration when their signing is written.
const SUPPORTED_PROVIDERS = ['s3', 'r2']

// The endpoint is tenant-supplied and our server fetches it during a test, so
// it is an SSRF vector. Require https, and reject IP literals and internal
// names — a real object store is always a public DNS name.
function assertSafeEndpoint(raw) {
  if (!raw) return null
  let url
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
  } catch {
    throw new Error('The endpoint must be a valid URL.')
  }
  if (url.protocol !== 'https:') throw new Error('The endpoint must use https.')
  const host = url.hostname.toLowerCase()
  if (validator.isIP(host)) throw new Error('The endpoint must be a hostname, not an IP address.')
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) {
    throw new Error('That endpoint is not a public storage host.')
  }
  return `${url.origin}${trimSlashes(url.pathname, { leading: false })}`
}

// Strips slashes character-wise. A regex like /^\/+|\/+$/ is polynomial on a
// long run of slashes, and these inputs are attacker-supplied.
function trimSlashes(value, { leading = true, trailing = true } = {}) {
  let start = 0
  let end = value.length
  if (leading) while (start < end && value[start] === '/') start += 1
  if (trailing) while (end > start && value[end - 1] === '/') end -= 1
  return value.slice(start, end)
}

// S3 bucket naming: lowercase letters, digits, hyphens and dots, 3-63 chars.
function validBucket(name) {
  return /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name)
}

// Which tenant the caller manages. A config belongs to exactly one school or
// one organization, mirroring sso_connections.
async function ownerFor(auth) {
  const { rows } = await query('SELECT school_id, organization_id FROM users WHERE id = $1', [auth.sub])
  const me = rows[0]
  if (!me) return null
  if (auth.role === 'school' || auth.role === 'school_staff') {
    return me.school_id ? { column: 'school_id', id: me.school_id } : null
  }
  if (auth.role === 'org') {
    return me.organization_id ? { column: 'organization_id', id: me.organization_id } : null
  }
  return null
}

async function loadConfig(owner) {
  const { rows } = await query(`SELECT * FROM tenant_storage WHERE ${owner.column} = $1`, [owner.id])
  return rows[0] || null
}

// The secret access key is never returned — only whether one is stored. Same
// rule as publicConnection() for SSO client secrets.
function publicConfig(row) {
  if (!row) return null
  return {
    id: row.id,
    schoolId: row.school_id,
    organizationId: row.organization_id,
    provider: row.provider,
    bucket: row.bucket,
    region: row.region,
    endpoint: row.endpoint,
    prefix: row.prefix,
    accessKeyId: row.access_key_id,
    hasSecret: Boolean(row.secret_encrypted),
    status: row.status,
    lastTestAt: row.last_test_at,
    lastTestOk: row.last_test_ok,
    lastTestError: row.last_test_error,
    corsOk: row.cors_ok,
    createdAt: row.created_at,
  }
}

// GET /api/storage/config — the tenant's current configuration, if any.
router.get(
  '/config',
  limiter,
  requireDb,
  requireAuth('school', 'school_staff', 'org'),
  async (req, res) => {
    try {
      const owner = await ownerFor(req.auth)
      if (!owner) return res.status(403).json({ error: 'Not allowed.' })
      return res.json({ config: publicConfig(await loadConfig(owner)) })
    } catch (error) {
      console.error('get storage config failed:', error)
      return res.status(500).json({ error: 'Could not load the storage configuration.' })
    }
  },
)

// PUT /api/storage/config — create or replace it. Always drops back to
// 'unverified': new settings have not proven they work, and an unproven
// config must never keep serving uploads.
router.put(
  '/config',
  limiter,
  requireDb,
  requireKey,
  requireAuth('school', 'org'),
  async (req, res) => {
    const provider = String(req.body.provider || 's3').trim().toLowerCase()
    const bucket = String(req.body.bucket || '').trim().toLowerCase()
    const region = String(req.body.region || 'us-east-1').trim()
    // Length-checked before any stripping: the previous order ran a regex
    // over the raw body first, so a 1MB run of '/' backtracked quadratically
    // and blocked the event loop (CodeQL js/polynomial-redos).
    const rawPrefix = String(req.body.prefix || '').trim()
    const accessKeyId = String(req.body.accessKeyId || '').trim()
    const secretAccessKey = String(req.body.secretAccessKey || '').trim()

    if (!SUPPORTED_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: 'Only S3-compatible storage (s3, r2) is supported right now.' })
    }
    if (!validBucket(bucket)) return res.status(400).json({ error: 'That is not a valid bucket name.' })
    if (!/^[a-z0-9-]{1,32}$/.test(region)) return res.status(400).json({ error: 'That is not a valid region.' })
    if (rawPrefix.length > 200) return res.status(400).json({ error: 'The prefix is too long.' })
    // Bounded input, and character-wise rather than a backtracking regex.
    const prefix = trimSlashes(rawPrefix)
    if (!accessKeyId || accessKeyId.length > 200) return res.status(400).json({ error: 'An access key ID is required.' })

    let endpoint
    try {
      endpoint = assertSafeEndpoint(String(req.body.endpoint || '').trim())
    } catch (error) {
      return res.status(400).json({ error: error.message })
    }
    // R2 and other S3-compatible stores are only reachable via their endpoint.
    if (provider === 'r2' && !endpoint) {
      return res.status(400).json({ error: 'R2 needs its account endpoint (https://<account>.r2.cloudflarestorage.com).' })
    }

    try {
      const owner = await ownerFor(req.auth)
      if (!owner) return res.status(403).json({ error: 'Not allowed.' })
      const existing = await loadConfig(owner)

      // Let an admin edit the bucket or prefix without re-typing the secret.
      if (!secretAccessKey && !existing?.secret_encrypted) {
        return res.status(400).json({ error: 'A secret access key is required.' })
      }
      const secretEnc = secretAccessKey ? encryptSecret(secretAccessKey) : existing.secret_encrypted

      const other = owner.column === 'school_id' ? 'organization_id' : 'school_id'
      const { rows } = await query(
        `INSERT INTO tenant_storage
           (id, ${owner.column}, ${other}, provider, bucket, region, endpoint, prefix,
            access_key_id, secret_encrypted, status)
         VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,'unverified')
         ON CONFLICT (${owner.column}) WHERE ${owner.column} IS NOT NULL DO UPDATE SET
           provider = $3, bucket = $4, region = $5, endpoint = $6, prefix = $7,
           access_key_id = $8, secret_encrypted = $9,
           status = 'unverified', last_test_at = NULL, last_test_ok = NULL,
           last_test_error = NULL, cors_ok = NULL
         RETURNING *`,
        [existing?.id || uid('tsto'), owner.id, provider, bucket, region, endpoint, prefix, accessKeyId, secretEnc],
      )
      return res.json({ config: publicConfig(rows[0]) })
    } catch (error) {
      console.error('put storage config failed:', error)
      return res.status(500).json({ error: 'Could not save the storage configuration.' })
    }
  },
)

// POST /api/storage/test — write, read back, and delete a probe object. This
// is the only path to status='active', so a bucket we have never successfully
// written to can never receive a student's upload.
router.post(
  '/test',
  testLimiter,
  requireDb,
  requireKey,
  requireAuth('school', 'org'),
  async (req, res) => {
    try {
      const owner = await ownerFor(req.auth)
      if (!owner) return res.status(403).json({ error: 'Not allowed.' })
      const row = await loadConfig(owner)
      if (!row) return res.status(404).json({ error: 'No storage is configured yet.' })

      let secretAccessKey
      try {
        secretAccessKey = decryptSecret(row.secret_encrypted)
      } catch {
        return res.status(500).json({
          error: 'The stored secret could not be read. Re-enter the secret access key.',
        })
      }

      const config = {
        bucket: row.bucket,
        region: row.region,
        endpoint: row.endpoint,
        prefix: row.prefix,
        accessKeyId: row.access_key_id,
        secretAccessKey,
      }

      const result = await checkRoundTrip(config)
      const cors = result.ok ? await checkCors(config, req.headers.origin || null) : { ok: null }

      // A disabled config stays disabled — a passing test is necessary to go
      // active, not sufficient to override someone turning it off.
      const nextStatus = result.ok && row.status !== 'disabled' ? 'active' : row.status
      const { rows } = await query(
        `UPDATE tenant_storage
            SET last_test_at = now(), last_test_ok = $1, last_test_error = $2,
                cors_ok = $3, status = $4
          WHERE id = $5
          RETURNING *`,
        [result.ok, result.error ? String(result.error).slice(0, 500) : null, cors.ok, nextStatus, row.id],
      )

      return res.json({
        ok: result.ok,
        error: result.error,
        corsWarning: cors.ok === false ? cors.error : null,
        config: publicConfig(rows[0]),
      })
    } catch (error) {
      console.error('storage test failed:', error)
      return res.status(500).json({ error: 'Could not test the storage configuration.' })
    }
  },
)

// DELETE /api/storage/config — stop using the bucket. Objects already in it
// belong to the tenant and are deliberately left untouched.
router.delete('/config', limiter, requireDb, requireAuth('school', 'org'), async (req, res) => {
  try {
    const owner = await ownerFor(req.auth)
    if (!owner) return res.status(403).json({ error: 'Not allowed.' })
    await query(`DELETE FROM tenant_storage WHERE ${owner.column} = $1`, [owner.id])
    return res.json({ ok: true })
  } catch (error) {
    console.error('delete storage config failed:', error)
    return res.status(500).json({ error: 'Could not remove the storage configuration.' })
  }
})

export default router
