import { isYoungGrade } from '@policy'
import { tr } from '@/lib/i18n.js'

// A parent must come with K–5 volunteers when the organizer asks (#649).
// → {} when not needed, { parentComing: name } when given, or null when the
// student cancelled (don't sign up).
export function askParentComing(task, user) {
  if (!task?.young_need_parent || user?.role !== 'student' || !isYoungGrade(user?.grade)) return {}
  const name = window.prompt(tr('A parent or guardian must come with you to this event. Who is coming? (their name)'))
  if (name == null) return null
  const clean = name.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  return { parentComing: clean.slice(0, 80) }
}
