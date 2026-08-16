import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { fmtDate, fmtHours, hoursBetween } from '@/utils/date.js'

/** Generate a printable PDF report for the user's logs. When `returnBlob` is true, returns the PDF blob instead of downloading. */
export function exportLogsPDF({ user, logs, returnBlob }) {
  const doc = new jsPDF({ unit: 'pt' })
  const total = logs.reduce((s, l) => s + (Number(l.hours) || 0), 0)

  // Header
  doc.setFont('helvetica', 'bold').setFontSize(20)
  doc.text('Volunteer Service Log', 40, 50)
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
    head: [['Date', 'Activity', 'Category', 'Hours', 'Organization', 'Supervisor', 'Signature']],
    body: logs.map((l) => [
      fmtDate(l.date),
      l.activity || '',
      l.category || '',
      fmtHours(Number(l.hours) || 0),
      l.orgName || '',
      l.supervisorName || '',
      '', // filled in by didDrawCell below — autoTable can't take an image as cell content directly
    ]),
    headStyles: { fillColor: [63, 131, 68] },
    styles: { fontSize: 10, cellPadding: 6, minCellHeight: 28 },
    alternateRowStyles: { fillColor: [241, 248, 241] },
    columnStyles: { 6: { cellWidth: 70 } },
    didDrawCell: (data) => {
      if (data.section !== 'body' || data.column.index !== 6) return
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
