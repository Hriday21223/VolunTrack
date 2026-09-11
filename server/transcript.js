import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'crypto'

// Signed, portable volunteer transcripts (#143 Part B).
//
// A transcript is a JSON document a student carries to a new school, a
// college, or off the platform entirely. It is signed with Ed25519 so the
// receiver can trust it without trusting the student: approved hours stay
// approved on import instead of resetting to unverified, and anyone can check
// a transcript through the public verify endpoint without an account.
//
// The signature covers the RFC 8785 (JCS) canonical form of the whole document
// minus its `signature` member. For the value types a transcript contains
// (strings, finite numbers, booleans, null, arrays, objects) that is exactly
// canonicalJson() below, so a third party can re-verify offline with any JCS
// library and the key published at GET /api/transcript/keys.

export const TRANSCRIPT_FORMAT = 'voluntrack.transcript'
export const TRANSCRIPT_VERSION = 1

// DER headers that wrap a raw 32-byte Ed25519 seed / public key, so a key can
// be configured as a short base64 string instead of a multi-line PEM.
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function decode32(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  for (const encoding of ['base64', 'hex']) {
    const buf = Buffer.from(s, encoding)
    if (buf.length === 32) return buf
  }
  return null
}

function rawPublicKey(publicKey) {
  return publicKey.export({ format: 'der', type: 'spki' }).subarray(SPKI_ED25519_PREFIX.length)
}

// Derived from the key itself rather than configured alongside it, so the id
// in a signature can never disagree with the key that made it.
function keyIdFor(publicKey) {
  return `vt-${createHash('sha256').update(rawPublicKey(publicKey)).digest('hex').slice(0, 16)}`
}

let cachedCurrent = null

// TRANSCRIPT_SIGNING_KEY: a 32-byte Ed25519 seed (base64 or hex), or a PKCS#8
// PEM. Unlike APP_ENCRYPTION_KEY there is no passphrase fallback — a signing
// key derived from something typed by hand is a forgeable signing key.
function currentKey() {
  const raw = process.env.TRANSCRIPT_SIGNING_KEY
  if (!raw) return null
  if (cachedCurrent?.raw === raw) return cachedCurrent

  let privateKey
  if (raw.includes('BEGIN')) {
    privateKey = createPrivateKey(raw.replace(/\\n/g, '\n'))
  } else {
    const seed = decode32(raw)
    if (!seed) {
      throw new Error('TRANSCRIPT_SIGNING_KEY must be a 32-byte Ed25519 seed (base64 or hex) or a PKCS#8 PEM.')
    }
    privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' })
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('TRANSCRIPT_SIGNING_KEY is not an Ed25519 key.')
  }
  const publicKey = createPublicKey(privateKey)
  cachedCurrent = { raw, privateKey, publicKey, keyId: keyIdFor(publicKey) }
  return cachedCurrent
}

export function hasSigningKey() {
  try {
    return Boolean(currentKey())
  } catch (error) {
    console.error('transcript signing key is misconfigured:', error.message)
    return false
  }
}

// TRANSCRIPT_RETIRED_PUBLIC_KEYS: comma/space separated raw public keys
// (base64) of signing keys that have been rotated out. They verify, never
// sign — which is what lets a key rotate without invalidating a transcript a
// student handed to a college years ago.
function retiredKeys() {
  const out = []
  for (const entry of String(process.env.TRANSCRIPT_RETIRED_PUBLIC_KEYS || '').split(/[\s,]+/)) {
    if (!entry) continue
    const raw = decode32(entry)
    if (!raw) {
      console.error('ignoring malformed entry in TRANSCRIPT_RETIRED_PUBLIC_KEYS')
      continue
    }
    const publicKey = createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, raw]), format: 'der', type: 'spki' })
    out.push({ publicKey, keyId: keyIdFor(publicKey) })
  }
  return out
}

function trustedKeys() {
  const keys = new Map()
  if (hasSigningKey()) {
    const current = currentKey()
    keys.set(current.keyId, { publicKey: current.publicKey, status: 'current' })
  }
  for (const { publicKey, keyId } of retiredKeys()) {
    if (!keys.has(keyId)) keys.set(keyId, { publicKey, status: 'retired' })
  }
  return keys
}

export function publicKeys() {
  return [...trustedKeys()].map(([keyId, { publicKey, status }]) => ({
    key_id: keyId,
    alg: 'Ed25519',
    public_key: rawPublicKey(publicKey).toString('base64url'),
    status,
  }))
}

// RFC 8785 canonical JSON for the value types a transcript holds. Keys sort by
// UTF-16 code unit, which is what Array#sort does by default; numbers use the
// ECMAScript serialization, which is what JSON.stringify does.
export function canonicalJson(value) {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) throw new Error('A transcript cannot contain a non-finite number.')
      return JSON.stringify(value)
    case 'object':
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
      return `{${Object.keys(value)
        .filter((k) => value[k] !== undefined)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
        .join(',')}}`
    default:
      throw new Error(`A transcript cannot contain a ${typeof value}.`)
  }
}

function unsignedBody(doc) {
  const body = { ...doc }
  delete body.signature
  return Buffer.from(canonicalJson(body), 'utf8')
}

export function signTranscript(doc) {
  const key = currentKey()
  if (!key) throw new Error('TRANSCRIPT_SIGNING_KEY is not configured.')
  const value = sign(null, unsignedBody(doc), key.privateKey).toString('base64url')
  const signed = { ...doc }
  delete signed.signature
  return { ...signed, signature: { alg: 'Ed25519', key_id: key.keyId, value } }
}

function invalid(reason) {
  return { valid: false, reason }
}

// Returns { valid: true, keyId, keyStatus } or { valid: false, reason }.
// Never throws: its input is whatever a stranger uploaded.
export function verifyTranscript(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.format !== TRANSCRIPT_FORMAT) {
    return invalid('not_a_transcript')
  }
  if (doc.version !== TRANSCRIPT_VERSION) return invalid('unsupported_version')

  const sig = doc.signature
  if (!sig || sig.alg !== 'Ed25519' || typeof sig.key_id !== 'string' || typeof sig.value !== 'string') {
    return invalid('missing_signature')
  }
  const key = trustedKeys().get(sig.key_id)
  if (!key) return invalid('unknown_key')

  const signature = Buffer.from(sig.value, 'base64url')
  if (signature.length !== 64) return invalid('bad_signature')

  try {
    if (!verify(null, unsignedBody(doc), key.publicKey, signature)) return invalid('bad_signature')
  } catch {
    // Non-canonicalizable content (or absurd nesting) can't have been signed by us.
    return invalid('bad_signature')
  }
  return { valid: true, keyId: sig.key_id, keyStatus: key.status }
}

// Binds a transcript to an email without printing the address in a file the
// student hands around. Deliberately unsalted: the point is that a receiver
// who already knows the address can check it matches.
export function emailHash(email) {
  if (!email) return null
  return createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex')
}
