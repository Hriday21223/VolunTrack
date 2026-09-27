import { useEffect, useState, useCallback, useMemo } from 'react'
import { Users, AlertTriangle, RefreshCw, Mail, Download, FileSpreadsheet, Calendar as CalIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import ProgressBar from '@/components/ProgressBar.jsx'
import VerificationBadge from '@/components/VerificationBadge.jsx'
import SpotlightTour from '@/components/SpotlightTour.jsx'
import { fmtDate, fmtHours, fromNow } from '@/utils/date.js'
import { goalPace, paceSummary, paceStanding } from '@/lib/pace.js'
import { gradeOptionLabel } from '@policy'
import { ACTIVITY_CATEGORIES } from '@/lib/categories.js'
import { exportLogsPDF, exportLogsCSV } from '@/lib/export.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// family-link and child-card render in mutually exclusive branches (no
// children linked yet vs. at least one linked) — only one is ever on the
// page at a time, so the tour must show whichever one currently applies.
const PARENT_TOUR_STEP_NO_CHILDREN = { selector: '[data-tour="family-link"]', title: 'Link a child', description: 'Ask your child for a link code from their Settings → Family section, then enter it here to see their hours.' }
const PARENT_TOUR_STEP_HAS_CHILDREN = { selector: '[data-tour="child-card"]', title: "Your child's hours", description: 'Each linked child gets a card showing progress toward their school’s requirement, plus every session they’ve logged.' }

// How many entries a card shows before asking to be expanded. A year of
// weekly volunteering is fifty rows, which buries everything under it.
const ROWS_BEFORE_FOLD = 8

const PACE_TONE = {
  behind: 'text-amber-600 dark:text-amber-400',
  overdue: 'text-red-600 dark:text-red-400',
  ahead: 'text-brand-600 dark:text-brand-400',
  'on-track': 'text-earth-500 dark:text-earth-400',
}

const paceHours = (h) => (h < 1 ? `${Math.round(h * 60)}m` : `${Math.round(h * 10) / 10}h`)

export default function ParentDashboard() {
  const [children, setChildren] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [digest, setDigest] = useState(null)
  const [digestBusy, setDigestBusy] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const headers = { Authorization: `Bearer ${token}` }
      const childRes = await fetch(`${apiUrl}/parent/children`, { headers })
      if (!childRes.ok) throw new Error(`Request failed: ${childRes.status}`)
      const { children: kids } = await childRes.json()

      const logsByChild = await Promise.all(
        (kids || []).map((c) =>
          fetch(`${apiUrl}/logs/${c.id}`, { headers })
            .then((r) => (r.ok ? r.json() : { logs: [] }))
            .catch(() => ({ logs: [] })),
        ),
      )
      setChildren((kids || []).map((c, i) => ({ ...c, logs: logsByChild[i].logs || [] })))
    } catch (err) {
      console.error('Could not load children:', err)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadDigest = useCallback(async () => {
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/parent/digest-preference`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setDigest(await res.json())
    } catch {
      // The weekly email is a nicety — a backend that can't answer for it
      // shouldn't take the hours table down with it.
    }
  }, [])

  useEffect(() => { loadData(); loadDigest() }, [loadData, loadDigest])

  const setDigestEnabled = async (enabled) => {
    setDigestBusy(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/parent/digest-preference`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled }),
      })
      if (res.ok) setDigest(await res.json())
    } catch {
      // leave the switch as it was
    } finally { setDigestBusy(false) }
  }

  return (
    <AppLayout title="Family dashboard" subtitle="Your children's volunteer hours">
      {!loading && !error && (
        <SpotlightTour
          storageKey="voluntrack:tour-seen:parent"
          steps={[children.length === 0 ? PARENT_TOUR_STEP_NO_CHILDREN : PARENT_TOUR_STEP_HAS_CHILDREN]}
        />
      )}

      {loading ? (
        <Card><p className="text-center text-earth-400 py-8">Loading…</p></Card>
      ) : error ? (
        <Card>
          <div className="text-center py-10">
            <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-amber-500" />
            <p className="font-medium text-earth-900 dark:text-earth-100">Could not load your children&apos;s hours</p>
            <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">The server did not answer. Your child&apos;s hours are safe — this page just could not fetch them.</p>
            <button onClick={loadData} className="btn-primary inline-flex items-center gap-2 mt-4">
              <RefreshCw className="w-4 h-4" /> Try again
            </button>
          </div>
        </Card>
      ) : children.length === 0 ? (
        <Card data-tour="family-link">
          <div className="text-center py-10">
            <Users className="w-10 h-10 mx-auto mb-3 text-earth-400" />
            <h3 className="font-display font-semibold mb-2">Get started</h3>
            <p className="text-sm text-earth-500 dark:text-earth-400 max-w-md mx-auto">
              Ask your child for their link code — they&apos;ll find it in Settings → Family — then enter it to follow their hours.
            </p>
            <Link to="/settings" className="btn-primary inline-flex mt-4">Enter a link code</Link>
          </div>
        </Card>
      ) : (
        <div className="space-y-5">
          {children.map((child) => (
            <ChildCard key={child.id} child={child} />
          ))}

          {digest && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Mail className="w-4 h-4 mt-1 text-brand-600 shrink-0" />
                  <div>
                    <h3 className="font-display font-semibold text-sm">Weekly progress email</h3>
                    <p className="text-xs text-earth-500 dark:text-earth-400 mt-0.5">
                      {digest.enabled
                        ? 'Every Monday, a summary of what your children logged last week.'
                        : 'Turned off. You can switch it back on at any time.'}
                      {digest.emailConfigured === false && ' Email is not configured on this server right now.'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setDigestEnabled(!digest.enabled)}
                  disabled={digestBusy}
                  className={`btn-sm shrink-0 ${digest.enabled ? 'btn-ghost' : 'btn-primary'} disabled:opacity-50`}
                >
                  {digestBusy ? 'Saving…' : digest.enabled ? 'Turn off' : 'Turn on'}
                </button>
              </div>
            </Card>
          )}
        </div>
      )}
    </AppLayout>
  )
}

function ChildCard({ child }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [category, setCategory] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [exporting, setExporting] = useState(false)

  const logs = useMemo(
    () => [...(child.logs || [])].sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [child.logs],
  )

  // The filters drive the table *and* the exports, so what a parent hands to a
  // scholarship office is exactly what they were looking at.
  const filtered = useMemo(() => logs.filter((l) => {
    const date = String(l.date || '')
    if (from && date < from) return false
    if (to && date > to) return false
    if (category && (l.category || '') !== category) return false
    return true
  }), [logs, from, to, category])

  const stats = useMemo(() => {
    const sum = (rows) => rows.reduce((s, l) => s + (Number(l.hours) || 0), 0)
    const now = new Date()
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const today = now.toISOString().slice(0, 10)
    // A log can carry a future date — a shift entered ahead of time, or a
    // typo. It is still their total, but it is not something they did this
    // month and it is certainly not when they last volunteered.
    const past = logs.filter((l) => String(l.date || '') <= today)
    return {
      total: sum(logs),
      filtered: sum(filtered),
      thisMonth: sum(logs.filter((l) => String(l.date || '').slice(0, 7) === monthKey)),
      approved: sum(logs.filter((l) => l.verification_status === 'approved')),
      pending: sum(logs.filter((l) => !l.verification_status || l.verification_status === 'pending')),
      rejected: logs.filter((l) => l.verification_status === 'rejected').length,
      lastDate: past[0]?.date || null,
    }
  }, [logs, filtered])

  const requirement = child.requirement
  const pace = useMemo(() => goalPace({
    target: requirement?.goalHours,
    total: stats.total,
    deadline: requirement?.deadline,
    logs,
  }), [requirement?.goalHours, requirement?.deadline, stats.total, logs])

  const visible = showAll ? filtered : filtered.slice(0, ROWS_BEFORE_FOLD)
  const filtering = Boolean(from || to || category)

  const exportPdf = async () => {
    setExporting(true)
    try {
      await exportLogsPDF({ user: { name: child.name, email: child.email }, logs: filtered })
    } finally { setExporting(false) }
  }

  const exportCsv = () => exportLogsCSV(filtered)

  return (
    <Card data-tour="child-card">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-display font-semibold">{child.name}</h3>
          <p className="text-xs text-earth-400">
            {child.email}
            {child.grade && <> · {gradeOptionLabel(child.grade)}</>}
          </p>
        </div>
        <div className="text-sm font-medium text-brand-600">{fmtHours(stats.total)} total</div>
      </div>

      {requirement?.goalHours != null && (
        <div className="mb-4 p-3 rounded-xl border border-earth-100 dark:border-[#1f2e25]">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <p className="text-sm font-medium">
              {requirement.schoolName ? `${requirement.schoolName} requires` : 'School requirement'} {fmtHours(requirement.goalHours)}
              {requirement.deadline && <span className="text-earth-500 dark:text-earth-400"> by {fmtDate(requirement.deadline)}</span>}
            </p>
            <p className="text-sm font-medium">
              {stats.total >= requirement.goalHours
                ? <span className="text-brand-600">Requirement met</span>
                : `${fmtHours(requirement.goalHours - stats.total)} to go`}
            </p>
          </div>
          <ProgressBar value={stats.total} target={requirement.goalHours} />
          {pace.hasDeadline && !pace.met && (
            <p className={`text-xs mt-2 ${PACE_TONE[pace.status] || 'text-earth-500'}`}>
              {paceSummary(pace, { formatHours: paceHours })}
              {paceStanding(pace, { formatHours: paceHours }) && ` · ${paceStanding(pace, { formatHours: paceHours })}`}
            </p>
          )}
          {requirement.note && <p className="text-xs text-earth-400 mt-1">{requirement.note}</p>}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <Stat label="This month" value={fmtHours(stats.thisMonth)} />
        <Stat label="Last logged" value={stats.lastDate ? fromNow(stats.lastDate) : 'Never'} />
        <Stat label="Approved" value={fmtHours(stats.approved)} />
        <Stat
          label="Awaiting review"
          value={fmtHours(stats.pending)}
          tone={stats.pending > 0 ? 'amber' : undefined}
        />
      </div>

      {stats.rejected > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mb-3 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {stats.rejected} {stats.rejected === 1 ? 'entry was' : 'entries were'} rejected — your child can edit and resubmit {stats.rejected === 1 ? 'it' : 'them'}.
        </p>
      )}

      {logs.length === 0 ? (
        <p className="text-sm text-earth-500 dark:text-earth-400">No hours logged yet.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <div>
              <label htmlFor={`from-${child.id}`} className="block text-[11px] text-earth-400 mb-1">From</label>
              <input id={`from-${child.id}`} type="date" className="input w-[145px]" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label htmlFor={`to-${child.id}`} className="block text-[11px] text-earth-400 mb-1">To</label>
              <input id={`to-${child.id}`} type="date" className="input w-[145px]" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div>
              <label htmlFor={`cat-${child.id}`} className="block text-[11px] text-earth-400 mb-1">Category</label>
              <select id={`cat-${child.id}`} className="input w-[170px]" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {ACTIVITY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {filtering && (
              <button onClick={() => { setFrom(''); setTo(''); setCategory('') }} className="btn-sm btn-ghost">Clear</button>
            )}
            <div className="flex-1" />
            <button onClick={exportPdf} disabled={exporting || filtered.length === 0} className="btn-sm btn-ghost disabled:opacity-40">
              <Download className="w-3.5 h-3.5 mr-1" /> {exporting ? 'Preparing…' : 'PDF'}
            </button>
            <button onClick={exportCsv} disabled={filtered.length === 0} className="btn-sm btn-ghost disabled:opacity-40">
              <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> CSV
            </button>
          </div>

          <p className="text-xs text-earth-400 mb-2 flex items-center gap-1.5">
            <CalIcon className="w-3.5 h-3.5 shrink-0" />
            {filtered.length === logs.length
              ? `${logs.length} ${logs.length === 1 ? 'session' : 'sessions'}, ${fmtHours(stats.total)}`
              : `${filtered.length} of ${logs.length} sessions, ${fmtHours(stats.filtered)}`}
          </p>

          {filtered.length === 0 ? (
            <p className="text-sm text-earth-500 dark:text-earth-400">No sessions match those filters.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-earth-500 dark:text-earth-400">
                    <tr>
                      <th className="text-left py-2">Date</th>
                      <th className="text-left py-2">Activity</th>
                      <th className="text-left py-2">Status</th>
                      <th className="text-right py-2">Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((l) => (
                      <tr key={l.id} className="border-t border-earth-100 dark:border-[#1f2e25]">
                        <td className="py-2 whitespace-nowrap">{fmtDate(l.date)}</td>
                        <td className="py-2">{l.activity || '—'}</td>
                        <td className="py-2"><VerificationBadge status={l.verification_status} /></td>
                        <td className="py-2 text-right font-medium">{fmtHours(Number(l.hours) || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length > ROWS_BEFORE_FOLD && (
                <button onClick={() => setShowAll((v) => !v)} className="mt-3 text-xs text-brand-600 hover:underline">
                  {showAll ? 'Show fewer' : `Show all ${filtered.length} sessions`}
                </button>
              )}
            </>
          )}
        </>
      )}
    </Card>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-xl bg-earth-50 dark:bg-[#0f1a14] px-3 py-2">
      <div className="text-[11px] text-earth-500 dark:text-earth-400">{label}</div>
      <div className={`font-semibold mt-0.5 ${tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : ''}`}>{value}</div>
    </div>
  )
}
