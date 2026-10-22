import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp, MapPin, Calendar as CalIcon, Users, Clock, Phone, CheckCircle, XCircle, MinusCircle, Plus, Send, GraduationCap, Pencil, Lock, Unlock, Mail, Ban, Heart, BarChart3, Download, FileSpreadsheet, QrCode, Copy, Printer } from 'lucide-react'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import SignaturePad from '@/components/SignaturePad.jsx'
import LocationPicker from '@/components/LocationPicker.jsx'
import { useData } from '@/hooks/useData.jsx'
import { useAuth } from '@/hooks/useAuth.jsx'
import { csvCell } from '@/lib/csv.js'
import { fmtDate } from '@/utils/date.js'
import { ACTIVITY_CATEGORIES } from '@/lib/categories.js'
import CheckinQrModal from '@/components/CheckinQrModal.jsx'
import OrganizerStats from '@/components/OrganizerStats.jsx'
import TaskDetailFields, { OnlineToggle } from '@/components/TaskDetailFields.jsx'
import TaskDetailBadges from '@/components/TaskDetailBadges.jsx'
import { EMPTY_TASK_DETAILS, taskDetailsFromRow } from '@/lib/taskDetails.js'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
// The device's own date, as YYYY-MM-DD: a task is "past" once its day is.
const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const THANKS_MAX = 500
const defaultThanks = (title) => tr('Thank you so much for volunteering at {title}! Your time and effort made a real difference, and we hope to see you again soon.', { title })
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

const EMPTY_TASK_FORM = { title: '', description: '', location: '', date: '', time: '', slotsTotal: 1, phone: '', importantInfo: '', latitude: null, longitude: null, category: '', repeatWeeks: 1, ...EMPTY_TASK_DETAILS }

export default function MyTasks() {
  const { refreshLogs } = useData()
  const { user } = useAuth()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [logForm, setLogForm] = useState({ volunteerId: '', taskId: '', hours: '', date: '' })
  const [showLogForm, setShowLogForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const [showPostTask, setShowPostTask] = useState(false)
  const [taskForm, setTaskForm] = useState(EMPTY_TASK_FORM)
  // The title of the task the form was copied from by "Post again", if any.
  const [postAgainFrom, setPostAgainFrom] = useState(null)
  // "Repeat weekly" ticked: taskForm.repeatWeeks more copies, 7 days apart.
  const [repeatWeekly, setRepeatWeekly] = useState(false)
  const [taskBusy, setTaskBusy] = useState(false)
  const [batchHours, setBatchHours] = useState({})
  const [batchDate, setBatchDate] = useState('')
  const [batchBusy, setBatchBusy] = useState(false)
  const [students, setStudents] = useState([])
  const [studentsLoading, setStudentsLoading] = useState(true)
  // Editing, cancelling and messaging are all per-task panels rather than
  // modals: the organizer is looking at the task they mean to act on.
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [cancellingId, setCancellingId] = useState(null)
  const [checkinTask, setCheckinTask] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [messagingId, setMessagingId] = useState(null)
  const [messageDraft, setMessageDraft] = useState('')
  // The thank-you note panel (POST /public-tasks/:id/thanks): one per task.
  const [thankingId, setThankingId] = useState(null)
  const [thanksDraft, setThanksDraft] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [report, setReport] = useState(null)
  const [reportRange, setReportRange] = useState({ from: '', to: '' })
  const [reportBusy, setReportBusy] = useState(false)
  const [showReport, setShowReport] = useState(false)
  // 'tasks' (the list) or 'stats' (OrganizerStats + the impact report).
  const [view, setView] = useState('tasks')

  const loadReport = useCallback(async (range) => {
    setReportBusy(true)
    try {
      const params = new URLSearchParams()
      if (range?.from) params.set('from', range.from)
      if (range?.to) params.set('to', range.to)
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/public-tasks/mine/report?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) setReport(await res.json())
    } catch {
      // The report is a read of data already on screen elsewhere; a failure
      // here should not disturb the task list.
    } finally { setReportBusy(false) }
  }, [])

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}`,
  })

  const reportCSV = () => {
    if (!report) return
    const rows = [
      ['Date', 'Event', 'Location', 'Status', 'Approved', 'Present', 'Absent', 'Excused', 'Hours'],
      ...report.tasks.map((t) => [
        String(t.date || '').slice(0, 10),
        t.title || '',
        t.location || '',
        t.status, t.approved, t.present, t.absent, t.excused, t.hours,
      ]),
    ]
    const blob = new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `volunteer-impact-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const reportPDF = async () => {
    if (!report) return
    const { schoolHoursPDF } = await import('@/lib/export.js')
    await schoolHoursPDF({
      title: 'Volunteer impact report',
      range: [report.from, report.to].filter(Boolean).join(' to ') || 'All time',
      // schoolHoursPDF draws a per-row table; an event maps onto the same
      // shape as a student (a name, a count, two hour columns).
      students: report.tasks.map((t) => ({
        name: `${String(t.date || '').slice(0, 10)} · ${t.title}`,
        grade: t.status,
        logCount: t.approved,
        approvedHours: t.hours,
        pendingHours: 0,
      })),
      totals: { students: report.totals.volunteers, logs: report.totals.events, hours: report.totals.hours },
    })
  }

  // A paper sign-in sheet for events where volunteers don't have phones:
  // approved volunteers by name only, plus blank rows for walk-ins. Built in
  // the browser from the task already on screen — nothing new is fetched.
  const [sheetBusyId, setSheetBusyId] = useState(null)
  const signInSheet = async (t) => {
    setSheetBusyId(t.id)
    try {
      const { generateSignInSheetPDF } = await import('@/lib/export.js')
      await generateSignInSheetPDF(t, { organizerName: user?.name })
    } catch {
      setToastMsg('Could not create the sign-in sheet'); setToast(true)
    } finally { setSheetBusyId(null) }
  }

  const startEdit = (t) => {
    setEditingId(t.id)
    setCancellingId(null)
    setMessagingId(null)
    setEditForm({
      title: t.title || '',
      description: t.description || '',
      location: t.location || '',
      // The row carries a timestamp; the date input wants a plain day.
      date: String(t.date || '').slice(0, 10),
      time: t.time || '',
      slotsTotal: Number(t.slots_total) || 1,
      phone: t.phone || '',
      importantInfo: t.important_info || '',
      latitude: t.latitude ?? null,
      longitude: t.longitude ?? null,
      category: t.category || '',
      ...taskDetailsFromRow(t),
    })
  }

  const saveEdit = async (taskId) => {
    setActionBusy(true)
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${taskId}`, {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify(editForm),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not save the changes')
      setEditingId(null)
      setEditForm(null)
      setToastMsg('Task updated')
      setToast(true)
      loadTasks()
    } catch (e) {
      setToastMsg(e.message); setToast(true)
    } finally { setActionBusy(false) }
  }

  const setTaskStatus = async (taskId, status) => {
    setActionBusy(true)
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${taskId}/status`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ status }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not change the status')
      setToastMsg(status === 'closed' ? 'Signups closed' : 'Signups reopened')
      setToast(true)
      loadTasks()
    } catch (e) {
      setToastMsg(e.message); setToast(true)
    } finally { setActionBusy(false) }
  }

  const cancelTask = async (taskId) => {
    setActionBusy(true)
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${taskId}/cancel`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ reason: cancelReason.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not cancel the task')
      setCancellingId(null)
      setCancelReason('')
      setToastMsg(data.notified ? `Cancelled — ${data.notified} volunteer${data.notified === 1 ? '' : 's'} notified` : 'Task cancelled')
      setToast(true)
      loadTasks()
    } catch (e) {
      setToastMsg(e.message); setToast(true)
    } finally { setActionBusy(false) }
  }

  const messageVolunteers = async (taskId) => {
    setActionBusy(true)
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${taskId}/message`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ message: messageDraft.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not send your message')
      setMessagingId(null)
      setMessageDraft('')
      setToastMsg(`Sent to ${data.sent} volunteer${data.sent === 1 ? '' : 's'}`)
      setToast(true)
    } catch (e) {
      setToastMsg(e.message); setToast(true)
    } finally { setActionBusy(false) }
  }

  const sendThanks = async (taskId) => {
    setActionBusy(true)
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${taskId}/thanks`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ message: thanksDraft.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || tr('Could not send your thank-you'))
      setThankingId(null)
      setThanksDraft('')
      setToastMsg(data.recipients === 1 ? tr('Thank-you sent to 1 volunteer') : tr('Thank-you sent to {n} volunteers', { n: data.recipients }))
      setToast(true)
      loadTasks()
    } catch (e) {
      setToastMsg(e.message); setToast(true)
    } finally { setActionBusy(false) }
  }

  const loadTasks = useCallback(async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/public-tasks/mine`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) { const d = await res.json(); setTasks(d.tasks || []) }
    } catch {} finally { setLoading(false) }
  }, [])

  const loadStudents = useCallback(async () => {
    setStudentsLoading(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/my-students`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) { const d = await res.json(); setStudents(d.students || []) }
    } catch {} finally { setStudentsLoading(false) }
  }, [])

  useEffect(() => { loadTasks(); loadStudents() }, [loadTasks, loadStudents])

  // The log whose Approve was clicked: approving is a sign-off, so it waits
  // for the organizer's signature. { logId, signature }
  const [signing, setSigning] = useState(null)

  const handleVerifyLog = async (studentId, logId, status, signature = null) => {
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/students/${studentId}/logs/${logId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status, ...(signature ? { signature } : {}) }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
      setToastMsg(status === 'approved' ? 'Hours signed and approved' : 'Hours rejected'); setToast(true)
      setSigning(null)
      loadStudents()
    } catch (e) { setToastMsg(e.message); setToast(true) }
  }

  // Bulk approve/reject: the ticked pending logs ({ [logId]: studentId }) and
  // the open confirm panel ({ status, signature }) — one signature covers
  // every approval in the batch.
  const [selectedLogs, setSelectedLogs] = useState({})
  const [bulk, setBulk] = useState(null)
  const [bulkBusy, setBulkBusy] = useState(false)

  const pendingLogs = students.flatMap((s) => s.logs
    .filter((l) => l.verification_status !== 'approved' && l.verification_status !== 'rejected')
    .map((l) => ({ studentId: s.id, logId: l.id })))
  // Only what is still pending counts, so a row decided elsewhere drops out.
  const selectedPending = pendingLogs.filter((p) => selectedLogs[p.logId])
  const allPendingSelected = pendingLogs.length > 0 && selectedPending.length === pendingLogs.length

  const toggleLog = (studentId, logId) => setSelectedLogs((cur) => {
    const next = { ...cur }
    if (next[logId]) delete next[logId]; else next[logId] = studentId
    return next
  })
  const toggleAllPending = () => setSelectedLogs(
    allPendingSelected ? {} : Object.fromEntries(pendingLogs.map((p) => [p.logId, p.studentId])),
  )

  const handleBulkVerify = async () => {
    if (!bulk || selectedPending.length === 0) return
    const { status, signature } = bulk
    setBulkBusy(true)
    let ok = 0
    let failed = 0
    let firstError = ''
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      // The server takes at most 100 per request.
      for (let i = 0; i < selectedPending.length; i += 100) {
        const items = selectedPending.slice(i, i + 100)
        const res = await fetch(`${apiUrl}/school/logs/verify-bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ items, status, ...(status === 'approved' ? { signature } : {}) }),
        })
        const d = await res.json().catch(() => ({}))
        if (!res.ok) {
          failed += items.length
          firstError ||= d.error || tr('Could not update these hours.')
          continue
        }
        for (const r of d.results || []) {
          if (r.ok) ok += 1
          else { failed += 1; firstError ||= r.error || '' }
        }
      }
    } catch (e) {
      firstError ||= e.message
      failed = selectedPending.length - ok
    }
    const summary = status === 'approved'
      ? (failed ? tr('Approved {ok}, {failed} failed', { ok, failed }) : tr('Approved {ok}', { ok }))
      : (failed ? tr('Rejected {ok}, {failed} failed', { ok, failed }) : tr('Rejected {ok}', { ok }))
    setToastMsg(failed && firstError ? `${summary} — ${firstError}` : summary)
    setToast(true)
    setBulk(null)
    setSelectedLogs({})
    setBulkBusy(false)
    loadStudents()
  }

  const handleMarkAttendance = async (taskId, userId, status) => {
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/public-tasks/${taskId}/attendance/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
      setToastMsg(`Marked ${status}`); setToast(true)
      loadTasks()
    } catch (e) { setToastMsg(e.message); setToast(true) }
  }

  const handleLogHours = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/public-tasks/${logForm.taskId}/log-hours`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ volunteerId: logForm.volunteerId, hours: logForm.hours, date: logForm.date || undefined }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
      setToastMsg('Hours logged!'); setToast(true)
      setShowLogForm(false); setLogForm({ volunteerId: '', taskId: '', hours: '', date: '' })
      refreshLogs(); loadTasks()
    } catch (e) { setToastMsg(e.message); setToast(true) } finally { setBusy(false) }
  }

  const handleApprove = async (taskId, userId) => {
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/public-tasks/${taskId}/approve/${userId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
      setToastMsg('Signup approved — contact info shared'); setToast(true); loadTasks()
    } catch (e) { setToastMsg(e.message); setToast(true) }
  }

  const handleReject = async (taskId, userId) => {
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/public-tasks/${taskId}/reject/${userId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
      setToastMsg('Signup rejected'); setToast(true); loadTasks()
    } catch (e) { setToastMsg(e.message); setToast(true) }
  }

  const openLogForm = (taskId, volunteerId, taskDate) => {
    setLogForm({ volunteerId, taskId, hours: '', date: taskDate || '' })
    setShowLogForm(true)
  }

  const handleBatchLog = async (taskId, taskDate) => {
    const entries = Object.entries(batchHours)
      .filter(([, hrs]) => hrs && Number(hrs) > 0)
      .map(([volunteerId, hours]) => ({ volunteerId, hours: Number(hours) }))
    if (entries.length === 0) { setToastMsg('Enter hours for at least one volunteer'); setToast(true); return }
    setBatchBusy(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/public-tasks/${taskId}/log-hours-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ entries, date: batchDate || taskDate || undefined }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
      const d = await res.json()
      setToastMsg(`Logged hours for ${d.logged} volunteer${d.logged === 1 ? '' : 's'}${d.skipped ? ` · ${d.skipped} already had hours for that day` : ''}`); setToast(true)
      setBatchHours({}); setBatchDate('')
      refreshLogs(); loadTasks()
    } catch (e) { setToastMsg(e.message); setToast(true) } finally { setBatchBusy(false) }
  }

  const handlePostTask = async (e) => {
    e.preventDefault(); setTaskBusy(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/public-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...taskForm, repeatWeeks: repeatWeekly ? Number(taskForm.repeatWeeks) : 0 }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed')
      setTaskForm(EMPTY_TASK_FORM); setPostAgainFrom(null); setRepeatWeekly(false)
      setShowPostTask(false); loadTasks()
      setToastMsg(d.createdCount > 1 ? `Posted ${d.createdCount} tasks, one a week` : 'Task posted!'); setToast(true)
    } catch (e) { setToastMsg(e.message); setToast(true) } finally { setTaskBusy(false) }
  }

  const togglePostForm = () => {
    // Closing a copied form drops the copy, so "Post a task" starts blank.
    if (showPostTask && postAgainFrom) { setPostAgainFrom(null); setTaskForm(EMPTY_TASK_FORM) }
    setView('tasks')
    setShowPostTask((s) => !s)
  }

  // "Post again": the create form, filled in from an earlier task. The date
  // is left empty so it can't go out on the old day by mistake, and nothing
  // about who signed up or showed up carries over — it's a new task.
  const postAgain = (t) => {
    setTaskForm({
      ...EMPTY_TASK_FORM,
      title: t.title || '',
      description: t.description || '',
      location: t.location || '',
      time: t.time || '',
      slotsTotal: Number(t.slots_total) || 1,
      phone: t.phone || '',
      importantInfo: t.important_info || '',
      latitude: t.latitude ?? null,
      longitude: t.longitude ?? null,
      category: t.category || '',
      ...taskDetailsFromRow(t),
    })
    setPostAgainFrom(t.title || 'an earlier task')
    setShowPostTask(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <AppLayout
      title="My Tasks"
      subtitle="Needed Volunteers"
      action={
        <button onClick={togglePostForm} className="btn-primary">
          <Plus className="w-4 h-4" /> {showPostTask ? 'Cancel' : 'Post a task'}
        </button>
      }
    >
      <div className="max-w-3xl mx-auto space-y-4">
        <div role="tablist" aria-label="My Tasks view" className="inline-flex gap-1 p-1 rounded-xl bg-earth-100 dark:bg-white/5">
          {[['tasks', 'Tasks'], ['stats', 'Stats']].map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={`px-4 py-1.5 rounded-lg text-sm ${view === id ? 'bg-white dark:bg-[#1b2a22] font-medium shadow-sm' : 'text-earth-500 hover:text-earth-800 dark:hover:text-earth-200'}`}
            >
              {id === 'stats' && <BarChart3 className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />}{label}
            </button>
          ))}
        </div>

        {view === 'stats' && <OrganizerStats />}

        {view === 'tasks' && showPostTask && (
          <Card>
            <h3 className="font-semibold mb-3">Post a volunteer opportunity</h3>
            {postAgainFrom && (
              <p className="text-xs text-earth-500 -mt-2 mb-3">Copied from “{postAgainFrom}”. Pick a new date, check the details and post.</p>
            )}
            <form onSubmit={handlePostTask} className="space-y-3">
              <input className="input" maxLength={200} placeholder="Task title" value={taskForm.title} onChange={(e) => setTaskForm({...taskForm, title: e.target.value})} required />
              <textarea className="input" rows={2} maxLength={5000} placeholder="Description — what volunteers will do" value={taskForm.description} onChange={(e) => setTaskForm({...taskForm, description: e.target.value})} required />
              <OnlineToggle checked={taskForm.isOnline} onChange={(isOnline) => setTaskForm((f) => ({ ...f, isOnline }))} />
              {taskForm.isOnline ? (
                <input className="input" maxLength={300} aria-label={tr('Where to join (optional)')} placeholder={tr('Where to join (optional), e.g. Zoom link sent after approval')} value={taskForm.location} onChange={(e) => setTaskForm({ ...taskForm, location: e.target.value })} />
              ) : (
              <div>
                <label className="label text-xs">Location — where it happens *</label>
                <LocationPicker
                  address={taskForm.location}
                  lat={taskForm.latitude}
                  lng={taskForm.longitude}
                  placeholder="Location — where it happens"
                  onChange={({ address, lat, lng }) => setTaskForm((f) => ({ ...f, location: address, latitude: lat, longitude: lng }))}
                />
              </div>
              )}
              <textarea className="input" rows={2} maxLength={2000} placeholder="Important info — only shown to approved volunteers (e.g. what to bring, parking, contact details)" value={taskForm.importantInfo} onChange={(e) => setTaskForm({...taskForm, importantInfo: e.target.value})} />
              <input className="input" type="tel" maxLength={30} placeholder="Phone number — shown to approved volunteers" value={taskForm.phone} onChange={(e) => setTaskForm({...taskForm, phone: e.target.value})} required />
              <div>
                <label className="label text-xs" htmlFor="task-category">Category</label>
                <select id="task-category" className="input" value={taskForm.category} onChange={(e) => setTaskForm({ ...taskForm, category: e.target.value })}>
                  <option value="">No category</option>
                  {ACTIVITY_CATEGORIES.map((c) => <option key={c} value={c}>{tr(c)}</option>)}
                </select>
              </div>
              <TaskDetailFields idPrefix="new-task" value={taskForm} onChange={(patch) => setTaskForm((f) => ({ ...f, ...patch }))} />
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="label text-xs">Date *</label>
                  <input type="date" className="input" value={taskForm.date} onChange={(e) => setTaskForm({...taskForm, date: e.target.value})} required />
                </div>
                <div>
                  <label className="label text-xs">Time *</label>
                  <input type="time" className="input" value={taskForm.time} onChange={(e) => setTaskForm({...taskForm, time: e.target.value})} required />
                </div>
                <div>
                  <label className="label text-xs">Volunteers needed *</label>
                  <input type="number" className="input" min={1} placeholder="Slots" value={taskForm.slotsTotal} onChange={(e) => setTaskForm({...taskForm, slotsTotal: e.target.value})} required />
                </div>
              </div>
              {!taskForm.isOnline && !(taskForm.latitude && taskForm.longitude) && (
                <p className="text-xs text-earth-500">Pick a pin on the map above so this task can be sorted by distance.</p>
              )}
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={repeatWeekly} onChange={(e) => setRepeatWeekly(e.target.checked)} />
                  Repeat weekly
                </label>
                {repeatWeekly && (
                  <span className="flex items-center gap-2 text-earth-400">
                    — every week for
                    <input type="number" className="input w-20 py-1" min={1} max={12} aria-label="More weeks" value={taskForm.repeatWeeks} onChange={(e) => setTaskForm({ ...taskForm, repeatWeeks: e.target.value })} required />
                    more week{Number(taskForm.repeatWeeks) === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <button type="submit" className="btn-primary w-full" disabled={taskBusy}>{taskBusy ? 'Posting…' : 'Post task — no paperwork needed'}</button>
            </form>
          </Card>
        )}

        {/* What an organizer needs at grant time. Every figure was already in
            the tasks and their signups; nothing could read it back out. */}
        {view === 'stats' && <Card>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4 text-brand-600" /> Impact report</h3>
            <button
              onClick={() => { const next = !showReport; setShowReport(next); if (next && !report) loadReport(reportRange) }}
              className="btn-sm btn-ghost"
            >
              {showReport ? 'Hide' : 'Show'}
            </button>
          </div>
          {showReport && (
            <div className="mt-3">
              <div className="flex flex-wrap items-end gap-2 mb-3">
                <div>
                  <label htmlFor="report-from" className="block text-[0.6875rem] text-earth-400 mb-1">From</label>
                  <input id="report-from" type="date" className="input w-[145px]" value={reportRange.from} onChange={(e) => setReportRange((r) => ({ ...r, from: e.target.value }))} />
                </div>
                <div>
                  <label htmlFor="report-to" className="block text-[0.6875rem] text-earth-400 mb-1">To</label>
                  <input id="report-to" type="date" className="input w-[145px]" value={reportRange.to} onChange={(e) => setReportRange((r) => ({ ...r, to: e.target.value }))} />
                </div>
                <button onClick={() => loadReport(reportRange)} className="btn-sm btn-ghost" disabled={reportBusy}>
                  {reportBusy ? 'Loading…' : 'Apply'}
                </button>
                <div className="flex-1" />
                <button onClick={reportPDF} className="btn-sm btn-ghost disabled:opacity-40" disabled={!report || report.tasks.length === 0}>
                  <Download className="w-3.5 h-3.5 mr-1" /> PDF
                </button>
                <button onClick={reportCSV} className="btn-sm btn-ghost disabled:opacity-40" disabled={!report || report.tasks.length === 0}>
                  <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> CSV
                </button>
              </div>

              {!report ? (
                <p className="text-sm text-earth-500">Loading…</p>
              ) : report.tasks.length === 0 ? (
                <p className="text-sm text-earth-500">No events in that range.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    <ReportStat label="Events" value={report.totals.events} />
                    <ReportStat label="Volunteers" value={report.totals.volunteers} />
                    <ReportStat label="Hours logged" value={report.totals.hours} />
                    <ReportStat
                      label="Attendance"
                      value={report.totals.attendanceRate == null ? 'Not marked' : `${Math.round(report.totals.attendanceRate * 100)}%`}
                    />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-earth-500">
                        <tr>
                          <th className="text-left py-2">Date</th>
                          <th className="text-left py-2">Event</th>
                          <th className="text-right py-2">Approved</th>
                          <th className="text-right py-2">Present</th>
                          <th className="text-right py-2">Hours</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.tasks.map((t) => (
                          <tr key={t.id} className="border-t border-white/10">
                            <td className="py-2 whitespace-nowrap">{String(t.date || '').slice(0, 10)}</td>
                            <td className="py-2">{t.title}{t.status === 'cancelled' && <span className="text-xs text-red-400"> · cancelled</span>}</td>
                            <td className="py-2 text-right">{t.approved}</td>
                            <td className="py-2 text-right">{t.present}</td>
                            <td className="py-2 text-right">{t.hours}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </Card>}

        {view !== 'tasks' ? null : loading ? (
          <Card><p className="text-center text-earth-500 py-8">Loading…</p></Card>
        ) : tasks.length === 0 ? (
          <Card>
            <p className="text-center text-earth-500 py-8">You haven't posted any tasks yet.</p>
          </Card>
        ) : tasks.map((t) => {
          const filled = Number(t.slots_filled)
          const total = Number(t.slots_total)
          const signups = t.signups || []
          const isExpanded = expanded === t.id
          return (
            <Card key={t.id} padded={false} className="p-4">
              <div
                className="flex items-start justify-between gap-4 cursor-pointer"
                onClick={() => setExpanded(isExpanded ? null : t.id)}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t.title}</p>
                  <p className="text-sm text-earth-400 mt-1">{t.description}</p>
                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-earth-500">
                    {!(t.is_online && t.location === 'Online') && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {t.location}</span>}
                    <span className="flex items-center gap-1"><CalIcon className="w-3 h-3" /> {fmtDate(t.date)}{t.time ? ` · ${t.time}` : ''}</span>
                    <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {filled}/{total} signed up</span>
                    {t.rating_count > 0 && (
                      <span className="flex items-center gap-1 text-amber-400" title="Average rating from volunteers who came">
                        ★ {Number(t.rating_avg).toFixed(1)} <span className="text-earth-500">({t.rating_count} {t.rating_count === 1 ? 'rating' : 'ratings'})</span>
                      </span>
                    )}
                  </div>
                  <TaskDetailBadges task={t} className="mt-2" />
                  {t.phone && (
                    <p className="text-xs text-earth-500 mt-1 flex items-center gap-1"><Phone className="w-3 h-3" /> {t.phone}</p>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    t.status === 'open' ? 'bg-emerald-500/10 text-emerald-300'
                      : t.status === 'cancelled' ? 'bg-red-500/10 text-red-300'
                        : 'bg-earth-800 text-earth-400'
                  }`}>
                    {t.status}
                  </span>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-earth-400" /> : <ChevronDown className="w-4 h-4 text-earth-400" />}
                </div>
              </div>

              {t.status === 'cancelled' && t.cancelled_reason && (
                <p className="mt-2 text-xs text-red-300">Cancelled: {t.cancelled_reason}</p>
              )}

              {/* Volunteers' comments from their ratings — no names, by design. */}
              {t.rating_comments?.length > 0 && (
                <details className="mt-2 text-xs group">
                  <summary className="cursor-pointer text-earth-400 hover:text-earth-200 select-none">
                    {t.rating_comments.length === 1 ? '1 comment' : `${t.rating_comments.length} comments`} from volunteers
                  </summary>
                  <ul className="mt-2 space-y-2">
                    {t.rating_comments.map((c, i) => (
                      <li key={i} className="p-2 rounded-lg bg-earth-100 dark:bg-[#15211b]">
                        <p className="flex items-center gap-2 text-earth-500">
                          <span className="text-amber-400">{'★'.repeat(c.stars)}<span className="text-earth-600">{'★'.repeat(5 - c.stars)}</span></span>
                          <span>{fmtDate(c.date)}</span>
                        </p>
                        <p className="mt-1 text-earth-700 dark:text-earth-200 whitespace-pre-wrap break-words">{c.comment}</p>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-earth-500">Comments are anonymous. If one breaks the rules, contact us from Help.</p>
                </details>
              )}

              {isExpanded && (
                <div className="mt-4 pt-4 border-t border-white/10">
                  {/* A posted task used to be unchangeable — these four are
                      the verbs an organizer has always needed. */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    {t.status !== 'cancelled' && (
                      <>
                        <button onClick={() => setCheckinTask(t)} className="btn-sm btn-primary" disabled={actionBusy}>
                          <QrCode className="w-3.5 h-3.5 mr-1" /> Check-in QR
                        </button>
                        <button onClick={() => signInSheet(t)} className="btn-sm btn-ghost" disabled={actionBusy || sheetBusyId === t.id}>
                          <Printer className="w-3.5 h-3.5 mr-1" /> {sheetBusyId === t.id ? 'Preparing…' : 'Sign-in sheet (PDF)'}
                        </button>
                        <button onClick={() => (editingId === t.id ? setEditingId(null) : startEdit(t))} className="btn-sm btn-ghost" disabled={actionBusy}>
                          <Pencil className="w-3.5 h-3.5 mr-1" /> {editingId === t.id ? 'Cancel edit' : 'Edit'}
                        </button>
                        <button onClick={() => setTaskStatus(t.id, t.status === 'open' ? 'closed' : 'open')} className="btn-sm btn-ghost" disabled={actionBusy}>
                          {t.status === 'open' ? <><Lock className="w-3.5 h-3.5 mr-1" /> Close signups</> : <><Unlock className="w-3.5 h-3.5 mr-1" /> Reopen signups</>}
                        </button>
                        <button onClick={() => { setMessagingId(messagingId === t.id ? null : t.id); setEditingId(null); setCancellingId(null) }} className="btn-sm btn-ghost" disabled={actionBusy}>
                          <Mail className="w-3.5 h-3.5 mr-1" /> Message volunteers
                        </button>
                        <button onClick={() => { setCancellingId(cancellingId === t.id ? null : t.id); setEditingId(null); setMessagingId(null) }} className="btn-sm btn-ghost text-red-400" disabled={actionBusy}>
                          <Ban className="w-3.5 h-3.5 mr-1" /> Cancel event
                        </button>
                      </>
                    )}
                    <button onClick={() => postAgain(t)} className="btn-sm btn-ghost" disabled={actionBusy}>
                      <Copy className="w-3.5 h-3.5 mr-1" /> Post again
                    </button>
                    {t.status !== 'cancelled' && t.date < localToday() && !t.thanks_sent_at && (
                      <button
                        onClick={() => {
                          if (thankingId === t.id) { setThankingId(null); return }
                          setThankingId(t.id); setThanksDraft(defaultThanks(t.title)); setEditingId(null); setMessagingId(null); setCancellingId(null)
                        }}
                        className="btn-sm btn-ghost text-rose-300"
                        disabled={actionBusy}
                      >
                        <Heart className="w-3.5 h-3.5 mr-1" /> {tr('Send thank-you')}
                      </button>
                    )}
                  </div>

                  {t.thanks_sent_at && (
                    <p className="mb-4 text-xs text-rose-300 flex items-center gap-1">
                      <Heart className="w-3.5 h-3.5" aria-hidden="true" /> {tr('Thank-you sent on {date}', { date: fmtDate(t.thanks_sent_at) })}
                    </p>
                  )}

                  {thankingId === t.id && !t.thanks_sent_at && (
                    <div className="mb-4 p-3 rounded-xl border border-rose-500/30">
                      <label htmlFor={`thanks-${t.id}`} className="label text-xs">{tr('Thank the volunteers who came')}</label>
                      <textarea id={`thanks-${t.id}`} className="input" rows={3} maxLength={THANKS_MAX} value={thanksDraft} onChange={(e) => setThanksDraft(e.target.value)} />
                      <p className="text-xs text-earth-500 mt-1">
                        {tr('Goes to everyone marked present or checked in, as a notification and an email. You can send one per task.')}
                        {' '}<span className="tabular-nums">{thanksDraft.length}/{THANKS_MAX}</span>
                      </p>
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => sendThanks(t.id)} className="btn-primary btn-sm" disabled={actionBusy || !thanksDraft.trim()}>
                          {actionBusy ? tr('Sending…') : tr('Send thank-you')}
                        </button>
                        <button onClick={() => setThankingId(null)} className="btn-sm btn-ghost" disabled={actionBusy}>{tr('Cancel')}</button>
                      </div>
                    </div>
                  )}

                  {editingId === t.id && editForm && (
                    <div className="mb-4 p-3 rounded-xl border border-white/10 space-y-2">
                      <input className="input" maxLength={200} value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} placeholder="Task title" />
                      <textarea className="input" rows={2} maxLength={5000} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} placeholder="Description" />
                      <OnlineToggle checked={editForm.isOnline} onChange={(isOnline) => setEditForm((f) => ({ ...f, isOnline, ...(isOnline || f.location !== 'Online' ? {} : { location: '' }) }))} />
                      {editForm.isOnline ? (
                        <input className="input" maxLength={300} aria-label={tr('Where to join (optional)')} placeholder={tr('Where to join (optional), e.g. Zoom link sent after approval')} value={editForm.location === 'Online' ? '' : editForm.location} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} />
                      ) : (
                        <LocationPicker
                          address={editForm.location}
                          lat={editForm.latitude}
                          lng={editForm.longitude}
                          placeholder="Location"
                          onChange={({ address, lat, lng }) => setEditForm((f) => ({ ...f, location: address, latitude: lat, longitude: lng }))}
                        />
                      )}
                      <select className="input" value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} aria-label="Category">
                        <option value="">No category</option>
                        {ACTIVITY_CATEGORIES.map((c) => <option key={c} value={c}>{tr(c)}</option>)}
                      </select>
                      <TaskDetailFields idPrefix={`edit-${t.id}`} value={editForm} onChange={(patch) => setEditForm((f) => ({ ...f, ...patch }))} />
                      <textarea className="input" rows={2} maxLength={2000} value={editForm.importantInfo} onChange={(e) => setEditForm({ ...editForm, importantInfo: e.target.value })} placeholder="Important info — approved volunteers only" />
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <input type="date" className="input" value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} aria-label="Date" />
                        <input type="time" className="input" value={editForm.time} onChange={(e) => setEditForm({ ...editForm, time: e.target.value })} aria-label="Time" />
                        <input type="number" min={1} className="input" value={editForm.slotsTotal} onChange={(e) => setEditForm({ ...editForm, slotsTotal: e.target.value })} aria-label="Volunteers needed" />
                        <input type="tel" className="input" maxLength={30} value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} aria-label="Phone" />
                      </div>
                      <button onClick={() => saveEdit(t.id)} className="btn-primary btn-sm" disabled={actionBusy}>
                        {actionBusy ? 'Saving…' : 'Save changes'}
                      </button>
                    </div>
                  )}

                  {messagingId === t.id && (
                    <div className="mb-4 p-3 rounded-xl border border-white/10">
                      <label htmlFor={`msg-${t.id}`} className="label text-xs">Message every approved volunteer</label>
                      <textarea id={`msg-${t.id}`} className="input" rows={3} maxLength={2000} value={messageDraft} onChange={(e) => setMessageDraft(e.target.value)} placeholder="Bring gloves and water. Park at the back of the lot." />
                      <p className="text-xs text-earth-500 mt-1">Sent one message per person — volunteers never see each other&apos;s addresses.</p>
                      <button onClick={() => messageVolunteers(t.id)} className="btn-primary btn-sm mt-2" disabled={actionBusy || !messageDraft.trim()}>
                        {actionBusy ? 'Sending…' : 'Send'}
                      </button>
                    </div>
                  )}

                  {cancellingId === t.id && (
                    <div className="mb-4 p-3 rounded-xl border border-red-500/30">
                      <label htmlFor={`cancel-${t.id}`} className="label text-xs">Cancel this event</label>
                      <input id={`cancel-${t.id}`} className="input" maxLength={500} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason (optional) — included in the email" />
                      <p className="text-xs text-earth-500 mt-1">Everyone signed up is emailed. Attendance already recorded is kept, and the event cannot be reopened.</p>
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => cancelTask(t.id)} className="btn-sm bg-red-600 hover:bg-red-500 text-white rounded-lg px-3 py-1.5" disabled={actionBusy}>
                          {actionBusy ? 'Cancelling…' : 'Yes, cancel it'}
                        </button>
                        <button onClick={() => { setCancellingId(null); setCancelReason('') }} className="btn-sm btn-ghost" disabled={actionBusy}>Keep it</button>
                      </div>
                    </div>
                  )}

                  {signups.length === 0 ? (
                    <p className="text-sm text-earth-500 text-center py-4">No one has signed up yet.</p>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs font-medium text-earth-400 uppercase tracking-wider">Volunteers signed up</p>
                      {signups.map((s) => {
                        const isApproved = s.status === 'approved'
                        const isAbsent = s.attendance_status === 'absent'
                        return (
                          <div key={s.id} className="flex items-center gap-3 rounded-xl bg-white/5 p-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{s.name}</p>
                              <p className="text-xs text-earth-400 truncate">{s.email}</p>
                              {s.came_with && <p className="text-xs text-brand-400 truncate">came with {s.came_with}</p>}
                              {s.status === 'approved' && <p className="text-xs text-emerald-400 mt-0.5">Approved</p>}
                              {s.status === 'rejected' && <p className="text-xs text-red-400 mt-0.5">Rejected</p>}
                              {s.status === 'pending' && <p className="text-xs text-amber-400 mt-0.5">Pending approval</p>}
                              {s.status === 'waitlisted' && (
                                <p className="text-xs text-sky-300 mt-0.5">
                                  Waitlist #{signups.filter((w) => w.status === 'waitlisted').indexOf(s) + 1} · moves up when a spot opens
                                </p>
                              )}
                              {isApproved && s.attendance_status && (
                                <p className={`text-xs mt-0.5 capitalize ${s.attendance_status === 'present' ? 'text-emerald-400' : s.attendance_status === 'absent' ? 'text-red-400' : 'text-amber-400'}`}>
                                  Attendance: {s.attendance_status}
                                </p>
                              )}
                              {isApproved && s.missed_checkout ? (
                                <p className="text-xs text-amber-300 mt-0.5">
                                  Checked in at {clock(s.checked_in_at)} but didn&apos;t check out ·{' '}
                                  <button onClick={() => openLogForm(t.id, s.id, t.date)} className="underline hover:text-white">log their hours</button>
                                </p>
                              ) : isApproved && s.checked_in_at && (
                                <p className="text-xs text-earth-400 mt-0.5">
                                  QR: in {clock(s.checked_in_at)}{s.checked_out_at ? ` · out ${clock(s.checked_out_at)}` : ' · still here'}
                                </p>
                              )}
                            </div>
                            {isApproved && (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <div className="flex items-center gap-0.5" title="Mark attendance">
                                  <button onClick={() => handleMarkAttendance(t.id, s.id, 'present')} className={`p-1 rounded-lg hover:bg-white/10 ${s.attendance_status === 'present' ? 'text-emerald-400' : 'text-earth-500'}`} title="Present">
                                    <CheckCircle className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => handleMarkAttendance(t.id, s.id, 'absent')} className={`p-1 rounded-lg hover:bg-white/10 ${s.attendance_status === 'absent' ? 'text-red-400' : 'text-earth-500'}`} title="Absent">
                                    <XCircle className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => handleMarkAttendance(t.id, s.id, 'excused')} className={`p-1 rounded-lg hover:bg-white/10 ${s.attendance_status === 'excused' ? 'text-amber-400' : 'text-earth-500'}`} title="Excused">
                                    <MinusCircle className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                <input
                                  type="number"
                                  step="0.5"
                                  min="0.5"
                                  className="input w-16 text-center text-xs py-1 disabled:opacity-40 disabled:cursor-not-allowed"
                                  placeholder={isAbsent ? 'absent' : 'hrs'}
                                  value={batchHours[s.id] || ''}
                                  onChange={(e) => setBatchHours((h) => ({ ...h, [s.id]: e.target.value }))}
                                  disabled={isAbsent}
                                  title={isAbsent ? 'Cannot log hours for a volunteer marked absent' : undefined}
                                />
                                <button
                                  onClick={() => openLogForm(t.id, s.id, t.date)}
                                  className="text-xs text-earth-400 hover:text-white px-1.5 py-1 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                                  title={isAbsent ? 'Cannot log hours for a volunteer marked absent' : 'Log specific hours'}
                                  disabled={isAbsent}
                                >
                                  <Clock className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                            {!isApproved && (
                              <div className="flex gap-1.5 shrink-0">
                                {s.status === 'pending' && (
                                  <>
                                    <button onClick={() => handleApprove(t.id, s.id)} className="btn-sm text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-2 py-1">
                                      <CheckCircle className="w-3 h-3 mr-1" /> Approve
                                    </button>
                                    <button onClick={() => handleReject(t.id, s.id)} className="btn-sm text-xs bg-red-600 hover:bg-red-500 text-white rounded-lg px-2 py-1">
                                      <XCircle className="w-3 h-3 mr-1" /> Reject
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                      {signups.some((s) => s.status === 'approved') && (
                        <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                          <input
                            type="date"
                            className="input text-xs flex-1"
                            value={batchDate}
                            onChange={(e) => setBatchDate(e.target.value)}
                            placeholder="Date"
                          />
                          <button
                            onClick={() => handleBatchLog(t.id, t.date)}
                            disabled={batchBusy}
                            className="btn-primary text-xs shrink-0"
                          >
                            <Send className="w-3 h-3 mr-1" />
                            {batchBusy ? 'Saving…' : 'Log all hours'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Card>
          )
        })}

        <div className={view === 'tasks' ? 'pt-2' : 'hidden'}>
          <p className="text-xs font-medium text-earth-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <GraduationCap className="w-3.5 h-3.5" /> My Students
          </p>
          {studentsLoading ? (
            <Card><p className="text-center text-earth-500 py-8">Loading…</p></Card>
          ) : students.length === 0 ? (
            <Card><p className="text-center text-earth-500 py-8">No approved students yet — approve a signup above to see them here.</p></Card>
          ) : (
            <div className="space-y-3">
              {pendingLogs.length > 0 && (
                <Card padded={false} className="p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-xs mr-auto cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-emerald-600"
                        checked={allPendingSelected}
                        onChange={toggleAllPending}
                        disabled={bulkBusy}
                      />
                      {tr('Select all pending ({n})', { n: pendingLogs.length })}
                    </label>
                    <button
                      disabled={selectedPending.length === 0 || bulkBusy}
                      onClick={() => { setSigning(null); setBulk({ status: 'approved', signature: '' }) }}
                      className="btn-sm text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg px-2 py-1"
                    >
                      <CheckCircle className="w-3 h-3 mr-1" /> {tr('Approve selected ({n})', { n: selectedPending.length })}
                    </button>
                    <button
                      disabled={selectedPending.length === 0 || bulkBusy}
                      onClick={() => { setSigning(null); setBulk({ status: 'rejected' }) }}
                      className="btn-sm text-xs bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg px-2 py-1"
                    >
                      <XCircle className="w-3 h-3 mr-1" /> {tr('Reject selected ({n})', { n: selectedPending.length })}
                    </button>
                  </div>
                  {bulk && selectedPending.length > 0 && (
                    <div className="mt-3 border-t border-white/10 pt-3">
                      {bulk.status === 'approved' ? (
                        <>
                          <p className="text-xs text-earth-400 mb-2">
                            {tr('Sign once to approve {n} entries. Your signature confirms each student did this work.', { n: selectedPending.length })}
                          </p>
                          <SignaturePad
                            value={bulk.signature}
                            onChange={(sig) => setBulk((cur) => (cur?.status === 'approved' ? { ...cur, signature: sig } : cur))}
                          />
                        </>
                      ) : (
                        <p className="text-xs text-earth-400">
                          {tr('Reject {n} entries? Each student will be told in their notifications.', { n: selectedPending.length })}
                        </p>
                      )}
                      <div className="flex gap-2 mt-2">
                        <button
                          disabled={bulkBusy || (bulk.status === 'approved' && !bulk.signature)}
                          onClick={handleBulkVerify}
                          className={`btn-sm text-xs ${bulk.status === 'approved' ? 'btn-primary' : 'btn-danger'}`}
                        >
                          {bulkBusy ? tr('Saving…') : bulk.status === 'approved' ? tr('Confirm approval') : tr('Confirm rejection')}
                        </button>
                        <button onClick={() => setBulk(null)} disabled={bulkBusy} className="btn-sm btn-ghost text-xs">{tr('Cancel')}</button>
                      </div>
                    </div>
                  )}
                </Card>
              )}
              {students.map((student) => (
                <Card key={student.id} padded={false} className="p-4">
                  <p className="text-sm font-medium">{student.name}</p>
                  <p className="text-xs text-earth-400">{student.email}</p>
                  {student.logs.length === 0 ? (
                    <p className="text-xs text-earth-500 mt-2">No logged hours yet.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {student.logs.map((log) => (
                        <div key={log.id} className="rounded-xl bg-white/5 p-2.5">
                        <div className="flex items-center gap-3">
                          {log.verification_status !== 'approved' && log.verification_status !== 'rejected' && (
                            <input
                              type="checkbox"
                              className="w-4 h-4 accent-emerald-600 shrink-0"
                              aria-label={tr('Select {activity} for {name}', { activity: log.activity || '', name: student.name || '' })}
                              checked={!!selectedLogs[log.id]}
                              onChange={() => toggleLog(student.id, log.id)}
                              disabled={bulkBusy}
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{log.activity} · {log.hours}h</p>
                            <p className="text-xs text-earth-500">{fmtDate(log.date)}</p>
                          </div>
                          {log.verification_status === 'approved' ? (
                            <span className="text-xs text-emerald-400 shrink-0">Signed &amp; approved</span>
                          ) : log.verification_status === 'rejected' ? (
                            <span className="text-xs text-red-400 shrink-0">Rejected</span>
                          ) : signing?.logId === log.id ? null : (
                            <div className="flex gap-1.5 shrink-0">
                              <button onClick={() => setSigning({ logId: log.id, signature: '' })} className="btn-sm text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-2 py-1">
                                <CheckCircle className="w-3 h-3 mr-1" /> Sign &amp; approve
                              </button>
                              <button onClick={() => handleVerifyLog(student.id, log.id, 'rejected')} className="btn-sm text-xs bg-red-600 hover:bg-red-500 text-white rounded-lg px-2 py-1">
                                <XCircle className="w-3 h-3 mr-1" /> Reject
                              </button>
                            </div>
                          )}
                        </div>
                        {signing?.logId === log.id && (
                          <div className="mt-3">
                            <p className="text-xs text-earth-400 mb-2">Sign to confirm {student.name} did this work.</p>
                            <SignaturePad
                              value={signing.signature}
                              onChange={(sig) => setSigning((cur) => (cur?.logId === log.id ? { ...cur, signature: sig } : cur))}
                            />
                            <div className="flex gap-2 mt-2">
                              <button
                                disabled={!signing.signature}
                                onClick={() => handleVerifyLog(student.id, log.id, 'approved', signing.signature)}
                                className="btn-sm btn-primary text-xs"
                              >
                                Confirm approval
                              </button>
                              <button onClick={() => setSigning(null)} className="btn-sm btn-ghost text-xs">Cancel</button>
                            </div>
                          </div>
                        )}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {showLogForm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowLogForm(false)}>
          <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-4">Log hours for volunteer</h3>
            <form onSubmit={handleLogHours} className="space-y-3">
              <div>
                <label className="label">Hours</label>
                <input type="number" step="0.5" min="0.5" className="input" placeholder="e.g. 2" value={logForm.hours} onChange={(e) => setLogForm({...logForm, hours: e.target.value})} required />
              </div>
              <div>
                <label className="label">Date</label>
                <input type="date" className="input" value={logForm.date} onChange={(e) => setLogForm({...logForm, date: e.target.value})} />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowLogForm(false)} className="btn-ghost flex-1">Cancel</button>
                <button type="submit" className="btn-primary flex-1" disabled={busy}>{busy ? 'Saving…' : 'Log hours'}</button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {checkinTask && <CheckinQrModal task={checkinTask} onClose={() => { setCheckinTask(null); loadTasks() }} />}
      <Toast open={toast} onClose={() => setToast(false)}>{toastMsg}</Toast>
    </AppLayout>
  )
}

function ReportStat({ label, value }) {
  return (
    <div className="rounded-xl bg-white/5 px-3 py-2">
      <div className="text-[0.6875rem] text-earth-400">{label}</div>
      <div className="font-semibold mt-0.5">{value}</div>
    </div>
  )
}
