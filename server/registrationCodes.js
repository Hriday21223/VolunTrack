import { createHash } from 'crypto'
import { query } from './db.js'

// One-time registration codes (#287). A school or organization can only
// register with one of these or with an invite link — both are issued by us
// (or, for a school, by its organization), so nobody becomes a customer
// without having talked to us first.
//
// Only the hash is stored. The plaintext leaves the server exactly once, in
// the admin's create response.

export const REGISTRATION_CODE_KINDS = ['school', 'organization']
export const DEFAULT_CODE_TTL_DAYS = 14
export const MAX_CODE_TTL_DAYS = 90

export const CODE_REQUIRED_MESSAGE = {
  school: 'School accounts are set up with a one-time code from VolunTrack. Contact us to get one.',
  organization: 'Organization accounts are set up with a one-time code or invite from VolunTrack. Contact us to get started.',
}
export const CODE_REJECTED_MESSAGE = 'That registration code is invalid, expired, or already used.'

// Case, spaces and dashes don't matter — "k7xq 2m9p-rt4w8hnc" is the same
// code as "K7XQ-2M9P-RT4W-8HNC".
export function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function hashCode(code) {
  return createHash('sha256').update(`voluntrack-registration:${normalizeCode(code)}`).digest('hex')
}

export function codeHint(code) {
  return normalizeCode(code).slice(-4)
}

// Atomically spends a code: one UPDATE that only matches an active,
// unexpired code of the right kind, so two sign-ups racing on the same code
// can't both win. Returns the code's id, or null if it can't be used.
// Call it after every other check on the request has passed, so a typo in
// the email doesn't consume the customer's code.
export async function claimCode(kind, code) {
  const normalized = normalizeCode(code)
  if (normalized.length !== 16) return null
  const { rows } = await query(
    `UPDATE registration_codes
        SET status = 'used', used_at = now()
      WHERE code_hash = $1 AND kind = $2 AND status = 'active' AND expires_at > now()
      RETURNING id`,
    [hashCode(normalized), kind],
  )
  return rows[0]?.id || null
}

// Gives a claimed code back when the registration it was claimed for fails
// afterwards, so a server error doesn't cost the customer their code.
export async function releaseCode(id) {
  if (!id) return
  await query(
    `UPDATE registration_codes SET status = 'active', used_at = NULL, used_by_user_id = NULL
      WHERE id = $1 AND status = 'used' AND used_by_user_id IS NULL`,
    [id],
  )
}

export async function markCodeUser(id, userId) {
  if (!id) return
  await query('UPDATE registration_codes SET used_by_user_id = $1 WHERE id = $2', [userId, id])
}
