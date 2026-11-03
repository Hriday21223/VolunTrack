// Reading another tracker's export (#657): x2VOL, MobileServe or any
// spreadsheet. Columns are found by name; dates may be YYYY-MM-DD or US style.
import { parseCsv } from '@/lib/rosterCsv.js'

const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z]/g, '')
const COLUMNS = {
  email: (x) => /email/.test(x),
  date: (x) => /^(service|activity|event|volunteer)?date(served|ofservice)?$|^date/.test(x),
  activity: (x) => /^(activity|description|event|eventname|opportunity|task|title|servicedescription|activityname)$/.test(x),
  hours: (x) => /^(hours|hoursserved|totalhours|servicehours|duration|hrs)$/.test(x),
  orgName: (x) => /^(organization|organisation|org|agency|nonprofit|organizationname|site|location)$/.test(x),
  category: (x) => /^(category|type|cause)$/.test(x),
  notes: (x) => /^(notes|comments|comment|reflection)$/.test(x),
}

/** "9/14/2026", "09-14-26", "2026-09-14" → "2026-09-14" (or '' when unreadable). */
export function toIsoDate(value) {
  const v = String(value || '').trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(v)
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  }
  return ''
}

/** → { rows, missing: [column names not found] } */
export function readHoursFile(text) {
  const table = parseCsv(text)
  if (table.length < 2) return { rows: [], missing: ['email', 'date', 'activity', 'hours'] }
  const header = table[0].map(norm)
  const idx = {}
  for (const [key, test] of Object.entries(COLUMNS)) idx[key] = header.findIndex(test)
  const missing = ['email', 'date', 'activity', 'hours'].filter((k) => idx[k] < 0)
  if (missing.length) return { rows: [], missing }
  const cell = (r, k) => (idx[k] >= 0 ? r[idx[k]] || '' : '')
  const rows = table.slice(1).map((r) => ({
    email: cell(r, 'email').toLowerCase(),
    date: toIsoDate(cell(r, 'date')),
    activity: cell(r, 'activity'),
    hours: Number(String(cell(r, 'hours')).replace(/[^\d.]/g, '')),
    orgName: cell(r, 'orgName'),
    category: cell(r, 'category'),
    notes: cell(r, 'notes'),
  }))
  return { rows, missing: [] }
}
