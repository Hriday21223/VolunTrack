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

/**
 * The certificate itself as a PDF (landscape, the look of the app's printed
 * certificate), so it can be downloaded and printed: name, hours, event and
 * date, signed by the organizer and by VolunTrack.
 */
export function certificatePdf({ name, title, date, organizer, timeIn, timeOut, hours }) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const cx = W / 2
  const green = [39, 84, 45]
  const brown = [108, 80, 45]

  doc.setFillColor(241, 248, 241).rect(0, 0, W, H, 'F')
  doc.setFillColor(255, 255, 255).rect(36, 36, W - 72, H - 72, 'F')
  doc.setDrawColor(63, 131, 68).setLineWidth(3).rect(36, 36, W - 72, H - 72)
  doc.setLineWidth(1).rect(46, 46, W - 92, H - 92)

  let y = 92
  if (logo) { try { doc.addImage(logo, 'PNG', cx - 24, y - 20, 48, 42) } catch { /* skip */ } }
  y += 46
  doc.setFont('helvetica', 'normal').setFontSize(12).setTextColor(...brown)
  doc.text('CERTIFICATE OF SERVICE', cx, y, { align: 'center', charSpace: 2 })
  doc.setFont('helvetica', 'bold').setFontSize(30).setTextColor(...green)
  doc.text('VolunTrack', cx, y + 36, { align: 'center' })
  doc.setFont('helvetica', 'normal').setFontSize(14).setTextColor(58, 48, 36)
  doc.text('This certifies that', cx, y + 74, { align: 'center' })
  doc.setFont('helvetica', 'bold').setFontSize(34).setTextColor(33, 67, 39)
  doc.text(String(name || ''), cx, y + 120, { align: 'center' })
  doc.setFont('helvetica', 'normal').setFontSize(14).setTextColor(58, 48, 36)
  doc.text(`volunteered ${hours} hours at ${title}`, cx, y + 156, { align: 'center', maxWidth: W - 200 })
  doc.text(`on ${longDate(date)}${timeIn && timeOut ? ` (${twelveHour(timeIn)} to ${twelveHour(timeOut)})` : ''}.`, cx, y + 178, { align: 'center' })

  const sy = H - 120
  const colW = 220
  const sign = (x, signer, role) => {
    doc.setFont('times', 'italic').setFontSize(22).setTextColor(...green)
    doc.text(String(signer || '').slice(0, 32), x + colW / 2, sy, { align: 'center' })
    doc.setDrawColor(...brown).setLineWidth(0.8).line(x, sy + 8, x + colW, sy + 8)
    doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(...brown)
    doc.text(role, x + colW / 2, sy + 24, { align: 'center' })
  }
  sign(cx - colW - 40, organizer || 'Organizer', 'Organizer')
  sign(cx + 40, 'VolunTrack Org', 'VolunTrack')
  return Buffer.from(doc.output('arraybuffer'))
}
