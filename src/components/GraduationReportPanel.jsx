import { useCallback, useEffect, useState } from 'react'
import { Eye, FileSpreadsheet, FileText, GraduationCap, Loader2, Target } from 'lucide-react'
import Card from '@/components/Card.jsx'
import PdfPreview from '@/components/PdfPreview.jsx'
import { graduationReportCSV, graduationReportPDF, graduationSlug } from '@/lib/export.js'
import { fmtDate, fmtHours } from '@/utils/date.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

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

// Students tab → Graduation report: who in one grade met or missed the
// school's hour requirement, as a table to print or export
// (server: GET /school/graduation-report). Approved hours only by default —
// a graduation sign-off should rest on verified hours.
export default function GraduationReportPanel({ onSetRequirement }) {
  const [grade, setGrade] = useState('')
  const [mode, setMode] = useState('approved')
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ hours: mode })
      if (grade) qs.set('grade', grade)
      const res = await fetch(`${apiUrl}/school/graduation-report?${qs}`, { headers: auth() })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not build the graduation report.')
      setReport(body)
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [grade, mode])
  useEffect(() => { load() }, [load])

  if (error) return <Card><p className="text-sm text-red-400">{error}</p></Card>
  if (!report) return <Card><p className="text-sm text-earth-500 py-6 text-center">Loading…</p></Card>

  if (!report.requirementSet) {
    return (
      <Card className="text-center py-8">
        <Target className="w-8 h-8 mx-auto text-earth-500 mb-2" />
        <p className="font-medium">No hour requirement set yet</p>
        <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">Set how many hours your students need (one total, or per grade) to see who met it.</p>
        {onSetRequirement && <button onClick={onSetRequirement} className="btn-primary btn-sm mt-4">Set the requirement</button>}
      </Card>
    )
  }

  const { summary, students, target } = report
  const gradeName = report.gradeLabel || 'this grade'
  const savePdf = async () => {
    setPdfBusy(true)
    try {
      await graduationReportPDF({ report })
    } catch (e) {
      setError(e.message || 'Could not build the PDF.')
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><GraduationCap className="w-4 h-4 text-brand-600" /> Graduation report</h3>
          <p className="text-sm text-earth-500 dark:text-earth-400">
            Who in a grade met the hour requirement{report.deadline ? `, due ${fmtDate(report.deadline)}` : ''}.
          </p>
        </div>
        {report.grades.length > 0 && (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="grad-grade">Grade</label>
              <select id="grad-grade" className="input py-1.5" value={report.grade || ''} onChange={(e) => setGrade(e.target.value)}>
                {report.grades.map((g) => (
                  <option key={g.key} value={g.key}>{g.label} ({g.count})</option>
                ))}
              </select>
            </div>
            <div role="group" aria-label="Which hours count" className="flex rounded-xl overflow-hidden border border-white/10">
              <button type="button" onClick={() => setMode('approved')} aria-pressed={mode === 'approved'} className={`btn-sm rounded-none ${mode === 'approved' ? 'btn-primary' : 'btn-ghost'}`}>Approved hours only</button>
              <button type="button" onClick={() => setMode('counted')} aria-pressed={mode === 'counted'} className={`btn-sm rounded-none ${mode === 'counted' ? 'btn-primary' : 'btn-ghost'}`}>Approved + pending</button>
            </div>
          </div>
        )}
      </div>

      {report.grades.length === 0 ? (
        <p className="text-sm text-earth-500 py-6 text-center">None of your students has a grade on their account yet, so there is nothing to group.</p>
      ) : target == null ? (
        <p className="text-sm text-earth-500 py-6 text-center">
          No hour requirement applies to {gradeName}. Add one for this grade (or a school-wide total) in Requirements.
          {onSetRequirement && <> <button onClick={onSetRequirement} className="text-brand-400 hover:underline">Set the requirement</button></>}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <p className="text-sm" role="status">
              <strong>{summary.met} of {summary.students}</strong> met the {target}-hour requirement
              {summary.missed > 0 && <span className="text-amber-300"> · {summary.missed} missed</span>}
              <span className="text-earth-500"> · counting {report.hoursMode === 'counted' ? 'approved + pending' : 'approved'} hours</span>
              {loading && <Loader2 className="inline w-3.5 h-3.5 ml-2 animate-spin" />}
            </p>
            {students.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-sm btn-ghost" onClick={() => download(graduationReportCSV(report), `voluntrack-graduation-report-grade-${graduationSlug(report)}.csv`, 'text/csv;charset=utf-8')}>
                  <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
                </button>
                <button type="button" className="btn-sm btn-ghost" onClick={() => setPreview(true)}>
                  <Eye className="h-3.5 w-3.5" /> Preview / print
                </button>
                <button type="button" className="btn-sm btn-primary" disabled={pdfBusy} onClick={savePdf}>
                  <FileText className="h-3.5 w-3.5" /> {pdfBusy ? 'Building…' : 'PDF'}
                </button>
              </div>
            )}
          </div>

          {students.length === 0 ? (
            <p className="text-sm text-earth-500 py-6 text-center">No students in {gradeName}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-earth-500">
                    <th className="py-2 pr-3">Student</th>
                    <th className="py-2 pr-3 text-right">Approved</th>
                    <th className="py-2 pr-3 text-right">Pending</th>
                    <th className="py-2 pr-3 text-right">Counted</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3 text-right">Short by</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id} className="border-t border-white/10">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{s.name}</div>
                        <div className="text-xs text-earth-500">{s.email}</div>
                      </td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">{fmtHours(s.approvedHours)}</td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">{fmtHours(s.pendingHours)}</td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">{fmtHours(s.countedHours)}</td>
                      <td className="py-2 pr-3">
                        {s.met
                          ? <span className="inline-block rounded-full bg-emerald-500/15 text-emerald-300 px-2 py-0.5 text-xs font-medium">Met</span>
                          : <span className="inline-block rounded-full bg-red-500/15 text-red-300 px-2 py-0.5 text-xs font-medium">Missed</span>}
                      </td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">{s.shortfall ? fmtHours(s.shortfall) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {report.ungraded > 0 && (
            <p className="mt-3 text-xs text-earth-500">{report.ungraded} student{report.ungraded === 1 ? ' has' : 's have'} no grade on their account and {report.ungraded === 1 ? 'is' : 'are'} not in any grade's report.</p>
          )}
        </>
      )}

      {preview && (
        <PdfPreview
          title={`${report.gradeLabel || 'Graduation'} report`}
          filename={`voluntrack-graduation-report-grade-${graduationSlug(report)}.pdf`}
          getBlob={() => graduationReportPDF({ report, returnBlob: true })}
          onClose={() => setPreview(false)}
        />
      )}
    </Card>
  )
}
