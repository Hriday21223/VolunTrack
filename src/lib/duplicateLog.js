// "Did you already log this?" (#636). An entry looks like one already logged
// when it's on the same date, at the same place or for the same activity,
// with about the same hours. Advisory only: the person can still save it
// (two shifts at the same food bank on one day are real).

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9À-ɏ]+/g, ' ').trim()

/** The earlier entry this one looks like, or null. */
export function findLikelyDuplicate(logs, entry, { ignoreId = null } = {}) {
  if (!entry?.date) return null
  const hours = Number(entry.hours) || 0
  const activity = norm(entry.activity)
  const place = norm(entry.location)
  const org = norm(entry.orgName)
  return (logs || []).find((l) => {
    if (!l || l.id === ignoreId || l.date !== entry.date) return false
    if (Math.abs((Number(l.hours) || 0) - hours) > 0.5) return false
    const sameActivity = activity && norm(l.activity) === activity
    const samePlace = place && norm(l.location) === place
    const sameOrg = org && norm(l.orgName) === org
    return Boolean(sameActivity || samePlace || sameOrg)
  }) || null
}
