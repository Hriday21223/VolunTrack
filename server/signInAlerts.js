// New-device sign-in alerts and "sign out everywhere" links (#886).
//
// Each sign-in records the device in known_devices: a hash of a random id the
// app keeps on that device (X-Device-Id, set by src/lib/apiFetch.js on sign-in
// requests), or, when an old app sends none, a hash of the browser/OS label.
// The first time an account that already has a device signs in on a new one,
// its owner is emailed with a one-time link that signs every device out.
import crypto from 'node:crypto'
import { query } from './db.js'
import { endSessions } from './auth.js'
import { sendNewSignInEmail } from './email.js'

const SIGNOUT_LINK_DAYS = 7
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

// "Chrome on macOS". Coarse on purpose: enough to recognise a device, too
// little to fingerprint anyone.
export function deviceLabel(ua) {
  const s = String(ua || '')
  const browser = /Edg\//.test(s) ? 'Edge'
    : /OPR\/|Opera/.test(s) ? 'Opera'
      : /Firefox\//.test(s) ? 'Firefox'
        : /Chrome\//.test(s) ? 'Chrome'
          : /Safari\//.test(s) && /Version\//.test(s) ? 'Safari'
            : /VolunTrack|Capacitor|wv\)/.test(s) ? 'the VolunTrack app'
              : 'a browser'
  const os = /iPhone|iPad|iPod/.test(s) ? 'iOS'
    : /Android/.test(s) ? 'Android'
      : /CrOS/.test(s) ? 'ChromeOS'
        : /Mac OS X|Macintosh/.test(s) ? 'macOS'
          : /Windows/.test(s) ? 'Windows'
            : /Linux/.test(s) ? 'Linux'
              : 'an unknown system'
  return `${browser} on ${os}`
}

function deviceKey(req, userId, label) {
  const id = String(req.get?.('x-device-id') || '')
  return /^[A-Za-z0-9_-]{16,64}$/.test(id) ? `d:${sha256(`${userId}:${id}`)}` : `u:${sha256(`${userId}:${label}`)}`
}

// Records the device behind a finished sign-in and, if it's new for an
// account that has signed in elsewhere before, emails the owner. Never
// throws and isn't awaited by callers: a failed record must not fail a sign-in.
// alert: false for a brand-new account (its first device).
export async function noteSignIn(req, user, { alert = true } = {}) {
  try {
    if (!user?.id) return
    const label = deviceLabel(req.get?.('user-agent'))
    const key = deviceKey(req, user.id, label)
    const { rows } = await query(
      `INSERT INTO known_devices (user_id, device_key, label) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, device_key) DO UPDATE SET last_seen = now(), label = EXCLUDED.label
       RETURNING (xmax = 0) AS inserted`,
      [user.id, key, label],
    )
    if (!alert || !rows[0]?.inserted) return
    const { rows: others } = await query('SELECT 1 FROM known_devices WHERE user_id = $1 AND device_key <> $2 LIMIT 1', [user.id, key])
    if (others.length === 0) return // first device we know of: nothing to compare with
    const { rows: u } = await query('SELECT email, name, language, parental_consent_status FROM users WHERE id = $1', [user.id])
    const row = u[0]
    if (!row?.email || row.parental_consent_status === 'pending') return
    const token = crypto.randomBytes(32).toString('hex')
    await query(
      `INSERT INTO signout_links (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SIGNOUT_LINK_DAYS} days')`,
      [sha256(token), user.id],
    )
    if (/@test\.com$/i.test(row.email)) {
      console.log(`[dev] new sign-in alert for ${row.email} (${label}) — not emailed (@test.com)`)
      return
    }
    await sendNewSignInEmail({ to: row.email, name: row.name, language: row.language, device: label, when: new Date(), token })
  } catch (error) {
    console.error('sign-in alert failed:', error.message)
  }
}

// A sign-out link's account, if it's real and unexpired.
export async function signOutLinkUser(token) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return null
  const { rows } = await query('SELECT user_id FROM signout_links WHERE token_hash = $1 AND expires_at > now()', [sha256(token)])
  return rows[0]?.user_id || null
}

// Spends a sign-out link: every session of that account ends, and every
// other link it had is dropped. → true if it worked.
export async function spendSignOutLink(token) {
  const userId = await signOutLinkUser(token)
  if (!userId) return false
  await endSessions(userId)
  await query('DELETE FROM signout_links WHERE user_id = $1', [userId])
  return true
}
