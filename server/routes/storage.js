import express from 'express'
import rateLimit from 'express-rate-limit'
import validator from 'validator'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { encryptSecret, decryptSecret, hasEncryptionKey } from '../secrets.js'
import { uid } from '../ids.js'
import { checkRoundTrip, checkCors, trimSlashes, presign, withPrefix } from '../storage/s3.js'
import { recordAudit, AUDIT } from '../audit.js'

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

// ---------------------------------------------------------------------------
// Proof uploads (#143 step 2)
// ---------------------------------------------------------------------------

// Minting a URL is cheap for us but hands out a credential, so it gets a
// tighter budget than reading config.
const mintLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many upload requests. Please try again later.' },
})

// The extension is chosen by us from the declared type, never taken from the
// client's filename — so a student cannot land a .html or .svg in their
// school's bucket and have it served back as active content.
const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
}

function maxUploadBytes() {
  const raw = Number(process.env.STORAGE_MAX_UPLOAD_BYTES)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 10 * 1024 * 1024
}

// Which config a given student's uploads go through: their school's if it has
// one, otherwise their school's parent organization's. Only 'active' configs
// are ever returned, so a bucket we have never written to successfully can
// never receive a student's file.
async function resolveStorageForUser(userId) {
  const { rows } = await query(
    `SELECT u.school_id, s.organization_id
       FROM users u
       LEFT JOIN schools s ON s.id = u.school_id
      WHERE u.id = $1`,
    [userId],
  )
  const me = rows[0]
  if (!me || (!me.school_id && !me.organization_id)) return null

  const { rows: configs } = await query(
    `SELECT * FROM tenant_storage
      WHERE status = 'active'
        AND (($1::text IS NOT NULL AND school_id = $1)
          OR ($2::text IS NOT NULL AND organization_id = $2))
      -- A school's own config wins over the organization's.
      ORDER BY (school_id IS NOT NULL) DESC
      LIMIT 1`,
    [me.school_id, me.organization_id],
  )
  return configs[0] || null
}

// Turns a stored row into the shape presign() wants, decrypting the secret.
function usableConfig(row) {
  return {
    bucket: row.bucket,
    region: row.region,
    endpoint: row.endpoint,
    prefix: row.prefix,
    accessKeyId: row.access_key_id,
    secretAccessKey: decryptSecret(row.secret_encrypted),
  }
}

// Object keys are namespaced per student, which is what lets a later claim be
// checked without tracking pending uploads in a table.
function proofKeyFor(config, userId, ext) {
  return withPrefix(config.prefix, `students/${userId}/${uid('proof')}.${ext}`)
}

// POST /api/storage/upload-url { contentType, bytes }
// Returns a presigned PUT the browser uses to send the file straight to the
// tenant's bucket. The bytes never pass through us.
router.post('/upload-url', mintLimiter, requireDb, requireKey, requireAuth(), async (req, res) => {
  const contentType = String(req.body.contentType || '').trim().toLowerCase()
  const bytes = Number(req.body.bytes)
  const ext = ALLOWED_TYPES[contentType]

  if (!ext) return res.status(400).json({ error: 'Proof must be a JPEG, PNG, WebP, HEIC, or PDF.' })
  if (!Number.isInteger(bytes) || bytes <= 0) return res.status(400).json({ error: 'A file size is required.' })
  if (bytes > maxUploadBytes()) {
    return res.status(413).json({ error: `That file is too large (limit ${Math.floor(maxUploadBytes() / 1024 / 1024)}MB).` })
  }

  try {
    const row = await resolveStorageForUser(req.auth.sub)
    // Not an error: a student with no school, or a school that has not set up
    // storage, keeps the existing local-only behaviour.
    if (!row) return res.json({ available: false })

    const config = usableConfig(row)
    const key = proofKeyFor(config, req.auth.sub, ext)

    // content-length is signed, so the upload is pinned to exactly the size
    // declared here — a client that sends more fails the signature at S3
    // rather than filling the school's bucket.
    const url = presign(config, {
      method: 'PUT',
      key,
      expiresIn: 300,
      headers: { 'content-length': String(bytes) },
    })

    return res.json({ available: true, url, key, storageId: row.id, expiresIn: 300 })
  } catch (error) {
    console.error('mint upload url failed:', error)
    return res.status(500).json({ error: 'Could not prepare the upload.' })
  }
})

// GET /api/storage/download-url/:logId
// Mints a short-lived GET for a log's proof file. This is the audited moment:
// once the URL is handed out it works for whoever holds it, and the object
// store only ever sees our access key — so this call is the only place the
// requesting person's identity exists.
router.get('/download-url/:logId', mintLimiter, requireDb, requireKey, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT l.id, l.user_id, l.proof_storage_id, l.proof_key, l.proof_mime,
              u.school_id, s.organization_id
         FROM logs l
         JOIN users u ON u.id = l.user_id
         LEFT JOIN schools s ON s.id = u.school_id
        WHERE l.id = $1`,
      [req.params.logId],
    )
    const log = rows[0]
    if (!log) return res.status(404).json({ error: 'Log not found.' })
    if (!log.proof_key || !log.proof_storage_id) {
      return res.status(404).json({ error: 'That log has no stored proof file.' })
    }

    const allowed = await canReadProof(req.auth, log)
    if (!allowed) {
      recordAudit(req, {
        action: AUDIT.PROOF_URL_MINTED,
        outcome: 'denied',
        subjectUserId: log.user_id,
        schoolId: log.school_id,
        organizationId: log.organization_id,
        objectType: 'log_proof',
        objectId: log.id,
      })
      return res.status(403).json({ error: 'Not allowed.' })
    }

    const { rows: configs } = await query('SELECT * FROM tenant_storage WHERE id = $1', [log.proof_storage_id])
    if (!configs[0]) return res.status(410).json({ error: 'The storage this file was written to is no longer configured.' })

    const expiresIn = 300
    const url = presign(usableConfig(configs[0]), { method: 'GET', key: log.proof_key, expiresIn })

    // Record the key and expiry — never the URL, which is itself a live grant.
    recordAudit(req, {
      action: AUDIT.PROOF_URL_MINTED,
      subjectUserId: log.user_id,
      schoolId: log.school_id,
      organizationId: log.organization_id,
      objectType: 'log_proof',
      objectId: log.id,
      meta: { key: log.proof_key, expiresIn, storageId: log.proof_storage_id },
    })

    return res.json({ url, expiresIn, mime: log.proof_mime })
  } catch (error) {
    console.error('mint download url failed:', error)
    return res.status(500).json({ error: 'Could not prepare the download.' })
  }
})

// Default-deny, matching GET /api/school/pdf/:id: every allowed role is
// listed explicitly and anything else falls through to false.
async function canReadProof(auth, log) {
  if (auth.role === 'admin') return true
  if (auth.sub === log.user_id) return true

  if (auth.role === 'school' || auth.role === 'school_staff') {
    const { rows } = await query('SELECT school_id FROM users WHERE id = $1', [auth.sub])
    return Boolean(log.school_id) && rows[0]?.school_id === log.school_id
  }
  if (auth.role === 'org') {
    const { rows } = await query('SELECT organization_id FROM users WHERE id = $1', [auth.sub])
    return Boolean(log.organization_id) && rows[0]?.organization_id === log.organization_id
  }
  if (auth.role === 'parent') {
    const { rows } = await query(
      'SELECT 1 FROM parent_child_links WHERE parent_id = $1 AND child_id = $2',
      [auth.sub, log.user_id],
    )
    return rows.length > 0
  }
  return false
}

export default router
