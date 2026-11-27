import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { jsPDF } from 'jspdf'

// The signed service record emailed (as a PDF) to someone who volunteered
// without an account, beside their certificate (routes/school.js,
// POST /public-tasks/:id/email-signups/:signupId): the event, date, place,
// time in, time out and hours as the organizer entered them, signed by the
// organizer and by VolunTrack. English, like the app's other official PDFs.

const here = dirname(fileURLToPath(import.meta.url))
let logo = null
try { logo = `data:image/png;base64,${readFileSync(resolve(here, '../public/logo.png')).toString('base64')}` } catch { /* no logo */ }

/** "14:30" → "2:30 PM". */
export function twelveHour(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''))
  if (!m) return String(hhmm || '')
  const h = Number(m[1])
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

const longDate = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })

/** A Buffer holding the one-page PDF. */
export function serviceRecordPdf({ name, title, date, location, organizer, timeIn, timeOut, hours, recordId, signedAt = new Date() }) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const left = 56
  const right = W - 56
  const green = [39, 84, 45]

  if (logo) { try { doc.addImage(logo, 'PNG', left, 40, 34, 30) } catch { /* skip */ } }
  doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...green)
  doc.text('Volunteer Service Record', logo ? left + 44 : left, 62)
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(110)
  doc.text('VolunTrack', right, 62, { align: 'right' })
  doc.setDrawColor(63, 131, 68).setLineWidth(1.5).line(left, 84, right, 84)

  const rows = [
    ['Volunteer', name],
    ['Event', title],
    ['Organizer', organizer || ''],
    ['Date', longDate(date)],
    ['Location', location || 'Online'],
    ['Time in', twelveHour(timeIn)],
    ['Time out', twelveHour(timeOut)],
    ['Total hours', String(hours)],
  ]
  let y = 120
  for (const [label, value] of rows) {
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(90)
    doc.text(label, left, y)
    doc.setFont('helvetica', 'normal').setFontSize(12).setTextColor(20)
    const lines = doc.splitTextToSize(String(value || ''), right - (left + 120))
    doc.text(lines, left + 120, y)
    y += Math.max(1, lines.length) * 16 + 12
    doc.setDrawColor(225).setLineWidth(0.5).line(left, y - 18, right, y - 18)
  }

  // Signatures: the organizer's (typed, as entered in VolunTrack) and ours.
  y += 40
  const colW = (right - left - 40) / 2
  const sign = (x, signer, role) => {
    doc.setFont('times', 'italic').setFontSize(22).setTextColor(...green)
    doc.text(String(signer || '').slice(0, 40), x + colW / 2, y, { align: 'center' })
    doc.setDrawColor(108, 80, 45).setLineWidth(0.8).line(x, y + 8, x + colW, y + 8)
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(108, 80, 45)
    doc.text(role, x + colW / 2, y + 22, { align: 'center' })
  }
  sign(left, organizer || 'Organizer', 'Organizer')
  sign(left + colW + 40, 'VolunTrack Org', 'VolunTrack')

  y += 64
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(110)
  const when = signedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
  doc.text(doc.splitTextToSize(`Signed electronically by the organizer through VolunTrack on ${when}. The times and hours are as the organizer recorded them.`, right - left), left, y)
  if (recordId) doc.text(`Record ${recordId}`, left, y + 28)
  return Buffer.from(doc.output('arraybuffer'))
}
