// End-of-year packet (#640): one ZIP with everything a school keeps for a
// school year. Built in the browser from the same reports the dashboard
// already shows, so no student data passes through anything new.
//
//   summary.pdf / summary.csv   one row per student
//   all-hours.csv               every entry, with how it was approved
//   approval-history.csv        who approved or sent back what (#638)
//   certificates.pdf            students who met the requirement (schools)
//   students/<name>.pdf         each student's own hours report
//
// An organization gets one folder per school with the same files.
import { zipSync, strToU8 } from 'fflate'
import { exportLogsPDF, schoolHoursCSV, schoolSummaryCSV, schoolHoursPDF, schoolCertificatesPDF } from '@/lib/export.js'
import { csvCell } from '@/lib/csv.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

/** School years, newest first: { label: '2025–26', from: '2025-08-01', to: '2026-07-31' }. */
export function schoolYears(count = 4, today = new Date()) {
  const startYear = today.getMonth() >= 7 ? today.getFullYear() : today.getFullYear() - 1
  return Array.from({ length: count }, (_, i) => {
    const y = startYear - i
    return { label: `${y}–${String(y + 1).slice(2)}`, from: `${y}-08-01`, to: `${y + 1}-07-31` }
  })
}

// File and folder names: no slashes or odd characters, never empty, unique.
function safeName(s, fallback) {
  const clean = String(s || '').normalize('NFKD').replace(/[^\w\s.-]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)
  return clean || fallback
}
function uniqueName(used, name) {
  let n = name
  for (let i = 2; used.has(n.toLowerCase()); i++) n = `${name} (${i})`
  used.add(n.toLowerCase())
  return n
}

async function getJson(path) {
  const res = await fetch(`${apiUrl}${path}`, { headers: auth() })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) { const e = new Error(body.error || 'Request failed.'); e.status = res.status; throw e }
  return body
}

async function approvalHistoryCSV(year) {
  const rows = [['When', 'Student', 'What happened', 'By', 'Who', 'Activity', 'Entry date', 'Hours', 'Note']]
  let before = null
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams({ from: year.from, to: year.to, limit: '200', ...(before ? { before } : {}) })
    let body
    try { body = await getJson(`/school/approval-history?${q}`) } catch { return null }
    for (const e of body.events) {
      rows.push([new Date(e.at).toISOString(), e.studentName, e.event, e.byKind, e.byName || '', e.activity || '', e.logDate || '', e.hours ?? '', e.note || ''])
    }
    if (!body.next) break
    before = body.next
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n')
}

const blobBytes = async (blob) => new Uint8Array(await blob.arrayBuffer())

// One school's files into `files`, under `prefix`.
async function addSchool(files, prefix, { title, students, logs, totals, range }, onStep) {
  files[`${prefix}summary.csv`] = strToU8(schoolSummaryCSV(students))
  files[`${prefix}all-hours.csv`] = strToU8(schoolHoursCSV(logs))
  files[`${prefix}summary.pdf`] = await blobBytes(await schoolHoursPDF({ title, range, students, totals, returnBlob: true }))
  const byStudent = new Map()
  for (const l of logs) byStudent.set(l.studentId, [...(byStudent.get(l.studentId) || []), l])
  const used = new Set()
  let done = 0
  for (const s of students) {
    const mine = byStudent.get(s.studentId) || []
    if (mine.length === 0) continue
    const name = uniqueName(used, safeName(s.name, 'Student'))
    const blob = await exportLogsPDF({ user: { name: s.name, school: s.schoolName }, logs: mine, returnBlob: true })
    files[`${prefix}students/${name}.pdf`] = await blobBytes(blob)
    onStep?.(++done, students.length)
  }
}

/**
 * Builds the packet and returns { blob, filename }. `kind` is 'school' or
 * 'organization'. onStep(done, total) reports progress on the student PDFs.
 */
export async function buildYearEndPacket({ kind, year, onStep }) {
  const q = new URLSearchParams({ from: year.from, to: year.to, approvedOnly: 'false' })
  const report = await getJson(`/school/reports/hours?${q}`)
  if (report.truncated) {
    const e = new Error('This year has too many entries for one packet. Ask us at volunteertrackinfo@gmail.com and we’ll send it.')
    e.code = 'too_big'
    throw e
  }
  const files = {}
  const range = report.range || { from: year.from, to: year.to }
  if (kind === 'organization') {
    const bySchool = new Map()
    for (const s of report.students) bySchool.set(s.schoolName || 'School', [...(bySchool.get(s.schoolName || 'School') || []), s])
    const used = new Set()
    for (const [schoolName, students] of bySchool) {
      const ids = new Set(students.map((s) => s.studentId))
      const logs = report.logs.filter((l) => ids.has(l.studentId))
      const totals = students.reduce((t, s) => ({
        students: t.students + 1,
        logs: t.logs + (Number(s.logCount) || 0),
        totalHours: t.totalHours + (Number(s.totalHours) || 0),
        approvedHours: t.approvedHours + (Number(s.approvedHours) || 0),
        pendingHours: t.pendingHours + (Number(s.pendingHours) || 0),
        rejectedHours: t.rejectedHours + (Number(s.rejectedHours) || 0),
      }), { students: 0, logs: 0, totalHours: 0, approvedHours: 0, pendingHours: 0, rejectedHours: 0 })
      await addSchool(files, `${uniqueName(used, safeName(schoolName, 'School'))}/`, { title: `${schoolName} volunteer hours ${year.label}`, students, logs, totals, range }, onStep)
    }
  } else {
    await addSchool(files, '', { title: `Volunteer hours ${year.label}`, students: report.students, logs: report.logs, totals: report.totals, range }, onStep)
    const history = await approvalHistoryCSV(year)
    if (history) files['approval-history.csv'] = strToU8(history)
    try {
      const progress = await getJson('/school/students/progress')
      const done = (progress.students || []).filter((s) => s.target && s.remaining <= 0)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      if (done.length) {
        files['certificates.pdf'] = await blobBytes(await schoolCertificatesPDF({ schoolName: progress.schoolName, students: done, certificate: progress.certificate }))
      }
    } catch { /* no requirement set: no certificates */ }
  }
  files['README.txt'] = strToU8([
    `VolunTrack end-of-year packet, school year ${year.label} (${year.from} to ${year.to}).`,
    `Made ${new Date().toISOString().slice(0, 10)}.`,
    '',
    'summary.pdf / summary.csv: one row per student.',
    'all-hours.csv: every entry and how it was approved.',
    kind === 'organization' ? 'One folder per school.' : 'approval-history.csv: who approved or sent back each entry.',
    kind === 'organization' ? '' : 'certificates.pdf: students who met the requirement (today\'s totals).',
    'students/: each student\'s own hours report.',
    '',
    'This file contains students\' personal information. Store it securely.',
  ].join('\n'))
  const zip = zipSync(files, { level: 6 })
  return { blob: new Blob([zip], { type: 'application/zip' }), filename: `voluntrack-${kind}-packet-${year.label.replace('–', '-')}.zip` }
}
