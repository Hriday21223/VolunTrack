// Skills from volunteering (#605). Pure, and imported by the app too
// (src/lib/skills.js re-exports it), so the Log Hours form and POST|PATCH
// /api/logs clean a list the same way.
//
// A skill is free text so a student can name their own, but the starter list
// covers most entries and keeps reports tidy. Stored English (like categories),
// translated only where shown.

export const STARTER_SKILLS = [
  'Leadership',
  'Teamwork',
  'Communication',
  'Tutoring',
  'Working with children',
  'Working with seniors',
  'Event planning',
  'Organizing',
  'Customer service',
  'Public speaking',
  'First aid',
  'Cooking',
  'Fundraising',
  'Tech help',
  'Bilingual',
  'Problem solving',
]

export const MAX_SKILLS_PER_ENTRY = 6
export const MAX_SKILL_LENGTH = 40

/**
 * Any input → a clean list: strings only, spaces tidied, a starter skill
 * written its canonical way, no duplicates (case-insensitive), at most
 * MAX_SKILLS_PER_ENTRY, each at most MAX_SKILL_LENGTH characters.
 */
export function cleanSkills(input) {
  if (!Array.isArray(input)) return []
  const out = []
  const seen = new Set()
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    let s = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_SKILL_LENGTH).trim()
    if (!s) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    const starter = STARTER_SKILLS.find((k) => k.toLowerCase() === key)
    if (starter) s = starter
    seen.add(key)
    out.push(s)
    if (out.length >= MAX_SKILLS_PER_ENTRY) break
  }
  return out
}

/** Hours per skill over counted logs, most hours first: [{ skill, hours, entries }]. */
export function hoursBySkill(logs) {
  const map = new Map()
  for (const l of logs || []) {
    const hours = Number(l.hours) || 0
    for (const s of cleanSkills(l.skills)) {
      const key = s.toLowerCase()
      const cur = map.get(key) || { skill: s, hours: 0, entries: 0 }
      cur.hours += hours
      cur.entries += 1
      map.set(key, cur)
    }
  }
  return [...map.values()]
    .map((x) => ({ ...x, hours: Math.round(x.hours * 100) / 100 }))
    .sort((a, b) => b.hours - a.hours || a.skill.localeCompare(b.skill))
}
