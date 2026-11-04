// Paper sign-in sheet (#693): read times off the photographed sheet and match
// them to the event's volunteers. Pure, so it can be checked on its own.
// Handwriting reads badly, so anything unsure is left blank for the organizer.

// "9", "9:05", "9.05", "905", "1430", with an optional am/pm → minutes after
// midnight, or null. A bare hour from 1 to 6 is taken as afternoon, since
// volunteer events rarely start before 7 AM.
export function parseClock(token) {
  const m = /^(\d{1,2})(?:[:.]?(\d{2}))?\s*(a|am|p|pm)?$/i.exec(String(token || '').trim())
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  if (h > 23 || min > 59) return null
  const ap = (m[3] || '').toLowerCase()
  if (ap.startsWith('p') && h < 12) h += 12
  else if (ap.startsWith('a') && h === 12) h = 0
  else if (!ap && h >= 1 && h <= 6) h += 12
  return h * 60 + min
}

const TIME_RE = /\b\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|a|p)\b|\b\d{1,2}[:.]\d{2}\b|\b\d{3,4}\b|\b\d{1,2}\b/gi

export function timesIn(line) {
  // The sheet's row number ("3", "3.", "3)") isn't a time.
  const rest = String(line).replace(/^\s*\d{1,3}[.)]?\s+(?=\D)/, '')
  return (rest.match(TIME_RE) || []).map(parseClock).filter((v) => v !== null)
}

export const toHHMM = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-zÀ-ɏ ]+/g, ' ').replace(/\s+/g, ' ').trim()

// For each volunteer ({ id, name }), the line of OCR text that names them and
// the first two times on it: { [id]: { in: 'HH:MM', out: 'HH:MM' } }. A
// line matches on the full name, or on first name + last initial.
export function matchSheet(text, people) {
  const lines = String(text || '').split(/\n+/).map((l) => ({ raw: l, n: norm(l) })).filter((l) => l.n)
  const out = {}
  for (const p of people) {
    const parts = norm(p.name).split(' ').filter(Boolean)
    if (parts.length === 0) continue
    const full = parts.join(' ')
    const first = parts[0]
    const lastInitial = parts.length > 1 ? parts[parts.length - 1][0] : ''
    const line = lines.find((l) => l.n.includes(full))
      || lines.find((l) => new RegExp(`\\b${first}\\b`).test(l.n) && (!lastInitial || new RegExp(`\\b${first} ${lastInitial}`).test(l.n)))
    if (!line) continue
    const t = timesIn(line.raw)
    if (t.length < 2) continue
    let [a, b] = t
    if (b <= a && b + 12 * 60 > a && b < 12 * 60) b += 12 * 60
    if (b <= a) continue
    out[p.id] = { in: toHHMM(a), out: toHHMM(b) }
  }
  return out
}
