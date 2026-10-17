import { timingSafeEqual } from 'crypto'
import { query, hasDatabase } from './db.js'
import { uid } from './ids.js'
import { hashPassword } from './auth.js'
import { verifyTurnstile } from './turnstile.js'

// The live-check robot's own account (#318), so scripts/live-check.mjs can
// test the pages behind sign-in. A plain student with no school and no data.
//
// The robot can't solve the CAPTCHA, so POST /api/auth/login skips it for one
// request shape only: the x-monitor-key header matches MONITOR_SECRET *and*
// the email is MONITOR_EMAIL. The password is still checked, the rate limits
// still apply, and every other account still needs the CAPTCHA — a leaked key
// gets into an empty test account and nothing else.

const MONITOR_NAME = 'Live Check Robot'

function monitorConfig() {
  const email = String(process.env.MONITOR_EMAIL || '').trim().toLowerCase()
  const password = String(process.env.MONITOR_PASSWORD || '')
  const secret = String(process.env.MONITOR_SECRET || '')
  // @test.com keeps it out of the sign-up counts (server/routes/stats.js).
  if (!email.endsWith('@test.com') || password.length < 20 || secret.length < 32) return null
  if (email === String(process.env.ADMIN_EMAIL || '').trim().toLowerCase()) return null
  return { email, password, secret }
}

function isMonitorLogin(req) {
  const config = monitorConfig()
  if (!config) return false
  const provided = Buffer.from(String(req.get('x-monitor-key') || ''))
  const expected = Buffer.from(config.secret)
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return false
  return String(req.body?.email || '').trim().toLowerCase() === config.email
}

// verifyTurnstile(), except for the robot's own sign-in.
export function turnstileUnlessMonitor() {
  const turnstile = verifyTurnstile()
  return (req, res, next) => (isMonitorLogin(req) ? next() : turnstile(req, res, next))
}

// Creates or refreshes the account on boot, like seedAdmin(). Only ever
// touches an account it made itself — a MONITOR_EMAIL pointed at someone
// else's address is refused, not taken over.
export async function seedMonitor() {
  const config = monitorConfig()
  if (!hasDatabase()) return
  if (!config) {
    if (process.env.MONITOR_EMAIL) {
      console.warn('Monitor account not set up: MONITOR_EMAIL must end in @test.com, MONITOR_PASSWORD be 20+ characters and MONITOR_SECRET 32+.')
    }
    return
  }
  const hash = await hashPassword(config.password)
  const { rows } = await query('SELECT role, name FROM users WHERE email = $1', [config.email])
  if (rows.length > 0) {
    if (rows[0].role !== 'student' || rows[0].name !== MONITOR_NAME) {
      console.warn(`Monitor account not set up: ${config.email} already belongs to another account.`)
      return
    }
    await query('UPDATE users SET password_hash = $1 WHERE email = $2', [hash, config.email])
    return
  }
  await query(
    `INSERT INTO users (id, role, name, email, password_hash) VALUES ($1, 'student', $2, $3, $4)`,
    [uid('usr'), MONITOR_NAME, config.email, hash],
  )
  console.log(`Seeded monitor account: ${config.email}`)
}
