import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto'

// Symmetric encryption for third-party credentials we must be able to read
// back — currently only SSO client secrets (server/routes/authSso.js). These
// can't be hashed like a password: we have to send the original value to the
// IdP's token endpoint on every login.
//
// APP_ENCRYPTION_KEY should be 32 bytes of base64 or hex (generate with
// `openssl rand -base64 32`). Anything else is accepted and hashed down to 32
// bytes so a hand-typed passphrase still works, but a random key is better.

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16

function key() {
  const raw = process.env.APP_ENCRYPTION_KEY
  if (!raw) {
    throw new Error('APP_ENCRYPTION_KEY is required to store or read SSO client secrets.')
  }
  for (const encoding of ['base64', 'hex']) {
    const buf = Buffer.from(raw, encoding)
    if (buf.length === 32) return buf
  }
  // Not a 32-byte key — derive one so a passphrase still produces a valid key.
  return createHash('sha256').update(raw).digest()
}

export function hasEncryptionKey() {
  return Boolean(process.env.APP_ENCRYPTION_KEY)
}

// Returns "<iv>.<tag>.<ciphertext>", all base64. Storing the iv and tag
// alongside the ciphertext keeps this to a single TEXT column.
export function encryptSecret(plaintext) {
  if (plaintext == null || plaintext === '') return null
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key(), iv)
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.')
}

export function decryptSecret(stored) {
  if (!stored) return null
  const parts = String(stored).split('.')
  if (parts.length !== 3) throw new Error('Stored secret is malformed.')
  const [iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, 'base64'))
  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
    throw new Error('Stored secret is malformed.')
  }
  const decipher = createDecipheriv(ALGORITHM, key(), iv)
  decipher.setAuthTag(tag)
  // Throws if the tag doesn't verify — i.e. the ciphertext was tampered with
  // or APP_ENCRYPTION_KEY changed. Callers surface that as a config error
  // rather than silently falling back to an unauthenticated connection.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
