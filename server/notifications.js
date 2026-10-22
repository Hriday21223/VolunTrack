import { query, hasDatabase } from './db.js'
import { uid } from './ids.js'

// In-app notifications: the bell in the app header (src/components/
// NotificationBell.jsx, read through server/routes/notifications.js).
//
// notify() is fire-and-forget, like recordAudit(): call it WITHOUT await from
// a request path. It never throws and never rejects, so a failed insert logs
// and is lost rather than turning the action that caused it into a 500.
//
// Entries live NOTIFICATION_RETENTION_DAYS (90). There is no job runner, so
// old rows are pruned opportunistically: the recipient's own on every insert
// (cheap, it's their index), and everyone's on roughly one insert in fifty.

export const NOTIFICATION_RETENTION_DAYS = 90

// Kinds are a closed set so the client can label them (and translate the
// label). Add deliberately, with a label in NotificationBell.jsx.
export const NOTIFICATION_KINDS = new Set([
  'signup_approved',
  'signup_rejected',
  'waitlist_spot',
  'new_task',
  'hours_approved',
  'hours_rejected',
  'hours_reminder',
  'friend_joined',
  'parent_ok_request',
  'parent_ok_given',
  'parent_ok_declined',
  'comeback_nudge',
])

const LIMITS = { title: 200, body: 500, link: 300 }

const clip = (value, max) => {
  const s = String(value ?? '').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

// Only in-app paths ("/attendance", "/opportunities?task=…"): never another
// origin, never "//host", so a notification can't send anyone off-site.
export function safeLink(link) {
  const s = String(link ?? '').trim()
  if (!s.startsWith('/') || s.startsWith('//') || s.includes('\\')) return null
  return clip(s, LIMITS.link)
}

/**
 * Adds one notification to a user's bell.
 * @param {string} userId recipient (users.id)
 * @param {{ kind: string, title: string, body?: string, link?: string }} n
 * @returns {Promise<void>} resolves when stored (or skipped); never rejects.
 */
export async function notify(userId, { kind, title, body, link } = {}) {
  try {
    if (!hasDatabase() || !userId || !NOTIFICATION_KINDS.has(kind) || !title) return
    await query(
      `INSERT INTO notifications (id, user_id, kind, title, body, link)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uid('ntf'), String(userId), kind, clip(title, LIMITS.title), clip(body, LIMITS.body) || null, safeLink(link)],
    )
    await query(
      `DELETE FROM notifications WHERE user_id = $1 AND created_at < now() - interval '${NOTIFICATION_RETENTION_DAYS} days'`,
      [String(userId)],
    )
    if (Math.random() < 0.02) {
      await query(`DELETE FROM notifications WHERE created_at < now() - interval '${NOTIFICATION_RETENTION_DAYS} days'`)
    }
  } catch (error) {
    console.error('notification insert failed:', error.message)
  }
}
