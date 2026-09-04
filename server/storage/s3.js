import { createHash, createHmac } from 'crypto'

// Minimal AWS Signature V4 *query* presigner for S3-compatible object stores
// (AWS S3, Cloudflare R2, MinIO, Backblaze B2's S3 API, …).
//
// Why hand-rolled instead of @aws-sdk/client-s3: all we ever need is a signed
// URL the browser can PUT or GET directly. Presigned SigV4 is a small, fully
// specified surface, and pulling ~20MB of SDK into a backend that runs on a
// free Render dyno to produce a query string is a poor trade. The round-trip
// test in checkRoundTrip() exercises the signature against the tenant's real
// bucket at configuration time, so a signing bug fails loudly while an admin
// is watching rather than silently when a student uploads.
//
// Only s3/r2 (and anything else speaking the S3 API) are supported here.
// 'gcs' and 'azure_blob' are accepted by the schema but rejected by the route
// until their native signing is written.

const ALGORITHM = 'AWS4-HMAC-SHA256'
const SERVICE = 's3'
// S3 rejects a presigned URL whose expiry exceeds 7 days.
const MAX_EXPIRES = 60 * 60 * 24 * 7

// RFC 3986. encodeURIComponent leaves !'()* alone but AWS wants them escaped,
// and a mismatch here is the single most common cause of SignatureDoesNotMatch.
function rfc3986(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

// Object keys keep their '/' separators — S3 does not double-encode the path
// for the s3 service (unlike every other AWS service).
function encodeKey(key) {
  return String(key).split('/').map(rfc3986).join('/')
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest()
}

function amzDate(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { full: iso, short: iso.slice(0, 8) }
}

// Virtual-host style (bucket.s3.region.amazonaws.com) for plain AWS; path
// style (endpoint/bucket/key) whenever a custom endpoint is set, since R2 and
// MinIO expect the bucket in the path.
function resolveTarget(config, key) {
  const bucket = String(config.bucket || '').trim()
  const region = String(config.region || 'us-east-1').trim()
  const endpoint = String(config.endpoint || '').trim()

  if (endpoint) {
    const base = new URL(endpoint.startsWith('http') ? endpoint : `https://${endpoint}`)
    const basePath = base.pathname.replace(/\/+$/, '')
    return {
      host: base.host,
      origin: base.origin,
      canonicalUri: `${basePath}/${bucket}/${encodeKey(key)}`,
      region,
    }
  }

  const host = `${bucket}.s3.${region}.amazonaws.com`
  return { host, origin: `https://${host}`, canonicalUri: `/${encodeKey(key)}`, region }
}

/**
 * Build a presigned URL for a single object operation.
 * Only `host` is signed, so the caller may send any headers it likes.
 */
export function presign(config, { method = 'GET', key, expiresIn = 900, now = new Date() }) {
  if (!config?.bucket) throw new Error('Storage config is missing a bucket.')
  if (!config?.accessKeyId || !config?.secretAccessKey) {
    throw new Error('Storage config is missing credentials.')
  }
  if (!key) throw new Error('An object key is required.')

  return signQuery({ ...resolveTarget(config, key), ...config, method, expiresIn, now })
}

/**
 * The signing math itself, split out from endpoint resolution so it can be
 * checked against AWS's published SigV4 test vectors (scripts/check-sigv4.mjs).
 */
export function signQuery({
  host, origin, canonicalUri, region, accessKeyId, secretAccessKey,
  method = 'GET', expiresIn = 900, now = new Date(),
}) {
  const expires = Math.min(Math.max(Number(expiresIn) || 900, 1), MAX_EXPIRES)
  const { full, short } = amzDate(now)
  const scope = `${short}/${region}/${SERVICE}/aws4_request`

  // Query parameters must be sorted by name and encoded before signing.
  const params = {
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': full,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  }
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((name) => `${rfc3986(name)}=${rfc3986(params[name])}`)
    .join('&')

  const canonicalRequest = [
    String(method).toUpperCase(),
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = [ALGORITHM, full, scope, sha256Hex(canonicalRequest)].join('\n')

  const signingKey = ['aws4_request'].reduce(
    (acc, part) => hmac(acc, part),
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, short), region), SERVICE),
  )
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  return `${origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

// Joins the tenant's configured prefix to a key without producing '//' or
// letting a caller escape the prefix with '..'.
export function withPrefix(prefix, key) {
  const clean = String(prefix || '').replace(/^\/+|\/+$/g, '')
  const safe = String(key).replace(/\.\.+/g, '.').replace(/^\/+/, '')
  return clean ? `${clean}/${safe}` : safe
}

/**
 * Prove the credentials actually work: PUT a probe object, GET it back,
 * compare the bytes, then DELETE it. Returns { ok, error }.
 *
 * This is the gate for status='active' — the same posture as an SSO
 * connection, which can only be enabled after a passing test round trip.
 */
export async function checkRoundTrip(config) {
  const key = withPrefix(config.prefix, `.voluntrack-probe-${Date.now()}.txt`)
  const body = `voluntrack storage check ${new Date().toISOString()}`
  let putDone = false

  try {
    const put = await fetch(presign(config, { method: 'PUT', key, expiresIn: 60 }), {
      method: 'PUT',
      body,
    })
    if (!put.ok) return { ok: false, error: await describeFailure(put, 'write to') }
    putDone = true

    const get = await fetch(presign(config, { method: 'GET', key, expiresIn: 60 }))
    if (!get.ok) return { ok: false, error: await describeFailure(get, 'read back from') }
    if ((await get.text()) !== body) {
      return { ok: false, error: 'The probe file read back with different contents.' }
    }

    const del = await fetch(presign(config, { method: 'DELETE', key, expiresIn: 60 }), {
      method: 'DELETE',
    })
    if (!del.ok) return { ok: false, error: await describeFailure(del, 'delete from') }
    putDone = false

    return { ok: true, error: null }
  } catch (error) {
    return { ok: false, error: `Could not reach the bucket: ${error.message}` }
  } finally {
    // Never leave a probe object behind if we bailed between PUT and DELETE.
    if (putDone) {
      await fetch(presign(config, { method: 'DELETE', key, expiresIn: 60 }), { method: 'DELETE' })
        .catch(() => {})
    }
  }
}

// S3 reports errors as an XML body; surface the <Code> because "AccessDenied"
// vs "NoSuchBucket" vs "SignatureDoesNotMatch" is exactly what the admin needs.
async function describeFailure(res, verb) {
  const text = await res.text().catch(() => '')
  const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1]
  const hint = {
    NoSuchBucket: 'That bucket does not exist. Check the name and region.',
    AccessDenied: 'The access key is missing s3:PutObject, s3:GetObject, or s3:DeleteObject on this bucket.',
    InvalidAccessKeyId: 'That access key ID is not recognized.',
    SignatureDoesNotMatch: 'The secret access key does not match that access key ID.',
    PermanentRedirect: 'Wrong region for this bucket.',
  }[code]
  return hint || `Could not ${verb} the bucket (HTTP ${res.status}${code ? ` ${code}` : ''}).`
}

/**
 * Browsers PUT directly to the tenant's bucket, so the bucket needs a CORS
 * rule allowing our origin. A preflight is unauthenticated, so we can check
 * it without credentials. Advisory only — a missing rule doesn't block
 * configuration, it just means uploads would fail from the browser.
 */
export async function checkCors(config, origin) {
  if (!origin) return { ok: null, error: null }
  try {
    const { origin: base, canonicalUri } = resolveTarget(config, withPrefix(config.prefix, 'probe'))
    const res = await fetch(`${base}${canonicalUri}`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type',
      },
    })
    const allowed = res.headers.get('access-control-allow-origin')
    if (allowed === '*' || allowed === origin) return { ok: true, error: null }
    return {
      ok: false,
      error: `The bucket has no CORS rule allowing PUT from ${origin}. Uploads from a browser will fail until one is added.`,
    }
  } catch {
    return { ok: null, error: null }
  }
}
