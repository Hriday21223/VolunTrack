import { useMemo, useState } from 'react'
import { FileText, Download, Printer, FileDown, Filter, Send, School } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth.jsx'
import { useData } from '@/hooks/useData.jsx'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import VerificationBadge from '@/components/VerificationBadge.jsx'
import { fmtDate, fmtHours } from '@/utils/date.js'
import { exportLogsPDF, exportLogsCSV, printCertificate } from '@/lib/export.js'
import { categoryColor } from '@/lib/categories.js'
import { deriveAchievementState } from '@/lib/achievements.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

export default function Reports() {
  const { user } = useAuth()
  const { logs, goals } = useData()
  const [submitting, setSubmitting] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const [toastOpen, setToastOpen] = useState(false)
  const [category, setCategory] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (category !== 'all' && l.category !== category) return false
      if (from && l.date < from) return false
      if (to && l.date > to) return false
      return true
    })
  }, [logs, category, from, to])

  const total = filtered.reduce((s, l) => s + (Number(l.hours) || 0), 0)
  const submitToSchool = async () => {
    setSubmitting(true)
    try {
      const blob = exportLogsPDF({ user, logs: filtered, returnBlob: true })
      const reader = new FileReader()
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1]
        const token = localStorage.getItem('voluntrack:auth_token')
        const res = await fetch(`${apiUrl}/school/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ filename: `report-${Date.now()}.pdf`, fileData: base64, fileType: 'application/pdf' }),
        })
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Upload failed') }
        setToastMsg('Report submitted to school!')
        setToastOpen(true)
      }
      reader.readAsDataURL(blob)
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
      title="Reports"
      subtitle="Export your record or print a certificate of service."
    >
      <div className="grid lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-1">
          <h3 className="font-display font-semibold mb-3 flex items-center gap-2"><Filter className="w-4 h-4 text-brand-600" /> Filter</h3>
          <div className="space-y-3">
            <div>
              <label className="label">Category</label>
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map((c) => <option key={c} value={c}>{c === 'all' ? 'All categories' : c}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">From</label>
                <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <label className="label">To</label>
                <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
            <div className="pt-2 space-y-2">
              <button className="btn-primary w-full" onClick={() => exportLogsPDF({ user, logs: filtered })}>
                <FileDown className="w-4 h-4" /> Download PDF
              </button>
              <button className="btn-secondary w-full" onClick={onCSV}>
                <Download className="w-4 h-4" /> Export CSV
              </button>
              <button className="btn-ghost w-full" onClick={() => printCertificate({ user, totalHours: state.totalHours, goalReached: state.goalReached })}>
                <Printer className="w-4 h-4" /> Print certificate
              </button>
              {user?.schoolId && (
                <button className="btn-primary w-full" onClick={submitToSchool} disabled={submitting}>
                  <Send className="w-4 h-4" /> {submitting ? 'Sending…' : 'Submit to school'}
                </button>
              )}
            </div>
          </div>
        </Card>

        <div className="lg:col-span-2 space-y-5">
          <div className="grid sm:grid-cols-3 gap-4">
            <Stat label="Total hours" value={fmtHours(total)} />
            <Stat label="Sessions"    value={filtered.length} />
            <Stat label="Categories"  value={byCategory.length} />
          </div>

          <Card>
            <h3 className="font-display font-semibold mb-3">Hours by category</h3>
            {byCategory.length === 0 ? (
              <div className="text-sm text-earth-500 dark:text-earth-400 py-4 text-center">No data to summarize.</div>
            ) : (
              <ul className="space-y-2">
                {byCategory.map(([cat, hrs]) => {
                  const pct = total > 0 ? (hrs / total) * 100 : 0
                  return (
                    <li key={cat}>
                      <div className="flex items-center justify-between text-sm">
                        <span className={`chip ${categoryColor(cat)}`}>{cat}</span>
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
              <FileText className="w-4 h-4 text-brand-600" /> Entries
            </div>
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-earth-500 dark:text-earth-400">No entries match these filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-earth-50 dark:bg-[#0f1a14] text-earth-500 dark:text-earth-400">
                    <tr>
                      <th className="text-left px-4 py-2">Date</th>
                      <th className="text-left px-4 py-2">Activity</th>
                      <th className="text-left px-4 py-2">Category</th>
                      <th className="text-left px-4 py-2">Supervisor</th>
                      <th className="text-left px-4 py-2">Status</th>
                      <th className="text-right px-4 py-2">Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((l) => (
                      <tr key={l.id} className="border-t border-earth-100 dark:border-[#1f2e25]">
                        <td className="px-4 py-2 whitespace-nowrap">{fmtDate(l.date)}</td>
                        <td className="px-4 py-2">{l.activity || '—'}</td>
                        <td className="px-4 py-2">{l.category && <span className={`chip ${categoryColor(l.category)}`}>{l.category}</span>}</td>
                        <td className="px-4 py-2">{l.supervisorName || '—'}</td>
                        <td className="px-4 py-2"><VerificationBadge status={l.verificationStatus} /></td>
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

function Stat({ label, value }) {
  return (
    <Card>
      <div className="text-xs text-earth-500 dark:text-earth-400">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </Card>
  )
}
