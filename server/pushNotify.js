// Push for bell notifications (#603). notify() (server/notifications.js)
// calls pushNotification() after storing a bell entry; this sends the same
// title and text to the person's phones (push_devices) and browsers
// (push_subscriptions, the web push the reminders already use), unless they
// turned that kind off (users.push_prefs).
//
// Fire-and-forget like notify(): never throws, and a dead token or
// subscription the push service reports as gone is deleted.
import { query } from './db.js'
import { sendNative, fcmConfigured, apnsConfigured } from './nativePush.js'
import { sendPush, pushConfigured } from './push.js'

// Which switch in Settings → Notifications covers each kind. Kinds not listed
// (admin notices and the like) are bell-only.
export const PUSH_GROUPS = {
  hours: ['hours_approved', 'hours_rejected', 'report_approved', 'report_rejected', 'goal_reached', 'reference_received', 'reference_declined'],
  tasks: ['signup_approved', 'signup_rejected', 'waitlist_spot', 'new_task', 'task_alert', 'saved_task_reminder', 'task_thanks', 'task_answer', 'task_question', 'cohost_added', 'volunteer_late', 'volunteer_cancelled_day_of', 'attendance_nudge', 'log_hours_nudge', 'rate_task', 'friend_joined'],
  family: ['parent_cheer', 'parent_ok_request', 'parent_ok_given', 'parent_ok_declined'],
  reminders: ['hours_reminder', 'deadline_reminder', 'comeback_nudge'],
}
export const PUSH_GROUP_NAMES = Object.keys(PUSH_GROUPS)

const GROUP_OF = Object.fromEntries(Object.entries(PUSH_GROUPS).flatMap(([g, kinds]) => kinds.map((k) => [k, g])))

/** Every switch on unless turned off: { hours: true, tasks: true, … }. */
export function cleanPrefs(raw) {
  const out = {}
  for (const g of PUSH_GROUP_NAMES) out[g] = raw?.[g] !== false
  return out
}

export function pushAvailable() {
  return { native: fcmConfigured() || apnsConfigured(), web: pushConfigured() }
}

export async function pushNotification(userId, { kind, title, body, link }) {
  try {
    const group = GROUP_OF[kind]
    if (!group) return
    const { native, web } = pushAvailable()
    if (!native && !web) return
    const { rows: prefRows } = await query('SELECT push_prefs FROM users WHERE id = $1', [userId])
    if (!prefRows[0] || !cleanPrefs(prefRows[0].push_prefs)[group]) return
    const message = { title, body, link: link || '/' }

    if (native) {
      const { rows: devices } = await query('SELECT id, platform, token FROM push_devices WHERE user_id = $1', [userId])
      for (const d of devices) {
        const r = await sendNative(d, message)
        if (r.gone) await query('DELETE FROM push_devices WHERE id = $1', [d.id])
        else if (r.ok) await query('UPDATE push_devices SET last_sent_at = now() WHERE id = $1', [d.id])
        else if (r.error) console.error('native push failed:', r.error)
      }
    }
    if (web) {
      const { rows: subs } = await query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId])
      for (const s of subs) {
        const r = await sendPush(s, { title, body, url: link || '/', tag: `vt-${kind}` })
        if (r.gone) await query('DELETE FROM push_subscriptions WHERE id = $1', [s.id])
        else if (r.ok) await query('UPDATE push_subscriptions SET last_sent_at = now() WHERE id = $1', [s.id])
      }
    }
  } catch (error) {
    console.error('push for notification failed:', error.message)
  }
}
