import express from 'express'
import rateLimit from 'express-rate-limit'
import { perPersonKey } from '../rateKey.js'
import validator from 'validator'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { encryptSecret, decryptSecret, hasEncryptionKey } from '../secrets.js'
import { uid } from '../ids.js'
import { checkRoundTrip, checkCors, trimSlashes, presign, withPrefix } from '../storage/s3.js'
import { mintUpload, mintDownload, roundTrip, isSharepoint, isGdrive, isExternal } from '../storage/adapter.js'
import { gdriveConfigured, gdriveAuthUrl, exchangeCode, createRootFolder, revokeToken, forgetToken, gdriveOpen } from '../storage/gdrive.js'
import { sharepointConfigured, sharepointClientId, parseSiteUrl, validTenantId } from '../storage/graph.js'
import jwt from 'jsonwebtoken'
import { recordAudit, AUDIT } from '../audit.js'
import { isPublicHost } from '../publicHost.js'

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
    // SharePoint (#924): no keys of the school's; our Microsoft app, approved
    // by the school's admin, writes to one site they granted it.
    if (provider === 'sharepoint') return saveSharepoint(req, res)
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
    // The checks above go by the name; this goes by where it actually points.
    if (endpoint && !(await isPublicHost(new URL(endpoint).hostname))) {
      return res.status(400).json({ error: 'That endpoint is not a public storage host.' })
    }
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
        secretAccessKey = isExternal(row) ? (row.secret_encrypted ? decryptSecret(row.secret_encrypted) : null) : decryptSecret(row.secret_encrypted)
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

      const result = isExternal(row) ? await roundTrip(row) : await checkRoundTrip(config)
      // Microsoft's and Google's upload URLs allow browser uploads on their
      // own; only a bucket needs its CORS rule checked.
      const cors = result.ok && !isExternal(row) ? await checkCors(config, req.headers.origin || null) : { ok: null }

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

// ---------------------------------------------------------------------------
// SharePoint (#924)
// ---------------------------------------------------------------------------
async function saveSharepoint(req, res) {
  // Their own Entra app (#926): client id + secret from the school's tenant.
  const clientId = String(req.body.clientId || '').trim()
  const clientSecret = String(req.body.clientSecret || '').trim()
  if (clientId && !validTenantId(clientId)) return res.status(400).json({ error: 'The application (client) ID looks like 00000000-0000-0000-0000-000000000000.' })
  if (!clientId && !sharepointConfigured()) return res.status(400).json({ error: 'Add your Microsoft app’s client ID and secret.' })
  const tenant = String(req.body.tenantId || '').trim()
  const site = String(req.body.siteUrl || '').trim()
  const library = String(req.body.library || 'Documents').trim().slice(0, 100) || 'Documents'
  const rawPrefix = String(req.body.prefix || '').trim()
  if (!validTenantId(tenant)) return res.status(400).json({ error: clientId ? 'Add your directory (tenant) ID.' : 'Approve VolunTrack for your Microsoft 365 first, so we know your tenant.' })
  if (!parseSiteUrl(site)) return res.status(400).json({ error: 'Enter your SharePoint site address, like https://yourschool.sharepoint.com/sites/Volunteering.' })
  if (rawPrefix.length > 200) return res.status(400).json({ error: 'The folder name is too long.' })
  const prefix = trimSlashes(rawPrefix)
  try {
    const owner = await ownerFor(req.auth)
    if (!owner) return res.status(403).json({ error: 'Not allowed.' })
    const existing = await loadConfig(owner)
    // Keep a saved secret when only other fields change (same app).
    let secretEnc = null
    if (clientId) {
      if (clientSecret) secretEnc = encryptSecret(clientSecret)
      else if (existing?.provider === 'sharepoint' && existing.access_key_id === clientId && existing.secret_encrypted) secretEnc = existing.secret_encrypted
      else return res.status(400).json({ error: 'Add your Microsoft app’s client secret.' })
    }
    const other = owner.column === 'school_id' ? 'organization_id' : 'school_id'
    const { rows } = await query(
      `INSERT INTO tenant_storage
         (id, ${owner.column}, ${other}, provider, bucket, region, endpoint, prefix, access_key_id, secret_encrypted, status)
       VALUES ($1,$2,NULL,'sharepoint',$3,$4,$5,$6,$7,$8,'unverified')
       ON CONFLICT (${owner.column}) WHERE ${owner.column} IS NOT NULL DO UPDATE SET
         provider = 'sharepoint', bucket = $3, region = $4, endpoint = $5, prefix = $6,
         access_key_id = $7, secret_encrypted = $8,
         status = 'unverified', last_test_at = NULL, last_test_ok = NULL, last_test_error = NULL, cors_ok = NULL
       RETURNING *`,
      [existing?.id || uid('tsto'), owner.id, library, tenant, site, prefix, clientId || null, secretEnc],
    )
    return res.json({ config: publicConfig(rows[0]) })
  } catch (error) {
    console.error('save sharepoint config failed:', error)
    return res.status(500).json({ error: 'Could not save the storage configuration.' })
  }
}

// GET /api/storage/providers — which extra providers this server offers.
router.get('/providers', limiter, requireAuth('school', 'org'), (_req, res) => {
  return res.json({ sharepoint: sharepointConfigured(), sharepointAppId: sharepointConfigured() ? sharepointClientId() : null, googleDrive: gdriveConfigured() })
})

const consentState = (owner) => jwt.sign({ purpose: 'ms_storage_consent', owner }, process.env.JWT_SECRET, { expiresIn: '30m' })
const apiBase = () => (process.env.PUBLIC_API_URL || '').replace(/\/$/, '')
const siteBase = () => (process.env.FRONTEND_URL || 'https://volunteer-track-two.vercel.app').split(',')[0].trim().replace(/\/$/, '')

// GET /api/storage/microsoft/consent-url — the Microsoft admin-consent page,
// where the school's Microsoft 365 admin approves VolunTrack once.
router.get('/microsoft/consent-url', limiter, requireDb, requireAuth('school', 'org'), async (req, res) => {
  if (!sharepointConfigured() || !apiBase()) return res.status(503).json({ error: 'SharePoint isn’t set up on this server yet.' })
  const owner = await ownerFor(req.auth)
  if (!owner) return res.status(403).json({ error: 'Not allowed.' })
  const url = new URL('https://login.microsoftonline.com/organizations/v2.0/adminconsent')
  url.searchParams.set('client_id', sharepointClientId())
  url.searchParams.set('scope', 'https://graph.microsoft.com/.default')
  url.searchParams.set('redirect_uri', `${apiBase()}/api/storage/microsoft/callback`)
  url.searchParams.set('state', consentState({ column: owner.column, id: owner.id }))
  return res.json({ url: url.toString() })
})

// Microsoft sends the admin back here with ?tenant=&admin_consent=True&state=.
// Nothing is saved: the dashboard gets the tenant id to finish the form.
router.get('/microsoft/callback', limiter, (req, res) => {
  let page = '/school/dashboard/setup/storage'
  const back = (q) => res.redirect(302, `${siteBase()}${page}?${new URLSearchParams(q)}`)
  try {
    const st = jwt.verify(String(req.query.state || ''), process.env.JWT_SECRET)
    if (st?.purpose !== 'ms_storage_consent') throw new Error('bad state')
    if (st.owner?.column === 'organization_id') page = '/organization/dashboard/requirements'
  } catch { return back({ msError: 'expired' }) }
  if (String(req.query.admin_consent || '').toLowerCase() !== 'true' || !validTenantId(req.query.tenant)) {
    return back({ msError: String(req.query.error || 'declined').slice(0, 40) })
  }
  return back({ msTenant: String(req.query.tenant) })
})

// ---------------------------------------------------------------------------
// Google Drive (#919)
// ---------------------------------------------------------------------------
const googleRedirect = () => `${apiBase()}/api/storage/google/callback`
const storagePage = (column) => (column === 'organization_id' ? '/organization/dashboard/requirements' : '/school/dashboard/setup/storage')

// GET /api/storage/google/connect-url — Google's sign-in page, where someone
// at the school picks the Google account whose Drive will hold the files.
router.get('/google/connect-url', limiter, requireDb, requireKey, requireAuth('school', 'org'), async (req, res) => {
  if (!gdriveConfigured() || !apiBase()) return res.status(503).json({ error: 'Google Drive isn’t set up on this server yet.' })
  const owner = await ownerFor(req.auth)
  if (!owner) return res.status(403).json({ error: 'Not allowed.' })
  // Co-admins can't change storage (the card is the main admin's), same as the other providers.
  if (req.auth.role === 'school_staff') return res.status(403).json({ error: 'Only your school’s main admin can connect storage.' })
  const state = jwt.sign({ purpose: 'gdrive_connect', owner: { column: owner.column, id: owner.id }, by: req.auth.sub, role: req.auth.role }, process.env.JWT_SECRET, { expiresIn: '15m' })
  return res.json({ url: gdriveAuthUrl({ redirectUri: googleRedirect(), state }) })
})

// Google sends the person back here with ?code=&state=. We trade the code for
// a refresh token, make the "VolunTrack proof files" folder in that Drive, and
// save the storage as unverified; the dashboard then runs the usual test.
router.get('/google/callback', limiter, async (req, res) => {
  let page = storagePage('school_id')
  const back = (q) => res.redirect(302, `${siteBase()}${page}?${new URLSearchParams(q)}`)
  let st
  try {
    st = jwt.verify(String(req.query.state || ''), process.env.JWT_SECRET)
    if (st?.purpose !== 'gdrive_connect' || !st.owner?.id) throw new Error('bad state')
    page = storagePage(st.owner.column)
  } catch { return back({ gdError: 'expired' }) }
  if (req.query.error || !req.query.code) return back({ gdError: String(req.query.error || 'declined').slice(0, 40) })
  if (!gdriveConfigured() || !hasDatabase() || !hasEncryptionKey()) return back({ gdError: 'unavailable' })
  try {
    const { refreshToken, accessToken, email } = await exchangeCode(String(req.query.code), googleRedirect())
    const rootId = await createRootFolder(accessToken)
    const column = st.owner.column === 'organization_id' ? 'organization_id' : 'school_id'
    const other = column === 'school_id' ? 'organization_id' : 'school_id'
    const { rows: existing } = await query(`SELECT id, provider, secret_encrypted FROM tenant_storage WHERE ${column} = $1`, [st.owner.id])
    const { rows } = await query(
      `INSERT INTO tenant_storage
         (id, ${column}, ${other}, provider, bucket, region, endpoint, prefix, access_key_id, secret_encrypted, status)
       VALUES ($1,$2,NULL,'gdrive',$3,'google',NULL,'',$4,$5,'unverified')
       ON CONFLICT (${column}) WHERE ${column} IS NOT NULL DO UPDATE SET
         provider = 'gdrive', bucket = $3, region = 'google', endpoint = NULL, prefix = '',
         access_key_id = $4, secret_encrypted = $5,
         status = 'unverified', last_test_at = NULL, last_test_ok = NULL, last_test_error = NULL, cors_ok = NULL
       RETURNING id`,
      [existing[0]?.id || uid('tsto'), st.owner.id, rootId, email, encryptSecret(refreshToken)],
    )
    forgetToken(rows[0].id)
    // Replacing an older Google connection: let go of its token.
    if (existing[0]?.provider === 'gdrive' && existing[0].secret_encrypted) {
      try { revokeToken(decryptSecret(existing[0].secret_encrypted)) } catch { /* unreadable: nothing to revoke */ }
    }
    req.auth = { sub: st.by, role: st.role }
    recordAudit(req, {
      action: AUDIT.STORAGE_CONFIG_CHANGED,
      ...(column === 'school_id' ? { schoolId: st.owner.id } : { organizationId: st.owner.id }),
      objectType: 'tenant_storage',
      objectId: rows[0].id,
      meta: { provider: 'gdrive', account: email },
    })
    return back({ gdConnected: '1' })
  } catch (error) {
    console.error('google drive connect failed:', error.message)
    return back({ gdError: 'failed' })
  }
})

// DELETE /api/storage/config — stop using the bucket. Objects already in it
// belong to the tenant and are deliberately left untouched.
router.delete('/config', limiter, requireDb, requireAuth('school', 'org'), async (req, res) => {
  try {
    const owner = await ownerFor(req.auth)
    if (!owner) return res.status(403).json({ error: 'Not allowed.' })
    // Google Drive: give the token back to Google too (files stay in the Drive).
    const old = await loadConfig(owner)
    if (isGdrive(old) && old.secret_encrypted) {
      forgetToken(old.id)
      try { revokeToken(decryptSecret(old.secret_encrypted)) } catch { /* unreadable: nothing to revoke */ }
    }
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
  keyGenerator: perPersonKey,
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
    secretAccessKey: isExternal(row) ? null : decryptSecret(row.secret_encrypted),
  }
}

// Object keys are namespaced per student, which is what lets a later claim be
// checked without tracking pending uploads in a table. Documents submitted to
// a school (#143 step 6) share the namespace and differ only by id prefix —
// keyBelongsTo() guards the whole namespace, so nothing is weakened by it.
function objectKeyFor(config, userId, ext, kind) {
  return withPrefix(config.prefix, `students/${userId}/${uid(kind)}.${ext}`)
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
    // 'document' is a report submitted to the school (#143 step 6); anything
    // else is proof attached to a log. Both live under the student's own
    // namespace and differ only by id prefix.
    const kind = req.body.kind === 'document' ? 'doc' : 'proof'
    const key = objectKeyFor(config, req.auth.sub, ext, kind)

    // content-length is signed, so the upload is pinned to exactly the size
    // declared here — a client that sends more fails the signature at S3
    // rather than filling the school's bucket.
    const minted = await mintUpload(row, { key, bytes, origin: req.headers.origin || null })

    return res.json({ available: true, url: minted.url, kind: minted.kind, key, storageId: row.id, expiresIn: 300 })
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
      `SELECT l.id, l.user_id, l.proof_storage_id, l.proof_key, l.proof_mime, l.created_at,
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
    const url = await mintDownload(configs[0], log.proof_key, expiresIn)

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

// GET /api/storage/gdrive/file?t= — the file itself, read from Google Drive
// and passed on (#919, Option B). The token came from mintDownload(), which is
// where the audit event and the permission check happen; it lasts 5 minutes.
router.get('/gdrive/file', mintLimiter, requireDb, requireKey, async (req, res) => {
  let t
  try {
    t = jwt.verify(String(req.query.t || ''), process.env.JWT_SECRET)
    if (t?.purpose !== 'gdrive_view' || !t.sid || !t.key) throw new Error('bad token')
  } catch { return res.status(403).type('text/plain').send('This link has expired. Open the file again from VolunTrack.') }
  try {
    const { rows } = await query('SELECT * FROM tenant_storage WHERE id = $1', [t.sid])
    const row = rows[0]
    if (!row || !isGdrive(row)) return res.status(410).type('text/plain').send('This storage is no longer connected.')
    const opened = await gdriveOpen({ id: row.id, refreshToken: decryptSecret(row.secret_encrypted), rootId: row.bucket, prefix: row.prefix }, t.key)
    if (!opened) return res.status(404).type('text/plain').send('The file is no longer in Google Drive.')
    // Only the types we accept for upload are ever served as themselves.
    const mime = Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, opened.mime) ? opened.mime : 'application/octet-stream'
    res.set({
      'Content-Type': mime,
      'Content-Disposition': `inline; filename="${String(t.key).split('/').pop().replace(/[^\w.-]/g, '')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      // Shown by the app's own pages (an <img>, or a new tab).
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    })
    if (opened.size) res.set('Content-Length', String(opened.size))
    const body = Buffer.from(await opened.res.arrayBuffer())
    return res.send(body)
  } catch (error) {
    console.error('google drive view failed:', error.message)
    return res.status(502).type('text/plain').send('Could not open the file from Google Drive. Try again.')
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
    // Only for an entry logged after the parent linked — the same cut-off as
    // reading the logs themselves (logReadScope in server/routes/logs.js).
    const { rows } = await query(
      'SELECT 1 FROM parent_child_links WHERE parent_id = $1 AND child_id = $2 AND COALESCE(visible_from, created_at) <= $3',
      [auth.sub, log.user_id, log.created_at],
    )
    return rows.length > 0
  }
  return false
}

export default router
