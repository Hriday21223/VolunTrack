import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { fmtDate, fmtHours, hoursBetween } from '@/utils/date.js'

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
export async function exportLogsPDF({ user, logs, returnBlob }) {
  const doc = new jsPDF({ unit: 'pt', orientation: 'landscape' })
  const total = logs.reduce((s, l) => s + (Number(l.hours) || 0), 0)
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
    head: [['Date', 'Activity', 'Category', 'Time', 'Hours', 'Location', 'Organization', 'Org Phone', 'Org Address', 'Supervisor', 'Supervisor Email', 'Notes', 'Signature']],
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
    ]),
    headStyles: { fillColor: [63, 131, 68], fontSize: 8 },
    styles: { fontSize: 7.5, cellPadding: 4, minCellHeight: 28, overflow: 'linebreak' },
    alternateRowStyles: { fillColor: [241, 248, 241] },
    columnStyles: { 12: { cellWidth: 65 } },
    didDrawCell: (data) => {
      if (data.section !== 'body' || data.column.index !== 12) return
      const sig = logs[data.row.index]?.supervisorSignature
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
export async function generateInvoicePDF({ invoiceNumber, entityName, amount, billingPeriod, description, dueDate, createdAt, returnBlob }) {
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
  if (dueDate) doc.text(`Due ${new Date(dueDate).toLocaleDateString()}`, 400, 80)
  doc.setTextColor(0)

  doc.setFont('helvetica', 'bold').setFontSize(12)
  doc.text('Bill to', 40, 110)
  doc.setFont('helvetica', 'normal').setFontSize(11)
  doc.text(entityName || '', 40, 126)

  const periodLabel = BILLING_PERIOD_LABELS[billingPeriod] || ''
  autoTable(doc, {
    startY: 150,
    head: [['Description', 'Amount']],
    body: [[description || 'VolunTrack subscription', `$${Number(amount).toFixed(2)}${periodLabel ? ' ' + periodLabel : ''}`]],
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
    ['Date', 'Activity', 'Category', 'Hours', 'Start', 'End', 'Location', 'Organization', 'Org Address', 'Org Phone', 'Supervisor', 'Signed', 'Verified', 'Notes'],
    ...logs.map((l) => [
      l.date || '',
      (l.activity || '').replaceAll(',', ' '),
      l.category || '',
      l.hours ?? '',
      l.startTime || '',
      l.endTime || '',
      (l.location || '').replaceAll(',', ' '),
      (l.orgName || '').replaceAll(',', ' '),
      (l.orgAddress || '').replaceAll(',', ' '),
      (l.orgPhone || '').replaceAll(',', ' '),
      (l.supervisorName || '').replaceAll(',', ' '),
      l.supervisorSignature ? 'yes' : 'no',
      l.verified ? 'yes' : 'no',
      (l.notes || '').replaceAll(/\n/g, ' ').replaceAll(',', ' '),
    ]),
  ]
  return rows.map((r) => r.map(csvCell).join(',')).join('\n')
}

function csvCell(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
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

/**
 * Detail CSV — one row per log, for spreadsheets. Uses the same csvCell
 * escaping as exportLogsCSV so a comma in an activity name can't shift
 * columns.
 */
export function schoolHoursCSV(logs) {
  const rows = [
    ['School', 'Student', 'Email', 'Grade', 'Date', 'Activity', 'Category', 'Hours', 'Status', 'Organization', 'Supervisor', 'Location', 'Notes'],
    ...logs.map((l) => [
      l.schoolName || '',
      l.studentName || '',
      l.studentEmail || '',
      l.grade || '',
      l.date || '',
      l.activity || '',
      l.category || '',
      l.hours ?? '',
      l.verificationStatus || '',
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
    `${totals.students} students  ·  ${totals.logs} entries  ·  ${fmtHours(totals.approvedHours)} approved + ${fmtHours(totals.pendingHours)} pending = ${fmtHours(totals.totalHours)} total${totals.rejectedHours ? `  ·  ${fmtHours(totals.rejectedHours)} rejected (excluded)` : ''}`,
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
