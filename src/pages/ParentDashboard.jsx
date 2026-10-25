import { useEffect, useState, useCallback, useMemo } from 'react'
import { Users, AlertTriangle, RefreshCw, Mail, Download, FileSpreadsheet, Calendar as CalIcon, CalendarClock, MapPin } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import ProgressBar from '@/components/ProgressBar.jsx'
import VerificationBadge from '@/components/VerificationBadge.jsx'
import SpotlightTour from '@/components/SpotlightTour.jsx'
import AnnouncementBanner from '@/components/AnnouncementBanner.jsx'
import { fmtDate, fmtHours, fromNow } from '@/utils/date.js'
import { goalPace, paceSummary, paceStanding } from '@/lib/pace.js'
import { gradeOptionLabel } from '@policy'
import { ACTIVITY_CATEGORIES } from '@/lib/categories.js'
import { exportLogsPDF, exportLogsCSV } from '@/lib/export.js'
import { countedLogs } from '@/lib/achievements.js'
import { format } from 'date-fns'
import { tr } from '@/lib/i18n.js'

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

// Logs carry a date with no time, and fromNow() reads that as midnight UTC —
// an entry made a minute ago showed as "about 18 hours ago".
function dayFromNow(dateStr) {
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const now = new Date()
  if (dateStr === ymd(now)) return 'Today'
  if (dateStr === ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return 'Yesterday'
  return fromNow(dateStr)
}

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
      // Tasks are a side panel: a failure leaves `tasks` null so the card says
      // it couldn't load them, rather than claiming there are none.
      const tasksByChild = await Promise.all(
        (kids || []).map((c) =>
          fetch(`${apiUrl}/parent/children/${encodeURIComponent(c.id)}/tasks`, { headers })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ),
      )
      setChildren((kids || []).map((c, i) => ({ ...c, logs: logsByChild[i].logs || [], tasks: tasksByChild[i] })))
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

      <AnnouncementBanner />

      <TaskApprovals onDecided={loadData} />

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
    const today = format(now, 'yyyy-MM-dd')
    // A log can carry a future date — a shift entered ahead of time, or a
    // typo. It is still their total, but it is not something they did this
    // month and it is certainly not when they last volunteered.
    const past = logs.filter((l) => String(l.date || '') <= today)
    // Rejected hours are listed but never counted, same as the school's total.
    const counted = countedLogs(logs)
    return {
      total: sum(counted),
      filtered: sum(countedLogs(filtered)),
      thisMonth: sum(counted.filter((l) => String(l.date || '').slice(0, 7) === monthKey)),
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
    logs: countedLogs(logs),
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
        <Stat label="Last logged" value={stats.lastDate ? dayFromNow(stats.lastDate) : 'Never'} />
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

      <ChildTasks tasks={child.tasks} />

      {logs.length === 0 ? (
        <p className="text-sm text-earth-500 dark:text-earth-400">No hours logged yet.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <div>
              <label htmlFor={`from-${child.id}`} className="block text-[0.6875rem] text-earth-400 mb-1">From</label>
              <input id={`from-${child.id}`} type="date" className="input w-[145px]" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label htmlFor={`to-${child.id}`} className="block text-[0.6875rem] text-earth-400 mb-1">To</label>
              <input id={`to-${child.id}`} type="date" className="input w-[145px]" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div>
              <label htmlFor={`cat-${child.id}`} className="block text-[0.6875rem] text-earth-400 mb-1">Category</label>
              <select id={`cat-${child.id}`} className="input w-[170px]" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {ACTIVITY_CATEGORIES.map((c) => <option key={c} value={c}>{tr(c)}</option>)}
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
                      <th className="py-2"><span className="sr-only">Cheer</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((l) => (
                      <tr key={l.id} className="border-t border-earth-100 dark:border-[#1f2e25]">
                        <td className="py-2 whitespace-nowrap">{fmtDate(l.date)}</td>
                        <td className="py-2">{l.activity || '—'}</td>
                        <td className="py-2"><VerificationBadge status={l.verification_status} /></td>
                        <td className="py-2 text-right font-medium">{fmtHours(Number(l.hours) || 0)}</td>
                        <td className="py-2 pl-3 text-right"><CheerButton log={l} childName={child.name} /></td>
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

// "Proud of you" on one entry (#514): the child gets a bell notification.
// Once per entry; the server ignores a repeat.
function CheerButton({ log, childName }) {
  const [state, setState] = useState(log.cheeredByMe ? 'done' : 'idle')
  const first = String(childName || '').trim().split(/\s+/)[0] || 'them'
  const cheer = async () => {
    setState('busy')
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/parent/cheer/${encodeURIComponent(log.id)}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
      setState(res.ok ? 'done' : 'idle')
    } catch {
      setState('idle')
    }
  }
  if (state === 'done') {
    return <span className="text-xs text-brand-600 dark:text-brand-400 whitespace-nowrap" title={`${first} got your cheer`}>🎉 Sent</span>
  }
  return (
    <button
      type="button"
      onClick={cheer}
      disabled={state === 'busy'}
      className="text-xs font-medium px-2 py-1 rounded-full border border-earth-200 dark:border-earth-700 hover:bg-brand-50 dark:hover:bg-brand-900/20 whitespace-nowrap"
      title={`Tell ${first} you're proud of them`}
    >
      🎉 Proud of you
    </button>
  )
}

const TASK_STATUS_TONE = {
  approved: 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300',
  pending: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
  waitlisted: 'bg-earth-100 text-earth-600 dark:bg-[#1f2e25] dark:text-earth-300',
  parent_pending: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
}

function taskStatusLabel(t) {
  if (t.checkedOutAt) return 'Checked out'
  if (t.checkedInAt) return 'Checked in'
  if (t.status === 'approved') return 'Approved'
  if (t.status === 'waitlisted') return t.waitlistPosition ? `Waitlist #${t.waitlistPosition}` : 'On the waitlist'
  if (t.status === 'parent_pending') return 'Waiting for your OK'
  return 'Waiting for approval'
}

const TASKS_BEFORE_FOLD = 5

function localToday() {
  return format(new Date(), 'yyyy-MM-dd')
}

// The volunteer tasks a child signed up for on Opportunities. The server
// counts "upcoming" from yesterday in UTC, so re-split on this device's date.
// A task checked out of today is finished, so it's recent, not upcoming.
function ChildTasks({ tasks }) {
  const [showAll, setShowAll] = useState(false)
  const { upcoming, recent } = useMemo(() => {
    if (!tasks) return { upcoming: [], recent: [] }
    const today = localToday()
    const all = [...(tasks.upcoming || []), ...(tasks.recent || [])]
    const done = (t) => t.date < today || Boolean(t.checkedOutAt)
    return {
      upcoming: all.filter((t) => !done(t)),
      recent: all.filter(done)
        .sort((a, b) => b.date.localeCompare(a.date) || String(b.checkedOutAt || '').localeCompare(String(a.checkedOutAt || '')))
        .slice(0, 3),
    }
  }, [tasks])

  return (
    <div className="mb-4 p-3 rounded-xl border border-earth-100 dark:border-[#1f2e25]">
      <h4 className="text-sm font-medium flex items-center gap-1.5 mb-2">
        <CalendarClock className="w-4 h-4 text-brand-600 shrink-0" /> Upcoming tasks
      </h4>
      {tasks == null ? (
        <p className="text-sm text-earth-500 dark:text-earth-400">Could not load their volunteer tasks right now.</p>
      ) : upcoming.length === 0 ? (
        <p className="text-sm text-earth-500 dark:text-earth-400">No upcoming tasks.</p>
      ) : (
        <ul className="divide-y divide-earth-100 dark:divide-[#1f2e25]">
          {(showAll ? upcoming : upcoming.slice(0, TASKS_BEFORE_FOLD)).map((t) => <TaskRow key={t.signupId} task={t} />)}
        </ul>
      )}
      {upcoming.length > TASKS_BEFORE_FOLD && (
        <button onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs text-brand-600 hover:underline">
          {showAll ? 'Show fewer' : `Show all ${upcoming.length} upcoming tasks`}
        </button>
      )}
      {recent.length > 0 && (
        <>
          <p className="text-[0.6875rem] text-earth-400 mt-3 mb-1">Recently</p>
          <ul className="divide-y divide-earth-100 dark:divide-[#1f2e25] opacity-80">
            {recent.map((t) => <TaskRow key={t.signupId} task={t} />)}
          </ul>
        </>
      )}
    </div>
  )
}

function TaskRow({ task }) {
  const tone = task.checkedInAt || task.checkedOutAt ? TASK_STATUS_TONE.approved : TASK_STATUS_TONE[task.status] || TASK_STATUS_TONE.pending
  return (
    <li className="py-2 flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium break-words">{task.title}</p>
        <p className="text-xs text-earth-500 dark:text-earth-400 mt-0.5">
          {task.date === localToday() ? 'Today' : fmtDate(task.date)}
          {task.time && <> · {task.time}</>}
        </p>
        <p className="text-xs text-earth-500 dark:text-earth-400 mt-0.5 flex items-start gap-1">
          <MapPin className="w-3 h-3 mt-0.5 shrink-0" />
          <span className="break-words">
            {task.location}
            {task.organizerName && <> · Organized by {task.organizerName}</>}
          </span>
        </p>
      </div>
      <span className={`text-[0.6875rem] font-medium px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${tone}`}>{taskStatusLabel(task)}</span>
    </li>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-xl bg-earth-50 dark:bg-[#0f1a14] px-3 py-2">
      <div className="text-[0.6875rem] text-earth-500 dark:text-earth-400">{label}</div>
      <div className={`font-semibold mt-0.5 ${tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : ''}`}>{value}</div>
    </div>
  )
}

// Under-13 sign-ups waiting for a parent (GET /api/parent/task-approvals).
// The organizer doesn't see one until a parent approves; any linked parent
// may decide, and the first answer counts. Renders nothing when none wait.
function TaskApprovals({ onDecided }) {
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(null)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/parent/task-approvals`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setItems((await res.json()).approvals || [])
    } catch {
      // The children's cards still load; this panel just stays empty.
    }
  }, [])

  useEffect(() => { load() }, [load])

  const decide = async (item, approve) => {
    setBusy(item.signupId)
    setMessage('')
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/parent/task-approvals/${encodeURIComponent(item.signupId)}/${approve ? 'approve' : 'decline'}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not save your answer.')
      const first = String(item.childName || '').split(/\s+/)[0] || 'Your child'
      setMessage(!approve
        ? `Declined. ${first}'s sign-up for ${item.title} was not sent to the organizer.`
        : d.status === 'waitlisted'
          ? `Approved. ${item.title} filled up meanwhile, so ${first} is on the waitlist.`
          : `Approved. The organizer will now confirm ${first}'s sign-up for ${item.title}.`)
      await load()
      onDecided?.()
    } catch (e) {
      setMessage(e.message)
      load()
    } finally {
      setBusy(null)
    }
  }

  if (items.length === 0 && !message) return null
  return (
    <Card className="mb-5">
      <h3 className="font-display font-semibold text-sm flex items-center gap-1.5">
        <CalendarClock className="w-4 h-4 text-amber-600 shrink-0" /> Waiting for your OK
      </h3>
      <p className="text-xs text-earth-500 dark:text-earth-400 mt-0.5">
        Your child is under 13, so these sign-ups reach the organizer only after you approve them.
      </p>
      {message && <p className="text-sm mt-2 text-brand-700 dark:text-brand-300" role="status">{message}</p>}
      {items.length > 0 && (
        <ul className="divide-y divide-earth-100 dark:divide-[#1f2e25] mt-2">
          {items.map((item) => (
            <li key={item.signupId} className="py-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium break-words">{item.childName} · {item.title}</p>
                <p className="text-xs text-earth-500 dark:text-earth-400 mt-0.5">
                  {fmtDate(item.date)}{item.time && <> · {item.time}</>}
                </p>
                <p className="text-xs text-earth-500 dark:text-earth-400 mt-0.5 flex items-start gap-1">
                  <MapPin className="w-3 h-3 mt-0.5 shrink-0" />
                  <span className="break-words">
                    {item.location}
                    {item.organizerName && <> · Organized by {item.organizerName}</>}
                  </span>
                </p>
                {item.description && <p className="text-xs text-earth-500 dark:text-earth-400 mt-1 break-words">{item.description}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => decide(item, true)} disabled={busy === item.signupId} className="btn-primary btn-sm disabled:opacity-50">
                  {busy === item.signupId ? 'Saving…' : 'Approve'}
                </button>
                <button onClick={() => decide(item, false)} disabled={busy === item.signupId} className="btn-ghost btn-sm disabled:opacity-50">
                  Decline
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
