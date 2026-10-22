// How far a personal goal has got. A goal may name one cause (a category from
// src/lib/categories.js, e.g. "20 hours in Environmental"); then only logs in
// that category count toward it. A goal with no category counts every hour,
// exactly as goals always have. Pass logs already through countedLogs(), so
// rejected hours stay out.

export function goalCategory(goal) {
  return typeof goal?.category === 'string' && goal.category ? goal.category : null
}

export function logsForGoal(goal, logs) {
  const category = goalCategory(goal)
  const list = logs || []
  return category ? list.filter((l) => l.category === category) : list
}

export function hoursForGoal(goal, logs) {
  return logsForGoal(goal, logs).reduce((s, l) => s + (Number(l.hours) || 0), 0)
}
