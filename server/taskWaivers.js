// Event waivers (#595). An organizer can put waiver text on a volunteer task;
// VolunTrack shows it and records who agreed, nothing more — the wording is
// the organizer's own. A volunteer agrees by typing their full name at sign-up.
// Someone who says they are under 18 also names a parent or guardian, who gets
// a one-time link (/waiver/<token>) to read it and agree with their own typed
// name. An under-13's sign-up already waits for a parent's OK
// (decideParentOk), and approving it counts as the parent's agreement.
//
// Each agreement keeps the version (a hash of the text) it was given to, so a
// later edit of the waiver shows as "agreed to an earlier version".

import { createHash } from 'crypto'
import validator from 'validator'
import { generateToken } from './ids.js'

export const WAIVER_MAX = 5000
const NAME_MAX = 100

export const waiverVersion = (text) => createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16)
export const hashWaiverToken = (t) => createHash('sha256').update(String(t)).digest('hex')

/** Reads waiverText from a create/edit body: '' clears it. */
export function readWaiverText(raw) {
  if (raw === undefined) return { ok: true, value: undefined }
  if (raw !== null && typeof raw !== 'string') return { ok: false, error: 'The waiver must be text.' }
  const value = String(raw || '').replace(/\r\n/g, '\n').trim()
  if (value.length > WAIVER_MAX) return { ok: false, error: `Keep the waiver to ${WAIVER_MAX} characters.` }
  return { ok: true, value: value || null }
}

const oneLine = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)

/**
 * Reads a volunteer's agreement from a sign-up body: { waiver: { name, minor,
 * parentName, parentEmail } }. `under13` accounts skip the parent's details
 * (their parent's OK is asked for anyway). Answers { ok, agreement } or
 * { ok: false, error, needsWaiver }.
 */
export function readWaiverAgreement(raw, { under13 = false, ownEmail = '' } = {}) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Read and agree to the waiver to sign up.', needsWaiver: true }
  const name = oneLine(raw.name)
  if (name.length < 2) return { ok: false, error: 'Type your full name to agree to the waiver.', needsWaiver: true }
  const minor = under13 || raw.minor === true
  if (!minor || under13) return { ok: true, agreement: { name, minor, parentName: null, parentEmail: null } }
  const parentName = oneLine(raw.parentName)
  const parentEmail = String(raw.parentEmail || '').trim().toLowerCase()
  if (parentName.length < 2) return { ok: false, error: "Add your parent or guardian's name.", needsWaiver: true }
  if (!parentEmail || parentEmail.length > 254 || !validator.isEmail(parentEmail)) return { ok: false, error: "Add your parent or guardian's email.", needsWaiver: true }
  if (ownEmail && parentEmail === String(ownEmail).toLowerCase()) return { ok: false, error: "That's your own email. Add your parent or guardian's.", needsWaiver: true }
  return { ok: true, agreement: { name, minor, parentName, parentEmail } }
}

/**
 * Stores an agreement on a sign-up, inside the caller's transaction. Returns
 * the parent link's token when a parent still has to agree (the caller emails
 * it after committing), else null.
 */
export async function saveWaiverAgreement(db, signupId, waiverText, agreement, { under13 = false } = {}) {
  const needsParentLink = agreement.minor && !under13
  const token = needsParentLink ? generateToken() : null
  await db.query(
    `UPDATE public_task_signups
        SET waiver_name = $2, waiver_at = now(), waiver_version = $3, waiver_minor = $4,
            waiver_parent_name = $5, waiver_parent_email = $6, waiver_parent_token = $7, waiver_parent_at = NULL
      WHERE id = $1`,
    [signupId, agreement.name, waiverVersion(waiverText), agreement.minor, agreement.parentName, agreement.parentEmail, token ? hashWaiverToken(token) : null],
  )
  return token
}

/**
 * Where a sign-up stands on the task's waiver, as SQL over a signup alias and
 * a task alias: 'agreed' | 'waiting_parent' | 'old_version' | 'missing', or
 * NULL when the task has no waiver.
 */
export const WAIVER_STATUS_SQL = (s, t) => `CASE
    WHEN ${t}.waiver_text IS NULL THEN NULL
    WHEN ${s}.waiver_at IS NULL THEN 'missing'
    WHEN ${s}.waiver_minor AND ${s}.waiver_parent_at IS NULL THEN 'waiting_parent'
    WHEN ${s}.waiver_version IS DISTINCT FROM substr(encode(sha256(convert_to(${t}.waiver_text, 'UTF8')), 'hex'), 1, 16) THEN 'old_version'
    ELSE 'agreed' END`
