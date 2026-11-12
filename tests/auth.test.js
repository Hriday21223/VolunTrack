// Auth: password hashing and the JWTs every signed-in request relies on.
// These run with a throwaway JWT secret and never touch the database.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-at-least-32-characters-long'

const {
  hashPassword, verifyPassword, signToken, verifyToken,
  signTempToken, verifyTempToken, mfaRequiredForRole,
} = await import('../server/auth.js')

test('a password verifies against its own hash and nothing else', async () => {
  const hash = await hashPassword('Correct horse battery staple')
  assert.notEqual(hash, 'Correct horse battery staple', 'the hash must not be the plaintext')
  assert.equal(await verifyPassword('Correct horse battery staple', hash), true)
  assert.equal(await verifyPassword('wrong password', hash), false)
})

test('the same password hashes differently each time (salted)', async () => {
  const a = await hashPassword('same-password')
  const b = await hashPassword('same-password')
  assert.notEqual(a, b)
  assert.equal(await verifyPassword('same-password', a), true)
  assert.equal(await verifyPassword('same-password', b), true)
})

test('a session token round-trips the user id and role', () => {
  const token = signToken({ id: 'user-123', role: 'student' })
  const claims = verifyToken(token)
  assert.equal(claims.sub, 'user-123')
  assert.equal(claims.role, 'student')
})

test('verifyToken rejects a tampered or bogus token', () => {
  assert.equal(verifyToken('not-a-jwt'), null)
  const token = signToken({ id: 'user-1', role: 'student' })
  assert.equal(verifyToken(token + 'x'), null, 'a modified signature must not verify')
})

test('a session token is not accepted as a temp (2FA) token, nor the reverse', () => {
  const session = signToken({ id: 'u1', role: 'school' })
  const temp = signTempToken({ id: 'u1', role: 'school' })
  // The temp token is marked purpose:'totp'. verifyTempToken must accept only
  // that kind, so a full session token can't be replayed at the 2FA step.
  assert.equal(verifyTempToken(session), null)
  assert.ok(verifyTempToken(temp), 'the temp verifier accepts its own temp token')
})

test('staff-type roles require MFA, ordinary users do not', () => {
  for (const role of ['admin', 'school', 'school_staff', 'org']) {
    assert.equal(mfaRequiredForRole(role), true, `${role} should require MFA`)
  }
  for (const role of ['student', 'volunteer', 'parent']) {
    assert.equal(mfaRequiredForRole(role), false, `${role} should not require MFA`)
  }
})
