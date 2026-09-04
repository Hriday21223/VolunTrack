import { useEffect, useRef, useState } from 'react'
import { listReminders, getFired, markFired, createReminder, deleteReminder,
         updateReminder } from '@/api/index.js'
import { dueReminders } from '@/lib/scheduler.js'

/**
 * Identifies a single *occurrence*, not a reminder. Recurring reminders
 * (daily/weekly/monthly) legitimately fire again later, so keying the
 * already-fired list on reminder.id alone would silence every recurrence
 * after the first.
 */
const occurrenceKey = (reminderId, fireAt) => `${reminderId}@${fireAt}`

/**
 * Polls the reminder list every minute. When a reminder crosses its fire time,
 * it dispatches a browser notification (if permission granted) and surfaces
 * an in-app toast via the `fired` state.
 *
 * Deduplication is persisted (`getFired`/`markFired`) rather than held in
 * memory: `lastCheck` resets to now-60s on every mount, so a reload within
 * that window would otherwise re-evaluate — and re-fire — an occurrence that
 * has already been shown.
 */
export function useReminderRunner() {
  const [fired, setFired] = useState([])
  const lastCheck = useRef(Date.now() - 60_000)

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const reminders = listReminders()
      const due = dueReminders(reminders, new Date(lastCheck.current), now)
      if (due.length) {
        const alreadyFired = new Set(getFired())
        const newFired = []
        for (const { reminder, fireAt } of due) {
          const key = occurrenceKey(reminder.id, fireAt)
          if (alreadyFired.has(key)) continue
          markFired(key)
          newFired.push(reminder)
          fireBrowserNotification(reminder)
        }
        if (newFired.length) setFired((prev) => [...prev, ...newFired])
      }
      lastCheck.current = now.getTime()
    }
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [])

  const dismiss = (id) => setFired((prev) => prev.filter((r) => r.id !== id))

  return { fired, dismiss }
}

function fireBrowserNotification(r) {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  try {
    const n = new Notification(r.title, {
      body: r.body || 'Time to check on your volunteer work.',
      icon: '/icon-192.png',
      tag: r.id,
    })
    n.onclick = () => { window.focus(); n.close() }
  } catch {
    // Some browsers throw if the page isn't focused — silently swallow.
  }
}

export async function requestNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission
  }
  try {
    return await Notification.requestPermission()
  } catch {
    return 'default'
  }
}

export const reminderApi = {
  list: listReminders,
  create: createReminder,
  update: updateReminder,
  remove: deleteReminder,
}
