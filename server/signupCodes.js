// Email sign-up codes (#310), shared by student/parent/organizer sign-up
// (routes/auth.js) and free club sign-up (routes/school.js, #817): a 6-digit
// code, bcrypt-hashed, 10 minutes, 5 tries, a new one once a minute per
// address, deleted when spent.
import bcrypt from 'bcryptjs'
import { query } from './db.js'
import { generateNumericCode } from './ids.js'
import { sendSignupCodeEmail, hasEmail, forLog } from './email.js'

export const SIGNUP_CODE_TTL_MINUTES = 10
export const SIGNUP_CODE_MAX_ATTEMPTS = 5
export const SIGNUP_CODE_RESEND_SECONDS = 60

// Emails a code to `email`. → { ok: true } or { status, error }.
export async function issueSignupCode(email, language) {
  const devLog = !hasEmail() && process.env.NODE_ENV !== 'production'
  if (!hasEmail() && !devLog) {
    return { status: 503, error: 'We cannot send the verification email right now. Please try again later.' }
  }
  const code = generateNumericCode(6)
  const codeHash = await bcrypt.hash(code, 10)
  // The WHERE on the upsert is the resend limit: a row sent less than a
  // minute ago is left alone and nothing comes back.
  const { rowCount } = await query(
    `INSERT INTO signup_codes (email, code_hash, expires_at, attempts, sent_at)
     VALUES ($1, $2, now() + interval '${SIGNUP_CODE_TTL_MINUTES} minutes', 0, now())
     ON CONFLICT (email) DO UPDATE
       SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0, sent_at = now()
       WHERE signup_codes.sent_at < now() - interval '${SIGNUP_CODE_RESEND_SECONDS} seconds'`,
    [email, codeHash],
  )
  if (rowCount === 0) return { status: 429, error: 'We just sent a code. Wait a minute before asking for another.' }
  if (devLog) {
    console.log(`[dev] No email provider configured — sign-up code for ${forLog(email)}: ${code}`)
    return { ok: true }
  }
  const sent = await sendSignupCodeEmail({ to: email, code, minutes: SIGNUP_CODE_TTL_MINUTES, language })
  if (!sent.sent) {
    await query('DELETE FROM signup_codes WHERE email = $1', [email])
    return { status: 502, error: 'We could not send the verification email. Check the address and try again.' }
  }
  return { ok: true }
}

// Checks and spends the code for `email`. → null when it matched (the row is
// gone, so it can't be used again), otherwise { status, error }.
export async function useSignupCode(email, code) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return { status: 400, error: 'Enter the 6-digit code we emailed you.' }
  }
  const { rows } = await query('SELECT code_hash, expires_at FROM signup_codes WHERE email = $1', [email])
  const row = rows[0]
  if (!row) return { status: 400, error: 'No code is waiting for this email. Ask for a new one.' }
  if (new Date(row.expires_at) < new Date()) {
    await query('DELETE FROM signup_codes WHERE email = $1', [email])
    return { status: 410, error: 'That code expired. Ask for a new one.' }
  }
  // The try is counted before checking, in one step, so guesses sent all at
  // once can't all slip in under the cap.
  const { rows: counted } = await query(
    'UPDATE signup_codes SET attempts = attempts + 1 WHERE email = $1 AND attempts < $2 RETURNING attempts',
    [email, SIGNUP_CODE_MAX_ATTEMPTS],
  )
  if (!counted[0]) return { status: 429, error: 'Too many wrong codes. Ask for a new one.' }
  if (!(await bcrypt.compare(code, row.code_hash))) {
    const left = SIGNUP_CODE_MAX_ATTEMPTS - counted[0].attempts
    return { status: 401, error: left > 0 ? `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Ask for a new one.' }
  }
  // Two requests racing on one good code: only the one that deletes the row wins.
  const spent = await query('DELETE FROM signup_codes WHERE email = $1 AND code_hash = $2', [email, row.code_hash])
  if (spent.rowCount === 0) return { status: 400, error: 'No code is waiting for this email. Ask for a new one.' }
  return null
}
