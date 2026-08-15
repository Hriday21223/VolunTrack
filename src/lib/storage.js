// Lightweight, safe-for-the-browser wrapper around localStorage with namespacing.
const NS = 'voluntrack:'

export const keys = {
  user:         `${NS}user`,
  users:        `${NS}users`,          // list of registered accounts
  logs:         `${NS}logs`,
  goals:        `${NS}goals`,
  achievements: `${NS}achievements`,   // earned badge ids
  theme:        `${NS}theme`,
  reminders:    `${NS}reminders`,
  fired:        `${NS}fired-reminders`, // dedupe list of reminder ids that already fired this cycle
  reviews:      `${NS}reviews`,          // list of review submissions
  reviewDismissed: `${NS}review-dismissed`, // set when the user closes the review prompt without submitting
}

export function read(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    // Most often: QuotaExceededError from a too-large proof image.
    console.warn('voluntrack: storage write failed', err)
    throw err
  }
}

export function remove(key) {
  localStorage.removeItem(key)
}
