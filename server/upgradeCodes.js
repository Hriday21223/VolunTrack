import { createHash } from 'crypto'
import { query } from './db.js'

// Club upgrade codes (#892). The admin makes one; a free club's adviser types
// it and the club becomes a school plan, paid outright or on a free trial.
// Only the hash is stored: the full code leaves the server once, in the
// admin's create response.
export const UPGRADE_CODE_LENGTH = 10
export const MAX_TRIAL_DAYS = 365

export function normalizeUpgradeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function hashUpgradeCode(code) {
  return createHash('sha256').update(`voluntrack-upgrade:${normalizeUpgradeCode(code)}`).digest('hex')
}

export function upgradeCodeHint(code) {
  return normalizeUpgradeCode(code).slice(-3)
}

// null, or whole days 1..MAX_TRIAL_DAYS. Anything else is a bad request.
export function readTrialDays(value) {
  if (value == null || value === '' || Number(value) === 0) return { days: null }
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > MAX_TRIAL_DAYS) return { error: `A free trial must be 1 to ${MAX_TRIAL_DAYS} days.` }
  return { days: n }
}

// Spends a code for one school in one UPDATE, so two tries racing on the same
// code can't both win. → { id, trialDays } or null.
export async function claimUpgradeCode(code, schoolId) {
  const normalized = normalizeUpgradeCode(code)
  if (normalized.length !== UPGRADE_CODE_LENGTH) return null
  const { rows } = await query(
    `UPDATE upgrade_codes SET status = 'used', used_at = now(), used_by_school_id = $2
      WHERE code_hash = $1 AND status = 'active' AND expires_at > now()
      RETURNING id, trial_days`,
    [hashUpgradeCode(normalized), schoolId],
  )
  return rows[0] ? { id: rows[0].id, trialDays: rows[0].trial_days } : null
}

export async function releaseUpgradeCode(id) {
  if (!id) return
  await query(`UPDATE upgrade_codes SET status = 'active', used_at = NULL, used_by_school_id = NULL WHERE id = $1 AND status = 'used'`, [id])
}
