// Counselor caseloads (#972): a co-admin can be limited to the students whose
// last names fall in one or more ranges ("A–Chaw", "Che–Gun"), optionally in
// certain grades. Pure, so the unit tests and the app can load it.
//
// A student's last name is the last word of their name, accents stripped,
// letters only, lower case: "María de la Cruz" → "cruz", "Lee-Chaw" → "leechaw".
// A range end matches by prefix, the way counselors write them: "A–Chaw"
// includes "Chawla", and "Che–Gun" starts at "Chen" and includes "Gunn".

export const MAX_RANGES = 5
const MAX_LETTERS = 20

const letters = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '')

export function lastNameKey(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  return words.length ? letters(words[words.length - 1]) : ''
}

// Empty `from` = from A, empty `to` = through Z.
export function inLastNameRange(name, from, to) {
  const key = lastNameKey(name)
  if (!key) return false
  if (from && key < from) return false
  if (to && key.slice(0, to.length) > to) return false
  return true
}

export function inAnyRange(name, ranges) {
  return (ranges || []).some((r) => inLastNameRange(name, r.from, r.to))
}

// Checks the ranges a request sent. → { ranges } (cleaned, lower case; empty
// rows dropped) or { error }.
export function readRanges(input) {
  if (input == null) return { ranges: [] }
  if (!Array.isArray(input)) return { error: 'Send the last-name ranges as a list.' }
  const ranges = []
  for (const r of input) {
    const rawFrom = String(r?.from ?? '').trim()
    const rawTo = String(r?.to ?? '').trim()
    if (!rawFrom && !rawTo) continue
    const from = letters(rawFrom)
    const to = letters(rawTo)
    if ((rawFrom && !from) || (rawTo && !to)) return { error: 'Use letters for the last names, like A to Chaw.' }
    if (from.length > MAX_LETTERS || to.length > MAX_LETTERS) return { error: 'Use at most 20 letters for each end of a range.' }
    if (from && to && from.slice(0, to.length) > to) return { error: `"${rawFrom}" comes after "${rawTo}". Put the earlier name first.` }
    ranges.push({ from, to })
  }
  if (ranges.length > MAX_RANGES) return { error: `Use at most ${MAX_RANGES} ranges.` }
  return { ranges }
}

// "A–Chaw, Ro–Ry" for showing a caseload.
export function rangesLabel(ranges) {
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '')
  return (ranges || []).map((r) => `${cap(r.from) || 'A'}–${cap(r.to) || 'Z'}`).join(', ')
}
