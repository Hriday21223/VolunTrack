// Helpers for a task's optional details (#426). See TaskDetailBadges.jsx.

// The Google Maps link for a task, or null for an online task (no place).
export function taskMapsUrl(task) {
  if (!task || task.is_online) return null
  const q = task.latitude != null && task.longitude != null ? `${task.latitude},${task.longitude}` : encodeURIComponent(task.location || '')
  return `https://www.google.com/maps/search/?api=1&query=${q}`
}

// The fields the post/edit forms keep, from a task row (for Edit and Post again).
export function taskDetailsFromRow(t) {
  return {
    minAge: t?.min_age != null ? String(t.min_age) : '',
    isOnline: Boolean(t?.is_online),
    wheelchairAccessible: t?.wheelchair_accessible || 'unknown',
    accessibilityNote: t?.accessibility_note || '',
  }
}

export const EMPTY_TASK_DETAILS = { minAge: '', isOnline: false, wheelchairAccessible: 'unknown', accessibilityNote: '' }
