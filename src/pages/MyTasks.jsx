import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp, MapPin, Calendar as CalIcon, Users, Clock, Phone, CheckCircle, XCircle, MinusCircle, Plus, Send, GraduationCap } from 'lucide-react'
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
              <input className="input" placeholder="Task title" value={taskForm.title} onChange={(e) => setTaskForm({...taskForm, title: e.target.value})} required />
              <textarea className="input" rows={2} placeholder="Description — what volunteers will do" value={taskForm.description} onChange={(e) => setTaskForm({...taskForm, description: e.target.value})} required />
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
              <textarea className="input" rows={2} placeholder="Important info — only shown to approved volunteers (e.g. what to bring, parking, contact details)" value={taskForm.importantInfo} onChange={(e) => setTaskForm({...taskForm, importantInfo: e.target.value})} />
              <input className="input" type="tel" placeholder="Phone number — shown to approved volunteers" value={taskForm.phone} onChange={(e) => setTaskForm({...taskForm, phone: e.target.value})} required />
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
                  <span className={`text-xs px-2 py-0.5 rounded-full ${t.status === 'open' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-earth-800 text-earth-400'}`}>
                    {t.status}
                  </span>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-earth-400" /> : <ChevronDown className="w-4 h-4 text-earth-400" />}
                </div>
              </div>

              {isExpanded && (
                <div className="mt-4 pt-4 border-t border-white/10">
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
