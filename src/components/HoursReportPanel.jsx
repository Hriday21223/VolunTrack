import { useState } from 'react'
import { Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react'
import { schoolHoursCSV, schoolSummaryCSV, schoolHoursPDF } from '@/lib/export.js'
import { fmtHours } from '@/utils/date.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function isoDate(d) {
  return d.toISOString().slice(0, 10)
}

// Defaults to the current school year so the common case is one click. A
// school year starting in August is the usual US pattern; before August the
// current year's report still belongs to the previous August.
function defaultRange() {
  const now = new Date()
  const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1
  return { from: `${startYear}-08-01`, to: isoDate(now) }
}

function download(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Bulk hour report for every student in a school (or every school in an
 * organization). `title` appears on the PDF.
 */
export default function HoursReportPanel({ title = 'Volunteer hours report' }) {
  const initial = defaultRange()
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [approvedOnly, setApprovedOnly] = useState(false)
  const [report, setReport] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const run = async () => {
    setBusy(true)
    setErr('')
    setReport(null)
    try {
      const qs = new URLSearchParams({ from, to, approvedOnly: String(approvedOnly) })
      const res = await fetch(`${apiUrl}/school/reports/hours?${qs}`, { headers: authHeaders() })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not build the report.')
      setReport(data)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const stamp = `${from}-to-${to}`

  return (
    <div className="space-y-4">
      {err && <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">{err}</div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="report-from">From</label>
          <input id="report-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="report-to">To</label>
          <input id="report-to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={approvedOnly} onChange={(e) => setApprovedOnly(e.target.checked)} />
          Approved hours only
        </label>
        <div className="flex items-end">
          <button type="button" className="btn-primary w-full" onClick={run} disabled={busy || !from || !to}>
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Building…</> : <>Build report</>}
          </button>
        </div>
      </div>

      {report && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-4 text-sm">
            <Stat label="Students" value={report.totals.students} />
            <Stat label="Entries" value={report.totals.logs} />
            <Stat label="Approved" value={fmtHours(report.totals.approvedHours)} />
            <Stat label="Pending" value={fmtHours(report.totals.pendingHours)} />
          </div>

          {report.truncated && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200">
              This range hit the {report.rowCap.toLocaleString()}-row limit, so the export is incomplete.
              Narrow the dates and run it again.
            </div>
          )}

          {report.totals.students === 0 ? (
            <p className="text-sm text-slate-500">No students found for this range.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button" className="btn-sm btn-ghost"
                onClick={() => download(schoolHoursCSV(report.logs), `voluntrack-hours-detail-${stamp}.csv`, 'text/csv;charset=utf-8')}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" /> Detail CSV
              </button>
              <button
                type="button" className="btn-sm btn-ghost"
                onClick={() => download(schoolSummaryCSV(report.students), `voluntrack-hours-summary-${stamp}.csv`, 'text/csv;charset=utf-8')}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" /> Summary CSV
              </button>
              <button
                type="button" className="btn-sm btn-primary" disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await schoolHoursPDF({ title, range: report.range, students: report.students, totals: report.totals })
                  } catch (e) {
                    setErr(e.message || 'Could not build the PDF.')
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <FileText className="h-3.5 w-3.5" /> Summary PDF
              </button>
            </div>
          )}

          {report.students.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">Student</th>
                    <th className="py-2 pr-3">Grade</th>
                    <th className="py-2 pr-3">Entries</th>
                    <th className="py-2 pr-3">Approved</th>
                    <th className="py-2 pr-3">Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {report.students.slice(0, 25).map((s) => (
                    <tr key={s.studentId} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-2 pr-3">{s.name}</td>
                      <td className="py-2 pr-3">{s.grade || '—'}</td>
                      <td className="py-2 pr-3">{s.logCount}</td>
                      <td className="py-2 pr-3">{fmtHours(s.approvedHours)}</td>
                      <td className="py-2 pr-3">{fmtHours(s.pendingHours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {report.students.length > 25 && (
                <p className="mt-2 text-xs text-slate-500">
                  Showing 25 of {report.students.length}. The exports contain every student.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 dark:bg-slate-900/40 px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  )
}
