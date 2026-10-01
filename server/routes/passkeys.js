// Passkeys as a second factor (WebAuthn). Mounted at /api/auth/passkey,
// ahead of /api/auth — see server.js.
//
// A passkey here is *not* passwordless sign-in: it stands where a TOTP code
// does. POST /api/auth/login answers a correct password with a short-lived
// tempToken and the methods the account has (`methods: ['totp','passkey']`);
// the client then runs /challenge/options + /challenge/verify with that
// token instead of /totp/challenge. Adding one is done while signed in.
//
// Relying-party ID and allowed origins come from server/passkeys.js.

import express from 'express'
import rateLimit from 'express-rate-limit'
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { query, hasDatabase } from '../db.js'
import { uid } from '../ids.js'
import { signToken, verifyTempToken, requireAuth, verifyPassword } from '../auth.js'
import { publicUser } from './auth.js'
import { RP_NAME, rpId, expectedOrigins, userHandle, CHALLENGE_TTL_MS, MAX_PASSKEYS_PER_USER } from '../passkeys.js'

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

async function listFor(userId) {
  const { rows } = await query(
    'SELECT id, transports FROM passkeys WHERE user_id = $1 ORDER BY created_at',
    [userId],
  )
  return rows.map((r) => ({ id: r.id, transports: r.transports || undefined }))
}

async function saveChallenge(userId, purpose, challenge) {
  // Only the newest ceremony of each kind counts; an abandoned one is dropped.
  await query('DELETE FROM webauthn_challenges WHERE user_id = $1 AND purpose = $2', [userId, purpose])
  await query(
    `INSERT INTO webauthn_challenges (id, user_id, purpose, challenge, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' milliseconds')::interval)`,
    [uid('wac'), userId, purpose, challenge, String(CHALLENGE_TTL_MS)],
  )
}

// Single use: the row is deleted whether or not the response then verifies.
async function takeChallenge(userId, purpose) {
  const { rows } = await query(
    `DELETE FROM webauthn_challenges
      WHERE user_id = $1 AND purpose = $2
      RETURNING challenge, expires_at`,
    [userId, purpose],
  )
  const row = rows[0]
  if (!row || new Date(row.expires_at) <= new Date()) return null
  return row.challenge
}

function cleanName(name) {
  const n = typeof name === 'string' ? name.trim().slice(0, 60) : ''
  return n || 'Passkey'
}

// ---------------------------------------------------------------------------
// Managing your passkeys (signed in)
// ---------------------------------------------------------------------------

router.get('/', requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, name, backed_up, created_at, last_used_at
         FROM passkeys WHERE user_id = $1 ORDER BY created_at`,
      [req.auth.sub],
    )
    return res.json({
      passkeys: rows.map((r) => ({
        id: r.id, name: r.name, backedUp: r.backed_up, createdAt: r.created_at, lastUsedAt: r.last_used_at,
      })),
    })
  } catch (error) {
    console.error('passkey list failed:', error)
    return res.status(500).json({ error: 'Could not load passkeys.' })
  }
})

router.post('/register/options', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query('SELECT id, email, name, auth_provider FROM users WHERE id = $1', [req.auth.sub])
    const user = rows[0]
    if (!user) return res.status(404).json({ error: 'Account not found.' })
    // A school-SSO account has no VolunTrack password for a second factor to
    // sit behind; its MFA belongs to the school's identity provider.
    if (user.auth_provider === 'sso') {
      return res.status(400).json({ error: 'Your school manages sign-in for this account.' })
    }
    const existing = await listFor(user.id)
    if (existing.length >= MAX_PASSKEYS_PER_USER) {
      return res.status(400).json({ error: `You can have up to ${MAX_PASSKEYS_PER_USER} passkeys. Remove one first.` })
    }
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: rpId(),
      userID: userHandle(user.id),
      userName: user.email,
      userDisplayName: user.name || user.email,
      attestationType: 'none',
      excludeCredentials: existing,
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    })
    await saveChallenge(user.id, 'register', options.challenge)
    return res.json(options)
  } catch (error) {
    console.error('passkey register options failed:', error)
    return res.status(500).json({ error: 'Could not start passkey setup.' })
  }
})

router.post('/register/verify', limiter, requireDb, requireAuth(), async (req, res) => {
  const { response, name } = req.body || {}
  if (!response || typeof response !== 'object') return res.status(400).json({ error: 'Missing passkey response.' })
  try {
    const challenge = await takeChallenge(req.auth.sub, 'register')
    if (!challenge) return res.status(400).json({ error: 'Passkey setup timed out. Try again.' })
    let verification
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: expectedOrigins(),
        expectedRPID: rpId(),
        requireUserVerification: false,
      })
    } catch (e) {
      return res.status(400).json({ error: `Passkey could not be verified: ${e.message}` })
    }
    if (!verification.verified) return res.status(400).json({ error: 'Passkey could not be verified.' })
    const { credential, credentialBackedUp } = verification.registrationInfo
    await query(
      `INSERT INTO passkeys (id, user_id, public_key, counter, transports, backed_up, name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        credential.id,
        req.auth.sub,
        isoBase64URL.fromBuffer(credential.publicKey),
        credential.counter,
        JSON.stringify(credential.transports || []),
        credentialBackedUp,
        cleanName(name),
      ],
    )
    return res.json({ ok: true, passkey: { id: credential.id, name: cleanName(name) } })
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That passkey is already registered.' })
    console.error('passkey register verify failed:', error)
    return res.status(500).json({ error: 'Could not save passkey.' })
  }
})

// Removing a second factor takes the password, same as turning TOTP off.
router.delete('/:id', limiter, requireDb, requireAuth(), async (req, res) => {
  const password = req.body?.password
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Password is required to remove a passkey.' })
  }
  try {
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.auth.sub])
    if (!rows[0]) return res.status(404).json({ error: 'Account not found.' })
    if (!(await verifyPassword(password, rows[0].password_hash))) {
      return res.status(403).json({ error: 'Incorrect password.' })
    }
    const del = await query('DELETE FROM passkeys WHERE id = $1 AND user_id = $2', [req.params.id, req.auth.sub])
    if (del.rowCount === 0) return res.status(404).json({ error: 'Passkey not found.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('passkey delete failed:', error)
    return res.status(500).json({ error: 'Could not remove passkey.' })
  }
})

// ---------------------------------------------------------------------------
// Second step of sign-in (tempToken from POST /api/auth/login)
// ---------------------------------------------------------------------------

router.post('/challenge/options', limiter, requireDb, async (req, res) => {
  const payload = verifyTempToken(req.body?.tempToken)
  if (!payload) return res.status(401).json({ error: 'Session expired. Please sign in again.' })
  try {
    const allow = await listFor(payload.sub)
    if (allow.length === 0) return res.status(400).json({ error: 'No passkey is set up on this account.' })
    const options = await generateAuthenticationOptions({
      rpID: rpId(),
      allowCredentials: allow,
      userVerification: 'preferred',
    })
    await saveChallenge(payload.sub, 'authenticate', options.challenge)
    return res.json(options)
  } catch (error) {
    console.error('passkey challenge options failed:', error)
    return res.status(500).json({ error: 'Could not start passkey check.' })
  }
})

router.post('/challenge/verify', limiter, requireDb, async (req, res) => {
  const payload = verifyTempToken(req.body?.tempToken)
  if (!payload) return res.status(401).json({ error: 'Session expired. Please sign in again.' })
  const response = req.body?.response
  if (!response || typeof response !== 'object' || typeof response.id !== 'string') {
    return res.status(400).json({ error: 'Missing passkey response.' })
  }
  try {
    const challenge = await takeChallenge(payload.sub, 'authenticate')
    if (!challenge) return res.status(400).json({ error: 'Passkey check timed out. Try again.' })
    // Scoped to the tempToken's account: a passkey belonging to anyone else
    // simply isn't found, so it can't complete this sign-in.
    const { rows } = await query(
      'SELECT id, public_key, counter, transports FROM passkeys WHERE id = $1 AND user_id = $2',
      [response.id, payload.sub],
    )
    const stored = rows[0]
    if (!stored) return res.status(401).json({ error: 'That passkey isn’t registered to this account.' })

    let verification
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: expectedOrigins(),
        expectedRPID: rpId(),
        credential: {
          id: stored.id,
          publicKey: isoBase64URL.toBuffer(stored.public_key),
          counter: Number(stored.counter),
          transports: stored.transports || undefined,
        },
        requireUserVerification: false,
      })
    } catch (e) {
      return res.status(401).json({ error: `Passkey could not be verified: ${e.message}` })
    }
    if (!verification.verified) return res.status(401).json({ error: 'Passkey could not be verified.' })

    await query(
      'UPDATE passkeys SET counter = $1, last_used_at = now() WHERE id = $2',
      [verification.authenticationInfo.newCounter, stored.id],
    )
    const { rows: users } = await query('SELECT * FROM users WHERE id = $1', [payload.sub])
    if (!users[0]) return res.status(404).json({ error: 'Account not found.' })
    const user = publicUser(users[0])
    return res.json({ token: signToken(user), user })
  } catch (error) {
    console.error('passkey challenge verify failed:', error)
    return res.status(500).json({ error: 'Could not verify passkey.' })
  }
})

export default router
