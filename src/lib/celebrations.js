// Goal reached (#607): which milestone, if any, the Dashboard should celebrate.
// Each one is shown once per device (voluntrack:celebrated). The school
// requirement is also recorded on the server, which tells the parents once
// and answers `first: false` on a second device so it isn't shown there again.

const KEY = 'voluntrack:celebrated'
const MAX_KEPT = 50

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function wasCelebrated(key) {
  return read().includes(key)
}

export function markCelebrated(key) {
  try {
    const list = read().filter((k) => k !== key)
    list.push(key)
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_KEPT)))
  } catch { /* storage blocked: it may show again, which is harmless */ }
}

/**
 * The next milestone to celebrate, or null. The school requirement comes
 * before a personal goal when both are met.
 * @returns {{ kind: 'requirement'|'goal', key: string, hours: number, target: number, title: string } | null}
 */
export function nextCelebration({ requirement, goal }) {
  if (requirement && requirement.target > 0 && requirement.remaining <= 0) {
    const key = `req:${requirement.schoolKey || ''}:${requirement.target}`
    if (!wasCelebrated(key)) {
      return { kind: 'requirement', key, hours: requirement.hours, target: requirement.target, title: requirement.schoolName || '' }
    }
  }
  if (goal && goal.target > 0 && goal.hours >= goal.target) {
    const key = `goal:${goal.id || ''}:${goal.target}`
    if (!wasCelebrated(key)) {
      return { kind: 'goal', key, hours: goal.hours, target: goal.target, title: goal.title || '' }
    }
  }
  return null
}
