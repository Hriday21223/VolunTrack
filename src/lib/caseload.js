import { tr } from '@/lib/i18n.js'

// Counselor caseloads (#972), shared by CaseloadEditor and the co-admin list.
export const ALL_GRADES = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']

// "Last names A–Chaw, Ro–Z · grades 10, 11, 12" for a saved caseload, or ''.
export function caseloadSummary(ranges, grades) {
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '')
  const parts = []
  if (ranges?.length) parts.push(tr('Last names {ranges}', { ranges: ranges.map((r) => `${cap(r.from) || 'A'}–${cap(r.to) || 'Z'}`).join(', ') }))
  if (grades?.length) parts.push(tr('grades {grades}', { grades: grades.join(', ') }))
  return parts.join(' · ')
}
