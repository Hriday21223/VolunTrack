import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, Download, Printer, FileDown, Filter, Send, School, ShieldCheck, Upload, Share2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth.jsx'
import { useData } from '@/hooks/useData.jsx'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import VerificationBadge from '@/components/VerificationBadge.jsx'
import ShareHoursModal from '@/components/ShareHoursModal.jsx'
import CollegeActivitiesCard from '@/components/CollegeActivitiesCard.jsx'
import ImpactReportCard from '@/components/ImpactReportCard.jsx'
import ReflectionsCard from '@/components/ReflectionsCard.jsx'
import SentReportsCard from '@/components/SentReportsCard.jsx'
import { fmtDate, fmtHours } from '@/utils/date.js'
import { exportLogsPDF, exportLogsCSV, printCertificate } from '@/lib/export.js'
import { categoryColor } from '@/lib/categories.js'
import { deriveAchievementState, countedLogs } from '@/lib/achievements.js'
import { downloadSignedTranscript, hasAccountSession, importTranscript, readTranscriptFile } from '@/lib/transcript.js'
import { syncPullLogs } from '@/lib/logSync.js'
import { submitDocumentToSchool } from '@/lib/schoolDocument.js'
import { tr } from '@/lib/i18n.js'
import { useMyRequirements, awardFor } from '@/lib/requirements.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

export default function Reports() {
  const { user } = useAuth()
  // The school's (or its org's) chosen certificate signer, if it set one.
  const requirements = useMyRequirements()
  const certificate = requirements.sources?.certificates === 'default' ? null : requirements.policy?.certificates
  const { logs, goals } = useData()
  const [submitting, setSubmitting] = useState(false)
  const [sentCount, setSentCount] = useState(0)
  const [toastMsg, setToastMsg] = useState('')
  const [toastOpen, setToastOpen] = useState(false)
  const [category, setCategory] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sharing, setSharing] = useState(false)

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (category !== 'all' && l.category !== category) return false
      if (from && l.date < from) return false
      if (to && l.date > to) return false
      return true
    })
  }, [logs, category, from, to])

  const total = countedLogs(filtered).reduce((s, l) => s + (Number(l.hours) || 0), 0)
  const submitToSchool = async () => {
    setSubmitting(true)
    try {
      const blob = await exportLogsPDF({ user, logs: filtered, returnBlob: true })
      // Goes straight to the school's own storage where they have set one up,
      // and falls back to sending it through us where they haven't (#143).
      await submitDocumentToSchool(blob, {
        filename: `report-${Date.now()}.pdf`,
        fileType: 'application/pdf',
      })
      setSentCount((n) => n + 1)
      setToastMsg(tr('Report submitted to school!'))
      setToastOpen(true)
    } catch (e) {
      setToastMsg(e.message)
      setToastOpen(true)
    } finally { setSubmitting(false) }
  }

  const byCategory = useMemo(() => {
    const m = new Map()
    for (const l of filtered) {
      m.set(l.category || 'Other', (m.get(l.category || 'Other') || 0) + (Number(l.hours) || 0))
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [filtered])

  const state = deriveAchievementState(logs, goals)

  // The shareable picture is all-time, whatever the filters say (#478).
  // Memoized: the preview redraws whenever these change.
  const shareStats = useMemo(() => {
    const counted = countedLogs(logs)
    const byCause = new Map()
    for (const l of counted) byCause.set(l.category || 'Other', (byCause.get(l.category || 'Other') || 0) + (Number(l.hours) || 0))
    return {
      totalHours: counted.reduce((s, l) => s + (Number(l.hours) || 0), 0),
      approvedHours: counted
        .filter((l) => (l.verificationStatus || l.verification_status) === 'approved')
        .reduce((s, l) => s + (Number(l.hours) || 0), 0),
      sessions: counted.length,
      causes: [...byCause.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => tr(c)),
    }
  }, [logs])
  const categories = ['all', ...new Set(logs.map((l) => l.category).filter(Boolean))]

  const onCSV = () => {
    const csv = exportLogsCSV(filtered)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `volunteer-log-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <AppLayout
      title={tr('Reports')}
      subtitle={tr('Export your record or print a certificate of service.')}
    >
      {/* grid-cols-1, not an implicit column: an implicit track grows to its
          content's min width, and the date inputs below are wide enough on
          Android to push the whole page off a phone screen. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-1 space-y-5">
        <Card>
          <h3 className="font-display font-semibold mb-3 flex items-center gap-2"><Filter className="w-4 h-4 text-brand-600" />{' '}{tr('Filter')}</h3>
          <div className="space-y-3">
            <div>
              <label className="label">{tr('Category')}</label>
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map((c) => <option key={c} value={c}>{c === 'all' ? tr('All categories') : c}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">{tr('From')}</label>
                <input type="date" className="input min-w-0" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <label className="label">{tr('To')}</label>
                <input type="date" className="input min-w-0" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
            <div className="pt-2 space-y-2">
              <button className="btn-primary w-full" onClick={() => exportLogsPDF({ user, logs: filtered })}>
                <FileDown className="w-4 h-4" />{' '}{tr('Download PDF')}
              </button>
              <button className="btn-secondary w-full" onClick={onCSV}>
                <Download className="w-4 h-4" />{' '}{tr('Export CSV')}
              </button>
              <button className="btn-secondary w-full" onClick={() => setSharing(true)} disabled={shareStats.sessions === 0}>
                <Share2 className="w-4 h-4" />{' '}{tr('Share my hours')}
              </button>
              <button className="btn-ghost w-full" onClick={() => printCertificate({ user, totalHours: state.totalHours, goalReached: state.goalReached, certificate, award: awardFor(requirements.policy, state.totalHours).current?.name || null })}>
                <Printer className="w-4 h-4" />{' '}{tr('Print certificate')}
              </button>
              {user?.schoolId && (
                <button className="btn-primary w-full" onClick={submitToSchool} disabled={submitting}>
                  <Send className="w-4 h-4" /> {submitting ? tr('Sending…') : tr('Submit to school')}
                </button>
              )}
            </div>
          </div>
        </Card>
        {user?.schoolId && <SentReportsCard refreshKey={sentCount} />}
        <ImpactReportCard scope="student" name={user?.name} logs={countedLogs(logs)} className="mb-6" />
        <CollegeActivitiesCard logs={logs} />
        <ReflectionsCard logs={logs} />
        <TranscriptCard notify={(msg) => { setToastMsg(msg); setToastOpen(true) }} />
        {sharing && (
          <ShareHoursModal
            name={user?.name || ''}
            totalHours={shareStats.totalHours}
            approvedHours={shareStats.approvedHours}
            sessions={shareStats.sessions}
            causes={shareStats.causes}
            onClose={() => setSharing(false)}
          />
        )}
        </div>

        <div className="lg:col-span-2 space-y-5">
          <div className="grid sm:grid-cols-3 gap-4">
            <Stat label={tr('Total hours')} value={fmtHours(total)} />
            <Stat label={tr('Sessions')}    value={filtered.length} />
            <Stat label={tr('Categories')}  value={byCategory.length} />
          </div>

          <Card>
            <h3 className="font-display font-semibold mb-3">{tr('Hours by category')}</h3>
            {byCategory.length === 0 ? (
              <div className="text-sm text-earth-500 dark:text-earth-400 py-4 text-center">{tr('No data to summarize.')}</div>
            ) : (
              <ul className="space-y-2">
                {byCategory.map(([cat, hrs]) => {
                  const pct = total > 0 ? (hrs / total) * 100 : 0
                  return (
                    <li key={cat}>
                      <div className="flex items-center justify-between text-sm">
                        <span className={`chip ${categoryColor(cat)}`}>{tr(cat)}</span>
                        <span className="font-medium">{fmtHours(hrs)} · {pct.toFixed(0)}%</span>
                      </div>
                      <div className="h-2 mt-1 rounded-full bg-earth-100 dark:bg-[#1b2a22] overflow-hidden">
                        <div className="h-full bg-brand-500" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          <Card padded={false} className="overflow-hidden">
            <div className="px-5 py-3 border-b border-earth-100 dark:border-[#1f2e25] font-display font-semibold flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand-600" />{' '}{tr('Entries')}
            </div>
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-earth-500 dark:text-earth-400">{tr('No entries match these filters.')}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-earth-50 dark:bg-[#0f1a14] text-earth-500 dark:text-earth-400">
                    <tr>
                      <th className="text-left px-4 py-2">{tr('Date')}</th>
                      <th className="text-left px-4 py-2">{tr('Activity')}</th>
                      <th className="text-left px-4 py-2">{tr('Category')}</th>
                      <th className="text-left px-4 py-2">{tr('Supervisor')}</th>
                      <th className="text-left px-4 py-2">{tr('Status')}</th>
                      <th className="text-right px-4 py-2">{tr('Hours')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((l) => (
                      <tr key={l.id} className="border-t border-earth-100 dark:border-[#1f2e25]">
                        <td className="px-4 py-2 whitespace-nowrap">{fmtDate(l.date)}</td>
                        <td className="px-4 py-2">{l.activity || '—'}</td>
                        <td className="px-4 py-2">{l.category && <span className={`chip ${categoryColor(l.category)}`}>{tr(l.category)}</span>}</td>
                        <td className="px-4 py-2">{l.supervisorName || '—'}</td>
                        <td className="px-4 py-2"><VerificationBadge status={l.verificationStatus} bySchool={l.reviewedBySchool} note={l.reviewNote} /></td>
                        <td className="px-4 py-2 text-right font-medium">{fmtHours(Number(l.hours) || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
      <Toast open={toastOpen} onClose={() => setToastOpen(false)}>{toastMsg}</Toast>
    </AppLayout>
  )
}

// Signed transcript export/import (#143). Server-backed student and volunteer
// accounts only: the server can only vouch for logs it holds, so there is
// nothing to sign for a client-only account.
function TranscriptCard({ notify }) {
  const { user } = useAuth()
  const { refreshLogs } = useData()
  const [busy, setBusy] = useState('')
  const fileRef = useRef(null)

  if (!hasAccountSession() || !['student', 'volunteer'].includes(user?.role)) return null

  const onDownload = async () => {
    setBusy('download')
    try {
      await downloadSignedTranscript()
      notify('Signed transcript downloaded.')
    } catch (e) {
      notify(e.message)
    } finally {
      setBusy('')
    }
  }

  const onImport = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy('import')
    try {
      const doc = await readTranscriptFile(file)
      const { imported, skipped } = await importTranscript(doc)
      if (imported > 0) {
        await syncPullLogs(user.id)
        refreshLogs()
      }
      notify(imported === 0
        ? 'Every entry in that transcript is already on your account.'
        : `Imported ${imported} ${imported === 1 ? 'entry' : 'entries'}${skipped ? ` (${skipped} already on your account)` : ''}.`)
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <Card>
      <h3 className="font-display font-semibold mb-1 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-brand-600" />{' '}{tr('Verified transcript')}</h3>
      <p className="text-xs text-earth-500 dark:text-earth-400 mb-3">
        {tr('A signed copy of every entry saved to your account, ignoring the filters above. A new school can import it with approvals intact, and anyone can check it at')}{' '}<Link to="/verify-transcript" className="underline">{tr('verify-transcript')}</Link>.
      </p>
      <div className="space-y-2">
        <button className="btn-secondary w-full" onClick={onDownload} disabled={Boolean(busy)}>
          <Download className="w-4 h-4" /> {busy === 'download' ? tr('Signing…') : tr('Download signed transcript')}
        </button>
        <button className="btn-ghost w-full" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)}>
          <Upload className="w-4 h-4" /> {busy === 'import' ? tr('Importing…') : tr('Import a transcript')}
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onImport} />
      </div>
    </Card>
  )
}

function Stat({ label, value }) {
  return (
    <Card>
      <div className="text-xs text-earth-500 dark:text-earth-400">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </Card>
  )
}
