import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp, MapPin, Calendar as CalIcon, Users, Clock, Phone, CheckCircle, XCircle, MinusCircle, Plus, Send, GraduationCap, Pencil, Lock, Unlock, Mail, Ban, BarChart3, Download, FileSpreadsheet } from 'lucide-react'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import LocationPicker from '@/components/LocationPicker.jsx'
import { useData } from '@/hooks/useData.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

export default function MyTasks() {
  const { refreshLogs } = useData()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [logForm, setLogForm] = useState({ volunteerId: '', taskId: '', hours: '', date: '' })
  const [showLogForm, setShowLogForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const [showPostTask, setShowPostTask] = useState(false)
  const [taskForm, setTaskForm] = useState({ title: '', description: '', location: '', date: '', time: '', slotsTotal: 1, phone: '', importantInfo: '', latitude: null, longitude: null })
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
  const [cancelReason, setCancelReason] = useState('')
  const [messagingId, setMessagingId] = useState(null)
  const [messageDraft, setMessageDraft] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [report, setReport] = useState(null)
  const [reportRange, setReportRange] = useState({ from: '', to: '' })
  const [reportBusy, setReportBusy] = useState(false)
  const [showReport, setShowReport] = useState(false)

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
        (t.title || '').replaceAll(',', ' '),
        (t.location || '').replaceAll(',', ' '),
        t.status, t.approved, t.present, t.absent, t.excused, t.hours,
      ]),
    ]
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' })
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

  const handleVerifyLog = async (studentId, logId, status) => {
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/students/${studentId}/logs/${logId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
      setToastMsg(status === 'approved' ? 'Hours approved' : 'Hours rejected'); setToast(true)
      loadStudents()
    } catch (e) { setToastMsg(e.message); setToast(true) }
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
      setToastMsg(`Logged hours for ${d.logged} volunteer${d.logged === 1 ? '' : 's'}`); setToast(true)
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
        body: JSON.stringify(taskForm),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
      setTaskForm({ title: '', description: '', location: '', date: '', time: '', slotsTotal: 1, phone: '', importantInfo: '', latitude: null, longitude: null })
      setShowPostTask(false); loadTasks()
      setToastMsg('Task posted!'); setToast(true)
    } catch (e) { setToastMsg(e.message); setToast(true) } finally { setTaskBusy(false) }
  }

  const togglePostForm = () => setShowPostTask((s) => !s)

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
        {showPostTask && (
          <Card>
            <h3 className="font-semibold mb-3">Post a volunteer opportunity</h3>
            <form onSubmit={handlePostTask} className="space-y-3">
              <input className="input" maxLength={200} placeholder="Task title" value={taskForm.title} onChange={(e) => setTaskForm({...taskForm, title: e.target.value})} required />
              <textarea className="input" rows={2} maxLength={5000} placeholder="Description — what volunteers will do" value={taskForm.description} onChange={(e) => setTaskForm({...taskForm, description: e.target.value})} required />
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
              <textarea className="input" rows={2} maxLength={2000} placeholder="Important info — only shown to approved volunteers (e.g. what to bring, parking, contact details)" value={taskForm.importantInfo} onChange={(e) => setTaskForm({...taskForm, importantInfo: e.target.value})} />
              <input className="input" type="tel" maxLength={30} placeholder="Phone number — shown to approved volunteers" value={taskForm.phone} onChange={(e) => setTaskForm({...taskForm, phone: e.target.value})} required />
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
              {!(taskForm.latitude && taskForm.longitude) && (
                <p className="text-xs text-earth-500">Pick a pin on the map above so this task can be sorted by distance.</p>
              )}
              <button type="submit" className="btn-primary w-full" disabled={taskBusy}>{taskBusy ? 'Posting…' : 'Post task — no paperwork needed'}</button>
            </form>
          </Card>
        )}

        {/* What an organizer needs at grant time. Every figure was already in
            the tasks and their signups; nothing could read it back out. */}
        <Card>
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
                  <label htmlFor="report-from" className="block text-[11px] text-earth-400 mb-1">From</label>
                  <input id="report-from" type="date" className="input w-[145px]" value={reportRange.from} onChange={(e) => setReportRange((r) => ({ ...r, from: e.target.value }))} />
                </div>
                <div>
                  <label htmlFor="report-to" className="block text-[11px] text-earth-400 mb-1">To</label>
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
        </Card>

        {loading ? (
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
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {t.location}</span>
                    <span className="flex items-center gap-1"><CalIcon className="w-3 h-3" /> {new Date(t.date).toLocaleDateString()}{t.time ? ` · ${t.time}` : ''}</span>
                    <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {filled}/{total} signed up</span>
                  </div>
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

              {isExpanded && (
                <div className="mt-4 pt-4 border-t border-white/10">
                  {/* A posted task used to be unchangeable — these four are
                      the verbs an organizer has always needed. */}
                  {t.status !== 'cancelled' && (
                    <div className="flex flex-wrap gap-2 mb-4">
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
                    </div>
                  )}

                  {editingId === t.id && editForm && (
                    <div className="mb-4 p-3 rounded-xl border border-white/10 space-y-2">
                      <input className="input" maxLength={200} value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} placeholder="Task title" />
                      <textarea className="input" rows={2} maxLength={5000} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} placeholder="Description" />
                      <LocationPicker
                        address={editForm.location}
                        lat={editForm.latitude}
                        lng={editForm.longitude}
                        placeholder="Location"
                        onChange={({ address, lat, lng }) => setEditForm((f) => ({ ...f, location: address, latitude: lat, longitude: lng }))}
                      />
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
                              {s.status === 'approved' && <p className="text-xs text-emerald-400 mt-0.5">Approved</p>}
                              {s.status === 'rejected' && <p className="text-xs text-red-400 mt-0.5">Rejected</p>}
                              {s.status === 'pending' && <p className="text-xs text-amber-400 mt-0.5">Pending approval</p>}
                              {isApproved && s.attendance_status && (
                                <p className={`text-xs mt-0.5 capitalize ${s.attendance_status === 'present' ? 'text-emerald-400' : s.attendance_status === 'absent' ? 'text-red-400' : 'text-amber-400'}`}>
                                  Attendance: {s.attendance_status}
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

        <div className="pt-2">
          <p className="text-xs font-medium text-earth-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <GraduationCap className="w-3.5 h-3.5" /> My Students
          </p>
          {studentsLoading ? (
            <Card><p className="text-center text-earth-500 py-8">Loading…</p></Card>
          ) : students.length === 0 ? (
            <Card><p className="text-center text-earth-500 py-8">No approved students yet — approve a signup above to see them here.</p></Card>
          ) : (
            <div className="space-y-3">
              {students.map((student) => (
                <Card key={student.id} padded={false} className="p-4">
                  <p className="text-sm font-medium">{student.name}</p>
                  <p className="text-xs text-earth-400">{student.email}</p>
                  {student.logs.length === 0 ? (
                    <p className="text-xs text-earth-500 mt-2">No logged hours yet.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {student.logs.map((log) => (
                        <div key={log.id} className="flex items-center gap-3 rounded-xl bg-white/5 p-2.5">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{log.activity} · {log.hours}h</p>
                            <p className="text-xs text-earth-500">{new Date(log.date).toLocaleDateString()}</p>
                          </div>
                          {log.verification_status === 'approved' ? (
                            <span className="text-xs text-emerald-400 shrink-0">Approved</span>
                          ) : log.verification_status === 'rejected' ? (
                            <span className="text-xs text-red-400 shrink-0">Rejected</span>
                          ) : (
                            <div className="flex gap-1.5 shrink-0">
                              <button onClick={() => handleVerifyLog(student.id, log.id, 'approved')} className="btn-sm text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-2 py-1">
                                <CheckCircle className="w-3 h-3 mr-1" /> Approve
                              </button>
                              <button onClick={() => handleVerifyLog(student.id, log.id, 'rejected')} className="btn-sm text-xs bg-red-600 hover:bg-red-500 text-white rounded-lg px-2 py-1">
                                <XCircle className="w-3 h-3 mr-1" /> Reject
                              </button>
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

      <Toast open={toast} onClose={() => setToast(false)}>{toastMsg}</Toast>
    </AppLayout>
  )
}

function ReportStat({ label, value }) {
  return (
    <div className="rounded-xl bg-white/5 px-3 py-2">
      <div className="text-[11px] text-earth-400">{label}</div>
      <div className="font-semibold mt-0.5">{value}</div>
    </div>
  )
}
