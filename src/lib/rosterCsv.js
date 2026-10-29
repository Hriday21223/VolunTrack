// Reading a school's roster for Invite a whole class (#584). A roster with a
// header row gives names and grades as well as emails; anything else (a pasted
// list, a CSV without headers) falls back to every email address in the text.

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const ONE_EMAIL = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i

/** Every email address in some text, lower-cased, without repeats. */
export function emailsIn(text) {
  return [...new Set((String(text || '').match(EMAIL_RE) || []).map((e) => e.toLowerCase()))]
}

/** Split CSV text into rows of cells, honoring quotes ("a, b" and ""). */
export function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  const s = String(text || '').replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"' && cell === '') quoted = true
    else if (c === ',' || c === ';' || c === '\t') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.map((r) => r.map((v) => v.trim())).filter((r) => r.some(Boolean))
}

const norm = (h) => h.toLowerCase().replace(/[^a-z]/g, '')

function findColumns(header) {
  const h = header.map(norm)
  const pick = (test) => h.findIndex(test)
  const email = pick((x) => /^(student)?e?mail(address)?$|^email/.test(x))
  if (email < 0) return null
  return {
    email,
    name: pick((x) => /^(student|full)?name$|^studentfullname$/.test(x)),
    first: pick((x) => /^(student)?(first|given)(name)?$|^preferredname$/.test(x)),
    last: pick((x) => /^(student)?(last|family|sur)(name)?$/.test(x)),
    grade: pick((x) => /^(current)?grade(level)?$|^gradelevel$|^yearlevel$/.test(x)),
  }
}

// "Rivera, Maya" → "Maya Rivera"; anything else as given.
function tidyName(name) {
  const m = /^([^,]+),\s*([^,]+)$/.exec(name)
  return m ? `${m[2]} ${m[1]}` : name
}

/**
 * Read a roster: { students: [{ email, name, grade }], columns } where
 * `columns` says which of name and grade were found (null without a header).
 */
export function readRoster(text) {
  const rows = parseCsv(text)
  const headerAt = rows.findIndex((r, i) => i < 5 && findColumns(r))
  if (headerAt < 0) return { students: emailsIn(text).map((email) => ({ email, name: '', grade: '' })), columns: null }
  const cols = findColumns(rows[headerAt])
  const seen = new Map()
  for (const r of rows.slice(headerAt + 1)) {
    const email = String(r[cols.email] || '').toLowerCase()
    if (!ONE_EMAIL.test(email)) continue
    const at = (i) => (i >= 0 ? String(r[i] || '').trim() : '')
    const name = at(cols.name) ? tidyName(at(cols.name)) : [at(cols.first), at(cols.last)].filter(Boolean).join(' ')
    seen.set(email, { email, name: name.slice(0, 100), grade: at(cols.grade).slice(0, 30) })
  }
  return {
    students: [...seen.values()],
    columns: { name: cols.name >= 0 || cols.first >= 0 || cols.last >= 0, grade: cols.grade >= 0 },
  }
}

/**
 * Combine what was pasted with a picked file. Pasted addresses keep any name
 * and grade a file gave them.
 */
export function mergeRoster(fileStudents, pastedText) {
  const byEmail = new Map(fileStudents.map((s) => [s.email, s]))
  for (const email of emailsIn(pastedText)) if (!byEmail.has(email)) byEmail.set(email, { email, name: '', grade: '' })
  return [...byEmail.values()]
}
