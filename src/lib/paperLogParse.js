// Turns the text read from a photo of a paper hours log (on the device, by
// Tesseract — #521) into draft entries. Paper logs are tables: one row per
// session with a date, what was done and the hours, in any column order. Each
// line is read on its own; a line needs a date or hours to count. Anything
// unsure is left blank for the student to fill in, never guessed.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n) => String(n).padStart(2, '0')
const SKIP = /^(date|day|activity|hours?|hrs|total|signature|supervisor|name|description|organization|location|time)\b/i

function isRealDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

// A written date without a year is the most recent one that isn't in the future.
function withYear(m, d, today) {
  let y = today.getFullYear()
  const iso = (yy) => `${yy}-${pad(m)}-${pad(d)}`
  if (iso(y) > today.toISOString().slice(0, 10)) y -= 1
  return isRealDate(y, m, d) ? iso(y) : ''
}

function fullYear(y) {
  const n = Number(y)
  return y.length === 2 ? 2000 + n : n
}

// { date, rest }: the first date in the line, and the line without it.
export function findDate(line, today = new Date()) {
  const tries = [
    [/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, (m) => [Number(m[1]), Number(m[2]), Number(m[3])]],
    [/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/, (m) => [fullYear(m[3]), Number(m[1]), Number(m[2])]],
    [/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/, (m) => [Number(m[3]), MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, Number(m[2])]],
    [/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/, (m) => [null, MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, Number(m[2])]],
    [/\b(\d{1,2})\/(\d{1,2})\b/, (m) => [null, Number(m[1]), Number(m[2])]],
  ]
  for (const [re, parts] of tries) {
    const m = re.exec(line)
    if (!m) continue
    const [y, mo, d] = parts(m)
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue
    const date = y == null ? withYear(mo, d, today) : (isRealDate(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : '')
    if (!date) continue
    return { date, rest: line.replace(m[0], ' ') }
  }
  return { date: '', rest: line }
}

function toMinutes(h, m, ampm, fallbackPm) {
  let hour = Number(h)
  const min = Number(m || 0)
  const mer = (ampm || '').toLowerCase()
  if (mer.startsWith('p') && hour < 12) hour += 12
  if (mer.startsWith('a') && hour === 12) hour = 0
  if (!mer && fallbackPm && hour < 12) hour += 12
  return hour * 60 + min
}

// { hours, rest }: hours from "2.5 hrs", "2 h", a time range like
// "9-11:30" or "1:00pm - 3:30pm", or a lone number at the end of the line.
export function findHours(line) {
  const range = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\b/i.exec(line)
  if (range && (range[2] || range[3] || range[5] || range[6])) {
    const start = toMinutes(range[1], range[2], range[3] || '', false)
    let end = toMinutes(range[4], range[5], range[6] || range[3] || '', false)
    if (end <= start) end += 12 * 60
    const hours = (end - start) / 60
    if (hours > 0 && hours <= 24) return { hours: Math.round(hours * 4) / 4, rest: line.replace(range[0], ' ') }
  }
  const labelled = /\b(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:hours?|hrs?\.?|h)\b/i.exec(line)
  const trailing = /(?:^|\s)(\d{1,2}(?:[.,]\d{1,2})?)\s*$/.exec(line)
  // Last: a lone small number between words ("Food bank  3  J. Smith").
  const middle = [...line.matchAll(/(?:^|\s)(\d{1,2}(?:[.,]\d{1,2})?)(?=\s)/g)].pop()
  const m = labelled || trailing || middle
  if (m) {
    let hours = Number(m[1].replace(',', '.'))
    // OCR often drops a decimal point: "2.5" comes back as "25". No one logs
    // 25+ hours in a row, so a two-digit 25–95 ending in 5 is read as x.5.
    if (/^[2-9]5$/.test(m[1])) hours /= 10
    if (hours > 0 && hours <= 24) return { hours: Math.round(hours * 4) / 4, rest: line.slice(0, m.index) + ' ' + line.slice(m.index + m[0].length) }
  }
  return { hours: 0, rest: line }
}

const tidy = (s) => s.replace(/[|_[\]{}<>~*=]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,.;:–-]+|[\s,.;:–-]+$/g, '').trim()

export function parsePaperLog(text, today = new Date()) {
  const entries = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length < 3 || SKIP.test(line)) continue
    const d = findDate(line, today)
    const h = findHours(d.rest)
    if (!d.date && !h.hours) continue
    const activity = tidy(h.rest).slice(0, 200)
    // A bare number with no date and no words is most likely a stray total.
    if (!d.date && !activity) continue
    entries.push({ date: d.date, activity, orgName: '', hours: h.hours, supervisorName: '' })
  }
  return entries.slice(0, 60)
}
