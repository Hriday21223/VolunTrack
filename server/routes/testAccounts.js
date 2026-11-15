import express from 'express'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import { query, hasDatabase } from '../db.js'
import { requireAuth, signToken, verifyPassword } from '../auth.js'
import { hasPasskeys } from '../passkeys.js'
import { recordAudit, AUDIT } from '../audit.js'
import { ensureLiveTestAccounts, liveTestAccountForRole, LIVE_TEST_ACCOUNTS } from '../liveTestAccounts.js'
import { publicUser, USER_WITH_SCHOOL_SELECT } from './auth.js'

// "Sign in as a test account" on the admin page (#890). The admin tries each
// kind of account on the live site without making one.
//
// What keeps this from being a way into anyone's account:
//   - admin only, and only an admin who has two-step sign-in turned on;
//   - a 6-digit PIN the admin sets (stored as a bcrypt hash; setting it needs
//     the admin's password). Five wrong PINs lock it for 15 minutes;
//   - the account is picked by role from LIVE_TEST_ACCOUNTS, never by id or
//     email from the request, so no real account can be reached;
//   - every sign-in is in the audit log, and the session lasts 2 hours.
const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many tries. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

const PIN_RE = /^[0-9]{6}$/
const MAX_FAILS = 5
const LOCK_MS = 15 * 60 * 1000
const TEST_SESSION_TTL = '2h'
// adminId -> { n, at }: wrong PINs in a row; a run older than LOCK_MS starts over.
const fails = new Map()
function lockedFor(adminId) {
  const f = fails.get(adminId)
  if (!f) return 0
  const left = f.at + LOCK_MS - Date.now()
  if (left <= 0) { fails.delete(adminId); return 0 }
  return f.n >= MAX_FAILS ? left : 0
}
function noteFail(adminId) {
  const f = fails.get(adminId)
  const fresh = !f || Date.now() - f.at > LOCK_MS
  const n = fresh ? 1 : f.n + 1
  fails.set(adminId, { n, at: Date.now() })
  return n
}

async function adminRow(req) {
  const { rows } = await query('SELECT id, password_hash, totp_enabled, test_login_pin_hash FROM users WHERE id = $1 AND role = $2', [req.auth.sub, 'admin'])
  return rows[0] || null
}

async function hasSecondStep(row) {
  if (row.totp_enabled) return true
  try { return await hasPasskeys(row.id) } catch { return false }
}

router.use(limiter, requireDb, requireAuth('admin'))

router.get('/', async (req, res) => {
  try {
    const row = await adminRow(req)
    if (!row) return res.status(403).json({ error: 'Not allowed.' })
    const { rows } = await query('SELECT email FROM users WHERE email = ANY($1)', [LIVE_TEST_ACCOUNTS.map((a) => a.email)])
    const have = new Set(rows.map((r) => r.email))
    return res.json({
      hasPin: Boolean(row.test_login_pin_hash),
      secondStep: await hasSecondStep(row),
      lockedSeconds: Math.ceil(lockedFor(row.id) / 1000),
      accounts: LIVE_TEST_ACCOUNTS.map((a) => ({ role: a.role, name: a.name, email: a.email, exists: have.has(a.email) })),
    })
  } catch (error) {
    console.error('test accounts status failed:', error)
    return res.status(500).json({ error: 'Could not load the test accounts.' })
  }
})

// PUT { pin, password }: set or change the PIN.
router.put('/pin', async (req, res) => {
  try {
    const row = await adminRow(req)
    if (!row) return res.status(403).json({ error: 'Not allowed.' })
    const pin = String(req.body?.pin ?? '')
    if (!PIN_RE.test(pin)) return res.status(400).json({ error: 'The PIN must be exactly 6 digits.' })
    if (/^(\d)\1{5}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) {
      return res.status(400).json({ error: 'Pick a PIN that is harder to guess than 111111 or 123456.' })
    }
    const password = String(req.body?.password || '')
    if (!password || password.length > 128 || !(await verifyPassword(password, row.password_hash))) {
      return res.status(401).json({ error: 'Your current password is not right.' })
    }
    await query('UPDATE users SET test_login_pin_hash = $1 WHERE id = $2', [await bcrypt.hash(pin, 10), row.id])
    fails.delete(row.id)
    recordAudit(req, { action: AUDIT.TEST_ACCOUNT_PIN_SET })
    return res.json({ ok: true, hasPin: true })
  } catch (error) {
    console.error('set test account pin failed:', error)
    return res.status(500).json({ error: 'Could not save the PIN.' })
  }
})

// POST { role, pin } -> { token, user } for that role's test account.
router.post('/sign-in', async (req, res) => {
  try {
    const row = await adminRow(req)
    if (!row) return res.status(403).json({ error: 'Not allowed.' })
    if (!(await hasSecondStep(row))) return res.status(403).json({ error: 'Turn on two-step sign-in for your admin account first.' })
    if (!row.test_login_pin_hash) return res.status(400).json({ error: 'Set a PIN first.' })
    const account = liveTestAccountForRole(String(req.body?.role || ''))
    if (!account) return res.status(400).json({ error: 'Pick one of the five test accounts.' })

    const locked = lockedFor(row.id)
    if (locked) return res.status(429).json({ error: 'Too many wrong PINs.', lockedSeconds: Math.ceil(locked / 1000) })
    const pin = String(req.body?.pin ?? '')
    if (!PIN_RE.test(pin) || !(await bcrypt.compare(pin, row.test_login_pin_hash))) {
      const n = noteFail(row.id)
      recordAudit(req, { action: AUDIT.TEST_ACCOUNT_SIGNIN, outcome: 'denied', meta: { role: account.role } })
      if (n >= MAX_FAILS) return res.status(429).json({ error: 'Too many wrong PINs.', lockedSeconds: LOCK_MS / 1000 })
      return res.status(401).json({ error: 'Wrong PIN.', triesLeft: MAX_FAILS - n })
    }
    fails.delete(row.id)

    await ensureLiveTestAccounts()
    // By the fixed email from the list: never an id or email from the request.
    const { rows } = await query(`${USER_WITH_SCHOOL_SELECT} WHERE u.email = $1`, [account.email])
    const target = rows[0]
    if (!target || !target.email.endsWith('@test.com')) return res.status(500).json({ error: 'Could not find the test account.' })
    const user = publicUser(target)
    recordAudit(req, { action: AUDIT.TEST_ACCOUNT_SIGNIN, subjectUserId: target.id, meta: { role: account.role } })
    return res.json({ token: signToken(user, { expiresIn: TEST_SESSION_TTL, extra: { testBy: row.id } }), user })
  } catch (error) {
    console.error('test account sign-in failed:', error)
    return res.status(500).json({ error: 'Could not sign in as the test account.' })
  }
})

export default router
