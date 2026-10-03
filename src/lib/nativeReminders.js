import { format } from 'date-fns'
import { isNativeApp } from '@/lib/platform.js'
import { computeNextAt } from '@/lib/scheduler.js'

// Reminders in the Android/iOS apps. The in-app runner (useReminderRunner)
// only fires while the app is open, and the app's WebView has neither
// Notification nor PushManager, so the website's two routes are both closed.
// Instead each enabled reminder's upcoming occurrences are booked with the
// OS as local notifications — computed by the same computeNextAt() the runner
// uses, so start/end windows and monthly day clamping behave identically.
// Nothing leaves the device. No-op on the website.

// Occurrences are booked this far ahead and topped up on every launch, so a
// daily reminder keeps working for weeks even if the app is never reopened.
const HORIZON_DAYS = 45
// Android allows an app 500 pending alarms in total.
const MAX_TOTAL = 400
const DEFAULT_BODY = 'Time to check on your volunteer work.'

async function plugin() {
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  return LocalNotifications
}

// The plugin's 'prompt' / 'prompt-with-rationale' read as the browser's 'default'.
const toPermission = ({ display }) => (display === 'granted' || display === 'denied' ? display : 'default')

/** @returns {Promise<'granted'|'denied'|'default'|'unsupported'>} */
export async function nativeNotificationPermission() {
  if (!isNativeApp) return 'unsupported'
  try { return toPermission(await (await plugin()).checkPermissions()) } catch { return 'unsupported' }
}

// Only ever call this from a tap — never at load.
export async function requestNativeNotificationPermission() {
  if (!isNativeApp) return 'unsupported'
  try { return toPermission(await (await plugin()).requestPermissions()) } catch { return 'default' }
}

/** Every enabled reminder's occurrences between now and the horizon, soonest first. */
export function upcomingOccurrences(reminders, now = new Date()) {
  const horizon = now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000
  const out = []
  for (const reminder of reminders) {
    if (!reminder.enabled) continue
    // computeNextAt() returns the first occurrence strictly after its anchor,
    // so walking it forward from each result lists them in order.
    let from = now
    for (;;) {
      const next = computeNextAt(reminder, from)
      if (!next || new Date(next).getTime() > horizon) break
      out.push({ reminder, fireAt: next })
      from = new Date(next)
    }
  }
  return out.sort((a, b) => a.fireAt.localeCompare(b.fireAt)).slice(0, MAX_TOTAL)
}

// Notification ids are Java ints. Derived from the occurrence key the runner
// already uses, so the same occurrence always gets the same id.
function notificationId(reminderId, fireAt) {
  let h = 0
  for (const c of `${reminderId}@${fireAt}`) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0
  return h & 0x7fffffff
}

let lastSignature = null
let queue = Promise.resolve()

/**
 * Re-books the OS notifications to match `reminders`. Cheap to call often —
 * the runner calls it every minute — because it only touches the OS when the
 * reminders or the day have changed. Without permission it books nothing and
 * never asks (schedule() would otherwise prompt by itself).
 */
export function syncNativeReminders(reminders) {
  if (!isNativeApp) return Promise.resolve()
  queue = queue.then(() => sync(reminders)).catch(() => {})
  return queue
}

async function sync(reminders) {
  const LocalNotifications = await plugin()
  if (toPermission(await LocalNotifications.checkPermissions()) !== 'granted') {
    lastSignature = null // so granting it later books them straight away
    return
  }
  // A new day moves the horizon, so the date is part of the signature.
  const signature = format(new Date(), 'yyyy-MM-dd') + JSON.stringify(reminders)
  if (signature === lastSignature) return

  // Reminders are the app's only local notifications, so everything pending is ours.
  const { notifications: pending } = await LocalNotifications.getPending()
  if (pending.length) await LocalNotifications.cancel({ notifications: pending.map(({ id }) => ({ id })) })

  const notifications = upcomingOccurrences(reminders).map(({ reminder, fireAt }) => ({
    id: notificationId(reminder.id, fireAt),
    title: reminder.title,
    body: reminder.body || DEFAULT_BODY,
    schedule: { at: new Date(fireAt), allowWhileIdle: true },
    // Inexact: a reminder to log hours can be a few minutes late, and an exact
    // alarm would send the user to the system "Alarms & reminders" screen.
    isExactNotification: false,
    extra: { reminderId: reminder.id, fireAt },
  }))
  if (notifications.length) await LocalNotifications.schedule({ notifications })
  lastSignature = signature
}
