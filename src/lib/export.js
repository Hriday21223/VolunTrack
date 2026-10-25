import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { fmtDate, fmtDateTime, fmtHours, hoursBetween } from '@/utils/date.js'
import { csvCell } from '@/lib/csv.js'
import { countedLogs } from '@/lib/achievements.js'
import { guestSheetRows } from '@/lib/guests.js'

// The VolunTrack logo is fetched once and cached as a data URL so every PDF
// (service log, invoice) can stamp it in the header — keep this on every
// export, never drop it even when reworking the header layout.
let logoDataUrlPromise = null
function getLogoDataUrl() {
  if (!logoDataUrlPromise) {
    logoDataUrlPromise = fetch(`${import.meta.env.BASE_URL}logo.png`)
      .then((res) => res.blob())
      .then((blob) => new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      }))
      .catch(() => null)
  }
  return logoDataUrlPromise
}

const LOGO_W = 34
const LOGO_H = 30 // matches logo.png's 384x338 aspect ratio

/** Generate a printable PDF report for the user's logs. When `returnBlob` is true, returns the PDF blob instead of downloading. */
// Customers usually hand over a number that already starts with "PO", and
// prefixing that printed "PO PO-2026-0042".
export function poLabel(poNumber) {
  const value = String(poNumber || '').trim()
  return /^p\.?o\b/i.test(value) ? value : `PO ${value}`
}

export async function exportLogsPDF({ user, logs, returnBlob }) {
  const doc = new jsPDF({ unit: 'pt', orientation: 'landscape' })
  // Rejected entries stay in the table with their status, but not in the total.
  const total = countedLogs(logs).reduce((s, l) => s + (Number(l.hours) || 0), 0)
  const logo = await getLogoDataUrl()

  // Header
  if (logo) {
    try { doc.addImage(logo, 'PNG', 40, 20, LOGO_W, LOGO_H) } catch { /* malformed data URL — skip logo, keep header text */ }
  }
  doc.setFont('helvetica', 'bold').setFontSize(20)
  doc.text('Volunteer Service Log', logo ? 40 + LOGO_W + 10 : 40, 50)
  doc.setFont('helvetica', 'normal').setFontSize(11)
  doc.setTextColor(90)
  doc.text(user?.name || 'Volunteer', 40, 70)
  const idLine = [user?.school, user?.studentIdNumber ? `ID: ${user.studentIdNumber}` : null].filter(Boolean).join('  •  ')
  if (idLine) doc.text(idLine, 40, 86)
  doc.text(`Generated ${new Date().toLocaleDateString()}`, 40, 102)
  doc.setTextColor(0)
  doc.setFont('helvetica', 'bold').setFontSize(13)
  doc.text(`Total: ${fmtHours(total)}`, 420, 70, { align: 'left' })

  autoTable(doc, {
    startY: 120,
    head: [['Date', 'Activity', 'Category', 'Time', 'Hours', 'Location', 'Organization', 'Org Phone', 'Org Address', 'Supervisor', 'Supervisor Email', 'Notes', 'Supervisor Signature', 'Student Signature']],
    body: logs.map((l) => [
      fmtDate(l.date),
      l.activity || '',
      l.category || '',
      l.startTime && l.endTime ? `${l.startTime}–${l.endTime}` : '',
      fmtHours(Number(l.hours) || 0),
      l.location || '',
      l.orgName || '',
      l.orgPhone || '',
      l.orgAddress || '',
      l.supervisorName || '',
      l.supervisorEmail || '',
      l.notes || '',
      '', // filled in by didDrawCell below — autoTable can't take an image as cell content directly
      '', // student's own signature, when their school asks for one — same treatment
    ]),
    headStyles: { fillColor: [63, 131, 68], fontSize: 8 },
    styles: { fontSize: 7.5, cellPadding: 4, minCellHeight: 28, overflow: 'linebreak' },
    alternateRowStyles: { fillColor: [241, 248, 241] },
    columnStyles: { 12: { cellWidth: 65 }, 13: { cellWidth: 65 } },
    didDrawCell: (data) => {
      if (data.section !== 'body' || (data.column.index !== 12 && data.column.index !== 13)) return
      const log = logs[data.row.index]
      const sig = data.column.index === 12 ? log?.supervisorSignature : log?.studentSignature
      if (!sig) return
      try {
        const h = data.cell.height - 8
        const w = h * (400 / 150) // matches SignaturePad's fixed export aspect ratio
        doc.addImage(sig, 'PNG', data.cell.x + 4, data.cell.y + 4, Math.min(w, data.cell.width - 8), h)
      } catch {
        // best-effort — a malformed data URL just leaves the cell blank
      }
    },
  })

  if (returnBlob) {
    return doc.output('blob')
  }
  doc.save('volunteer-log.pdf')
}

const BILLING_PERIOD_LABELS = { monthly: '/ month', yearly: '/ year', one_time: 'one-time' }

/** Generate a PDF for a single invoice. When `returnBlob` is true, returns the PDF blob instead of downloading. */
export async function generateInvoicePDF({ invoiceNumber, poNumber, entityName, accountCode, amount, subtotal, discountLabel, billingPeriod, description, dueDate, createdAt, returnBlob }) {
  const doc = new jsPDF({ unit: 'pt', orientation: 'portrait' })
  const logo = await getLogoDataUrl()

  if (logo) {
    try { doc.addImage(logo, 'PNG', 40, 20, LOGO_W, LOGO_H) } catch { /* malformed data URL — skip logo, keep header text */ }
  }
  doc.setFont('helvetica', 'bold').setFontSize(20)
  doc.text('VolunTrack', logo ? 40 + LOGO_W + 10 : 40, 50)
  doc.setFont('helvetica', 'normal').setFontSize(11)
  doc.setTextColor(90)
  doc.text('INVOICE', 40, 70)
  doc.setTextColor(0)

  doc.setFont('helvetica', 'bold').setFontSize(13)
  doc.text(invoiceNumber, 400, 50, { align: 'left' })
  doc.setFont('helvetica', 'normal').setFontSize(10)
  doc.setTextColor(90)
  doc.text(`Issued ${createdAt ? new Date(createdAt).toLocaleDateString() : new Date().toLocaleDateString()}`, 400, 66)
  if (dueDate) doc.text(`Due ${fmtDate(String(dueDate).slice(0, 10))}`, 400, 80)
  if (poNumber) doc.text(poLabel(poNumber), 400, dueDate ? 94 : 80)
  doc.setTextColor(0)

  doc.setFont('helvetica', 'bold').setFontSize(12)
  doc.text('Bill to', 40, 110)
  doc.setFont('helvetica', 'normal').setFontSize(11)
  doc.text(entityName || '', 40, 126)
  if (accountCode) {
    doc.setFontSize(10).setTextColor(90)
    doc.text(`Account ID: ${accountCode}`, 40, 140)
    doc.setFontSize(11).setTextColor(0)
  }

  const periodLabel = BILLING_PERIOD_LABELS[billingPeriod] || ''
  // A discounted invoice has to show its own arithmetic: list price, what came
  // off, and what is owed. Without a discount the table stays the single line
  // it has always been.
  const discounted = Boolean(discountLabel) && Number(subtotal) > Number(amount)
  const listPrice = discounted ? Number(subtotal) : Number(amount)
  const body = [[description || 'VolunTrack subscription', `$${listPrice.toFixed(2)}${periodLabel ? ' ' + periodLabel : ''}`]]
  if (discounted) {
    body.push([discountLabel, `-$${(Number(subtotal) - Number(amount)).toFixed(2)}`])
  }
  autoTable(doc, {
    startY: accountCode ? 164 : 150,
    head: [['Description', 'Amount']],
    body,
    headStyles: { fillColor: [63, 131, 68] },
    styles: { fontSize: 10, cellPadding: 8 },
    columnStyles: { 1: { halign: 'right' } },
  })

  const finalY = doc.lastAutoTable.finalY + 24
  doc.setFont('helvetica', 'bold').setFontSize(12)
  doc.text(`Total: $${Number(amount).toFixed(2)}${periodLabel ? ' ' + periodLabel : ''}`, 400, finalY, { align: 'left' })

  if (returnBlob) {
    return doc.output('blob')
  }
  doc.save(`${invoiceNumber}.pdf`)
}

/** Build a CSV string from the user's logs. */
export function exportLogsCSV(logs) {
  const rows = [
    ['Date', 'Activity', 'Category', 'Hours', 'Start', 'End', 'Location', 'Organization', 'Org Address', 'Org Phone', 'Supervisor', 'Signed', 'Verified', 'Notes', 'Reflection'],
    ...logs.map((l) => [
      l.date || '',
      l.activity || '',
      l.category || '',
      l.hours ?? '',
      l.startTime || '',
      l.endTime || '',
      l.location || '',
      l.orgName || '',
      l.orgAddress || '',
      l.orgPhone || '',
      l.supervisorName || '',
      l.supervisorSignature ? 'yes' : 'no',
      l.verified ? 'yes' : 'no',
      (l.notes || '').replaceAll(/\n/g, ' '),
      (l.reflection || '').replaceAll(/\n/g, ' '),
    ]),
  ]
  return rows.map((r) => r.map(csvCell).join(',')).join('\n')
}

/** Printable certificate — opens the browser print dialog. */
export function printCertificate({ user, totalHours, goalReached }) {
  const w = window.open('', '_blank', 'width=820,height=1000')
  if (!w) return
  const name = user?.name || 'Volunteer'
  const school = user?.school || ''
  const issuedDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  w.document.write(`
    <html><head><title>Certificate of Service</title>
    <style>
      body { font-family: 'Plus Jakarta Sans', Inter, sans-serif; background:#f1f8f1;
             margin:0; padding:40px; display:flex; align-items:center; justify-content:center; min-height:100vh; }
      .frame { background:white; border:8px double #3f8344; padding:48px 64px; max-width:720px; text-align:center; }
      h1 { color:#27542d; font-size:36px; margin:0 0 8px; letter-spacing:1px; }
      .sub { color:#6c502d; font-size:14px; letter-spacing:2px; text-transform:uppercase; }
      .name { font-size:42px; color:#214327; margin:24px 0 8px; font-weight:700; }
      .body { color:#3a3024; font-size:15px; line-height:1.6; margin-top:16px; }
      .hours { font-size:28px; color:#3f8344; margin:24px 0; font-weight:700; }
      .sig { margin-top:48px; display:flex; justify-content:space-between; color:#6c502d; font-size:13px; }
      .sig div { text-align:center; }
      .sig-value { margin-bottom:6px; white-space:nowrap; }
      .sig-line { border-top:1px solid #6c502d; padding-top:6px; width:200px; }
      .signature { font-family:'Brush Script MT','Segoe Script',cursive; font-size:20px; color:#214327; }
    </style></head>
    <body>
      <div class="frame">
        <img src="${window.location.origin}${import.meta.env.BASE_URL}logo.png" alt="VolunTrack" style="width:64px;height:auto;margin:0 auto 12px;display:block;" />
        <div class="sub">Certificate of Service</div>
        <h1>VolunTrack</h1>
        <div class="body">This certifies that</div>
        <div class="name">${escapeHtml(name)}</div>
        ${school ? `<div class="body">${escapeHtml(school)}</div>` : ''}
        <div class="body">has generously contributed</div>
        <div class="hours">${fmtHours(totalHours)} of volunteer service</div>
        <div class="body">
          ${goalReached
            ? 'and has reached their service goal — a true community hero.'
            : 'in service of their community.'}
        </div>
        <div class="sig">
          <div>
            <div class="sig-value">${escapeHtml(issuedDate)}</div>
            <div class="sig-line">Date</div>
          </div>
          <div>
            <div class="sig-value signature">VolunTrack Org</div>
            <div class="sig-line">VolunTrack</div>
          </div>
        </div>
      </div>
      <script>window.onload=()=>window.print();</script>
    </body></html>
  `)
  w.document.close()
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}

/* ---------- Bulk school/organization hour reports (#142) ---------- */

// signedHow codes from the school hours report (server/routes/school.js).
const SIGNED_HOW_LABELS = {
  organizer: 'Signed by task organizer in VolunTrack',
  in_person: 'Signed in person',
  student_link: 'Link sent by student',
  emailed: 'Emailed by VolunTrack',
}

// What the report screen calls each stored verification status. Anything
// not yet decided (`none`, `pending`) counts as pending, as it does in the
// report's totals.
const VERIFICATION_LABELS = { approved: 'Approved', rejected: 'Rejected' }

/**
 * Detail CSV — one row per log, for spreadsheets. Uses the same csvCell
 * escaping as exportLogsCSV so a comma in an activity name can't shift
 * columns.
 */
export function schoolHoursCSV(logs) {
  const rows = [
    ['School', 'Student', 'Email', 'Grade', 'Date', 'Activity', 'Category', 'Hours', 'Status', 'Signed how', 'Organization', 'Supervisor', 'Location', 'Notes'],
    ...logs.map((l) => [
      l.schoolName || '',
      l.studentName || '',
      l.studentEmail || '',
      l.grade || '',
      l.date || '',
      l.activity || '',
      l.category || '',
      l.hours ?? '',
      VERIFICATION_LABELS[l.verificationStatus] || 'Pending',
      SIGNED_HOW_LABELS[l.signedHow] || '',
      l.orgName || '',
      l.supervisorName || '',
      l.location || '',
      String(l.notes || '').replaceAll('\n', ' '),
    ]),
  ]
  return rows.map((r) => r.map(csvCell).join(',')).join('\n')
}

/** Summary CSV — one row per student. */
export function schoolSummaryCSV(students) {
  const rows = [
    ['School', 'Student', 'Email', 'Grade', 'Logs', 'Approved Hours', 'Pending Hours', 'Total Hours', 'Rejected Hours'],
    ...students.map((s) => [
      s.schoolName || '', s.name || '', s.email || '', s.grade || '',
      s.logCount ?? 0, s.approvedHours ?? 0, s.pendingHours ?? 0, s.totalHours ?? 0, s.rejectedHours ?? 0,
    ]),
  ]
  return rows.map((r) => r.map(csvCell).join(',')).join('\n')
}

/**
 * Per-student summary PDF — the version handed to an administrator, so it
 * leads with the totals and keeps approved and pending in separate columns
 * rather than presenting one blended number.
 */
export async function schoolHoursPDF({ title, range, students, totals, returnBlob }) {
  const doc = new jsPDF({ unit: 'pt', orientation: 'landscape' })
  const logo = await getLogoDataUrl()
  if (logo) {
    try { doc.addImage(logo, 'PNG', 40, 28, LOGO_W, LOGO_H) } catch { /* logo optional */ }
  }

  doc.setFontSize(16)
  doc.text(title || 'Volunteer hours report', logo ? 84 : 40, 48)
  doc.setFontSize(10)
  doc.setTextColor(90)
  doc.text(
    `${fmtDate(range.from)} — ${fmtDate(range.to)}${range.approvedOnly ? '  ·  approved hours only' : ''}`,
    logo ? 84 : 40, 64,
  )
  doc.text(
    `${totals.students} ${totals.students === 1 ? 'student' : 'students'}  ·  ${totals.logs} ${totals.logs === 1 ? 'entry' : 'entries'}  ·  ${fmtHours(totals.approvedHours)} approved + ${fmtHours(totals.pendingHours)} pending = ${fmtHours(totals.totalHours)} total${totals.rejectedHours ? `  ·  ${fmtHours(totals.rejectedHours)} rejected (excluded)` : ''}`,
    logo ? 84 : 40, 78,
  )
  doc.setTextColor(0)

  autoTable(doc, {
    startY: 96,
    head: [['School', 'Student', 'Grade', 'Entries', 'Approved', 'Pending', 'Total', 'Rejected']],
    body: students.map((s) => [
      s.schoolName || '',
      s.name || '',
      s.grade || '',
      String(s.logCount ?? 0),
      fmtHours(s.approvedHours),
      fmtHours(s.pendingHours),
      fmtHours(s.totalHours),
      fmtHours(s.rejectedHours),
    ]),
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [63, 131, 68] },
    foot: [[
      'Total', '', '', String(totals.logs),
      fmtHours(totals.approvedHours), fmtHours(totals.pendingHours),
      fmtHours(totals.totalHours), fmtHours(totals.rejectedHours),
    ]],
    footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
  })

  const filename = `voluntrack-hours-${range.from}-to-${range.to}.pdf`
  if (returnBlob) return doc.output('blob')
  doc.save(filename)
  return null
}

function graduationTitle(report) {
  const grade = report.gradeLabel || (report.grade ? `Grade ${report.grade}` : 'All grades')
  return `${report.schoolName || 'School'} — ${grade} volunteer hours report`
}

function graduationRequirementLine(report) {
  if (report.target == null) return 'No hour requirement is set for this grade.'
  const counting = report.hoursMode === 'counted' ? 'approved + pending hours' : 'approved hours only'
  return `Requirement: ${fmtHours(report.target)}${report.deadline ? ` by ${fmtDate(report.deadline)}` : ''}  ·  counting ${counting}`
}

/** One row per student in the grade, Missed first — the same order as the screen. */
export function graduationReportCSV(report) {
  const rows = [
    ['School', 'Student', 'Email', 'Grade', 'Approved Hours', 'Pending Hours', 'Total Counted Hours', 'Required Hours', 'Status', 'Shortfall'],
    ...report.students.map((s) => [
      report.schoolName || '', s.name || '', s.email || '', s.grade || '',
      s.approvedHours, s.pendingHours, s.countedHours,
      report.target ?? '', report.target == null ? 'No requirement' : s.met ? 'Met' : 'Missed',
      s.shortfall ?? '',
    ]),
  ]
  return rows.map((r) => r.map(csvCell).join(',')).join('\n')
}

/**
 * Graduation report PDF: who in one grade met or missed the school's hour
 * requirement, for a counselor to print or file.
 */
export async function graduationReportPDF({ report, returnBlob }) {
  const doc = new jsPDF({ unit: 'pt', orientation: 'portrait' })
  const logo = await getLogoDataUrl()
  if (logo) {
    try { doc.addImage(logo, 'PNG', 40, 28, LOGO_W, LOGO_H) } catch { /* logo optional */ }
  }
  const x = logo ? 84 : 40
  const pageWidth = doc.internal.pageSize.getWidth()

  doc.setFont('helvetica', 'bold').setFontSize(15)
  const titleLines = doc.splitTextToSize(graduationTitle(report), pageWidth - x - 40)
  doc.text(titleLines, x, 46)
  let y = 46 + titleLines.length * 18 + 4
  doc.setFont('helvetica', 'normal').setFontSize(10)
  doc.setTextColor(90)
  doc.text(`Generated ${fmtDateTime(report.generatedAt || new Date().toISOString())}`, x, y)
  y += 14
  doc.text(graduationRequirementLine(report), x, y)
  const { students, met, missed } = report.summary
  if (report.target != null) {
    y += 14
    doc.text(`${met} of ${students} met the ${report.target}-hour requirement  ·  ${missed} missed`, x, y)
  }
  doc.setTextColor(0)

  autoTable(doc, {
    startY: Math.max(y + 16, 100),
    head: [['Student', 'Email', 'Approved', 'Pending', 'Counted', 'Required', 'Status', 'Short by']],
    body: report.students.map((s) => [
      s.name || '',
      s.email || '',
      fmtHours(s.approvedHours),
      fmtHours(s.pendingHours),
      fmtHours(s.countedHours),
      report.target != null ? fmtHours(report.target) : '—',
      report.target == null ? '—' : s.met ? 'Met' : 'Missed',
      s.shortfall ? fmtHours(s.shortfall) : '',
    ]),
    styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: [63, 131, 68] },
    alternateRowStyles: { fillColor: [241, 248, 241] },
    didParseCell: (data) => {
      if (data.section !== 'body' || data.column.index !== 6) return
      if (data.cell.raw === 'Met') data.cell.styles.textColor = [34, 120, 60]
      if (data.cell.raw === 'Missed') data.cell.styles.textColor = [185, 40, 40]
      data.cell.styles.fontStyle = 'bold'
    },
  })

  if (returnBlob) return doc.output('blob')
  doc.save(`voluntrack-graduation-report-grade-${graduationSlug(report)}.pdf`)
  return null
}

/** Filename-safe grade, shared by the PDF and the CSV download. */
export function graduationSlug(report) {
  return String(report.grade || 'all').toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

/* ---------- Printable sign-in sheet for one task ---------- */

// jsPDF's built-in Helvetica only has the Windows-1252 (WinAnsi) characters:
// plain Latin plus accents like é, ñ, ü, and the curly quotes and dashes.
// Anything else (Ł, Ş, Cyrillic, Chinese, emoji…) is written out as garbage
// glyphs rather than an error, so a name like "Łukasz" would print wrong.
const WIN_ANSI_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
function isWinAnsi(text) {
  for (const ch of String(text)) {
    const c = ch.codePointAt(0)
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRAS.has(ch)) continue
    return false
  }
  return true
}

// The best plain-text version of a string Helvetica can't draw: strip the
// accents it lacks (Ş → S), drop emoji and symbols, and mark any other letter
// it can't show with "?" so the row is never silently blank.
function winAnsiFallback(text) {
  let out = ''
  for (const ch of String(text).normalize('NFC')) {
    if (isWinAnsi(ch)) { out += ch; continue }
    for (const part of ch.normalize('NFKD')) {
      if (isWinAnsi(part)) out += part
      else if (/\p{M}/u.test(part)) continue
      else if (/\p{L}|\p{N}/u.test(part)) out += '?'
      else if (/\s/u.test(part)) out += ' '
    }
  }
  return out.replace(/\s+/g, ' ').trim()
}

// In the browser, text Helvetica can't draw is drawn by the browser instead —
// on a canvas with the system's fonts, which cover every script and emoji —
// and placed in the PDF as an image, so we don't have to ship a font file.
// Returns null where there's no canvas (or it fails), and the caller falls
// back to winAnsiFallback().
const TEXT_IMAGE_SCALE = 4 // canvas pixels per PDF point: sharp when printed
function textImage(text, { size, bold = false, color = '#000000' }) {
  if (typeof document === 'undefined') return null
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const font = `${bold ? 'bold ' : ''}${size * TEXT_IMAGE_SCALE}px Helvetica, Arial, "Noto Sans", sans-serif`
    ctx.font = font
    const width = Math.ceil(ctx.measureText(text).width) + 2
    const height = Math.ceil(size * 1.35 * TEXT_IMAGE_SCALE)
    canvas.width = width
    canvas.height = height
    ctx.font = font // resizing a canvas resets its state
    ctx.fillStyle = color
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 1, height / 2)
    return { dataUrl: canvas.toDataURL('image/png'), w: width / TEXT_IMAGE_SCALE, h: height / TEXT_IMAGE_SCALE }
  } catch {
    return null
  }
}

// doc.text() for text that may hold any character; `y` is the baseline.
// Text wider than maxWidth is shrunk (image) or cut to one line (text).
function drawAnyText(doc, text, x, y, { size, bold = false, gray = 0, maxWidth } = {}) {
  const value = String(text ?? '')
  doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size).setTextColor(gray)
  if (!isWinAnsi(value)) {
    const hex = `#${gray.toString(16).padStart(2, '0').repeat(3)}`
    const img = textImage(value, { size, bold, color: hex })
    if (img) {
      const scale = maxWidth && img.w > maxWidth ? maxWidth / img.w : 1
      try {
        doc.addImage(img.dataUrl, 'PNG', x, y - img.h * scale * 0.72, img.w * scale, img.h * scale)
        return
      } catch { /* fall through to plain text */ }
    }
  }
  const safe = isWinAnsi(value) ? value : winAnsiFallback(value)
  doc.text(maxWidth ? doc.splitTextToSize(safe, maxWidth)[0] || '' : safe, x, y)
}

// "14:30" (how a task stores its time) → "2:30 PM".
function fmtClock(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''))
  if (!m) return String(hhmm || '')
  const h = Number(m[1])
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

const SHEET_ROW_H = 26 // tall enough to handwrite a time and sign
const SHEET_MIN_BLANK_ROWS = 5 // walk-ins
const SHEET_MARGIN_X = 40
const SHEET_MARGIN_BOTTOM = 84 // the organizer signature line + page number
const SHEET_MARGIN_TOP_CONT = 60 // continuation pages carry a one-line header

/**
 * Printable sign-in sheet for one task, for events where volunteers don't
 * have phones (QR check-in needs one). Lists the task's APPROVED volunteers
 * by name only — no email, phone or anything else goes on a paper that sits
 * on a table for anyone to read — then blank rows for walk-ins, filling the
 * last page (never fewer than five).
 *
 * Portrait: the six columns fit across a portrait page with a wide signature
 * box, and portrait fits more handwriting-height rows per page and suits a
 * clipboard. US Letter, which is what organizers print on; it still prints
 * fine scaled onto A4.
 *
 * `task` is a row from GET /api/school/public-tasks/mine (title, date, time,
 * location, signups[{ name, status, guest_count, guest_names }]).
 */
export async function generateSignInSheetPDF(task, { organizerName, returnBlob } = {}) {
  const logo = await getLogoDataUrl()
  const signups = Array.isArray(task?.signups) ? task.signups : []
  // Each volunteer is followed by their guests (#439): a named guest, or a
  // line with who brought them for the name to be written in on the day.
  const names = signups
    .filter((s) => s.status === 'approved')
    .map((s) => ({ ...s, name: String(s.name || '').trim() || 'Volunteer' }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .flatMap((s) => [s.name, ...guestSheetRows(s)])
  const waitlisted = signups.filter((s) => s.status === 'waitlisted').length

  // Draw once with the minimum blank rows to see where the table ends, then
  // again with as many more as fit in the rest of that page.
  const sheet = { task, names, waitlisted, organizerName, logo }
  const probe = drawSignInSheet({ ...sheet, blankRows: SHEET_MIN_BLANK_ROWS })
  const pageBottom = probe.internal.pageSize.getHeight() - SHEET_MARGIN_BOTTOM
  const room = Math.floor((pageBottom - probe.lastAutoTable.finalY - 0.5) / SHEET_ROW_H)
  const doc = drawSignInSheet({ ...sheet, blankRows: SHEET_MIN_BLANK_ROWS + Math.max(0, room) })

  if (returnBlob) return doc.output('blob')
  const slug = String(task?.title || '').normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'task'
  doc.save(`sign-in-sheet-${slug}${task?.date ? `-${String(task.date).slice(0, 10)}` : ''}.pdf`)
  return null
}

function drawSignInSheet({ task, names, waitlisted, organizerName, logo, blankRows }) {
  const doc = new jsPDF({ unit: 'pt', orientation: 'portrait', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const contentW = W - SHEET_MARGIN_X * 2
  const title = String(task?.title || '').trim() || 'Volunteer task'
  const day = task?.date ? fmtDate(String(task.date).slice(0, 10)) : ''

  // Header (first page)
  if (logo) {
    try { doc.addImage(logo, 'PNG', SHEET_MARGIN_X, 28, LOGO_W, LOGO_H) } catch { /* logo optional */ }
  }
  const textX = logo ? SHEET_MARGIN_X + LOGO_W + 10 : SHEET_MARGIN_X
  drawAnyText(doc, 'SIGN-IN SHEET', textX, 38, { size: 9, bold: true, gray: 90 })
  drawAnyText(doc, title, textX, 57, { size: 17, bold: true, maxWidth: W - SHEET_MARGIN_X - textX })

  let y = 86
  const when = [day, task?.time ? fmtClock(task.time) : ''].filter(Boolean).join('  ·  ')
  const details = [
    ['Date', when],
    ['Location', task?.location],
    ['Organizer', organizerName],
  ].filter(([, v]) => v && String(v).trim())
  for (const [label, value] of details) {
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(90)
    doc.text(`${label}:`, SHEET_MARGIN_X, y)
    drawAnyText(doc, String(value).trim(), SHEET_MARGIN_X + 62, y, { size: 10, maxWidth: contentW - 62 })
    y += 15
  }

  y += 8
  drawAnyText(doc, 'Write the time you arrive and leave, and sign.', SHEET_MARGIN_X, y, { size: 11, bold: true })
  if (waitlisted > 0) {
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(120)
    doc.text(`${waitlisted} on the waitlist, not listed`, W - SHEET_MARGIN_X, y, { align: 'right' })
  }
  doc.setTextColor(0)

  const body = [
    ...names.map((n, i) => [String(i + 1), isWinAnsi(n) ? n : winAnsiFallback(n) || '?', '', '', '', '']),
    ...Array.from({ length: blankRows }, (_, i) => [String(names.length + i + 1), '', '', '', '', '']),
  ]
  // Names Helvetica can't draw go in as images, drawn by didDrawCell.
  const nameImages = names.map((n) => (isWinAnsi(n) ? null : textImage(n, { size: 10, color: '#141414' })))

  autoTable(doc, {
    startY: y + 12,
    head: [['#', 'Volunteer name', 'Time in', 'Time out', 'Hours', 'Signature']],
    body,
    theme: 'grid',
    margin: { left: SHEET_MARGIN_X, right: SHEET_MARGIN_X, top: SHEET_MARGIN_TOP_CONT, bottom: SHEET_MARGIN_BOTTOM },
    headStyles: { fillColor: [63, 131, 68], textColor: 255, fontSize: 9.5, lineColor: [63, 131, 68], minCellHeight: 0 },
    styles: { fontSize: 10, cellPadding: 5, minCellHeight: SHEET_ROW_H, valign: 'middle', lineColor: [150, 150, 150], lineWidth: 0.6, textColor: 20, overflow: 'linebreak' },
    columnStyles: {
      0: { cellWidth: 26, halign: 'center', textColor: 120, fontSize: 8.5 },
      1: { cellWidth: 178 },
      2: { cellWidth: 64 },
      3: { cellWidth: 64 },
      4: { cellWidth: 50 },
      5: { cellWidth: 'auto' },
    },
    willDrawCell: (data) => {
      if (data.section === 'body' && data.column.index === 1 && nameImages[data.row.index]) data.cell.text = []
    },
    didDrawCell: (data) => {
      if (data.section !== 'body' || data.column.index !== 1) return
      const img = nameImages[data.row.index]
      if (!img) return
      const scale = Math.min(1, (data.cell.width - 10) / img.w)
      try {
        doc.addImage(img.dataUrl, 'PNG', data.cell.x + 5, data.cell.y + (data.cell.height - img.h * scale) / 2, img.w * scale, img.h * scale)
      } catch { /* leave the cell blank rather than fail the sheet */ }
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        drawAnyText(doc, `Sign-in sheet — ${title}${day ? ` · ${day}` : ''} (continued)`, SHEET_MARGIN_X, 40, { size: 10, bold: true, gray: 90, maxWidth: contentW })
        doc.setTextColor(0)
      }
    },
  })

  // Footer on every page: the organizer signs each page, so a loose page
  // still stands on its own.
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    const fy = H - 50
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(40)
    doc.text('Organizer signature', SHEET_MARGIN_X, fy)
    doc.setDrawColor(120).setLineWidth(0.6)
    doc.line(SHEET_MARGIN_X + 100, fy + 2, SHEET_MARGIN_X + 330, fy + 2)
    doc.text('Date', SHEET_MARGIN_X + 350, fy)
    doc.line(SHEET_MARGIN_X + 378, fy + 2, W - SHEET_MARGIN_X, fy + 2)
    doc.setFontSize(7.5).setTextColor(130)
    doc.text(`Generated by VolunTrack · page ${p} of ${pages}`, W / 2, H - 26, { align: 'center' })
  }
  doc.setTextColor(0)
  return doc
}
