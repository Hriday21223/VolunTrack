import { useMemo, useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Trash2, Mail, MessageSquare, ShieldCheck, XCircle, Sparkles, School, Users, CreditCard, Download, Calendar, Bell, Star, Heart, AlertTriangle, Bot, Loader2, Wrench, CheckCircle2 } from 'lucide-react'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import { useAuth } from '@/hooks/useAuth.jsx'
import { getReviews } from '@/api/index.js'
import { runAgent, updateIncidentStatus, getAgentLog, logAgentAction } from '@/lib/agent.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function generateDraft(contact) {
  const subject = contact.subject || 'General question'
  const name = contact.name || 'there'

  const intros = [
    `Hi ${name},`,
    `Hello ${name},`,
    `Thanks for reaching out, ${name}.`,
  ]
  const intro = intros[contact.sentAt ? contact.sentAt.length % intros.length : 0]

  const closings = [
    '\n\nBest,\nThe VolunteerTrack Team',
    '\n\nCheers,\nThe VolunteerTrack Team',
    '\n\nThanks,\nThe VolunteerTrack Team',
  ]
  const closing = closings[contact.sentAt ? contact.sentAt.length % closings.length : 0]

  const bodies = {
    'General question': (
      `Thanks for your interest in VolunteerTrack!\n\nVolunteerTrack is a free, open-source PWA that lets students log service hours, set goals, earn badges, and export PDF reports — all without an account server. Everything stays on your device (privacy-first).\n\nIt runs on React 18 with Vite and works offline after the first visit. Source and live link: https://github.com/Hriday21223/VolunteerTrack\n\nIf you have specific questions, feel free to reply to this email or open an issue on GitHub: https://github.com/Hriday21223/VolunteerTrack/issues`
    ),
    'Bug report': (
      `Thanks for reporting this! We appreciate your help making VolunteerTrack better.\n\nCould you share a few more details so we can look into it?\n- What browser and device are you using?\n- What steps did you take before the issue appeared?\n- Any error messages or screenshots?\n\nYou can also file an issue directly on GitHub: https://github.com/Hriday21223/VolunteerTrack/issues\n\nWe typically respond within a couple of days.`
    ),
    'Feature request': (
      `Thanks for the suggestion! We're always looking for ways to improve VolunteerTrack.\n\nHere's what's currently on our roadmap:\n- Phase 1 (shipped): Core logging, badges, reminders, reports\n- Phase 2 (shipped): Printable certificates, email-based PIN/password reset\n- Phase 3 (in progress): School & organization plans, verified supervisor flow, bulk CSV import\n\nYour idea sounds like it could fit well. Want to open a feature request on GitHub so we can track it? https://github.com/Hriday21223/VolunteerTrack/issues`
    ),
    'School or organization partnership': (
      `Thanks for your interest in partnering with VolunteerTrack!\n\nWe're actively building Phase 3, which includes:\n- School & organization plans\n- Verified supervisor flow\n- Bulk CSV import\n\nThis will make it easy for schools to adopt VolunteerTrack across their entire student body. We'd love to hear more about your needs.\n\nIn the meantime, the current version is free and open-source — you can find it at https://github.com/Hriday21223/VolunteerTrack\n\nLet's continue the conversation on GitHub: https://github.com/Hriday21223/VolunteerTrack/issues`
    ),
  }

  const body = bodies[subject] || (
    `Thanks for your message! VolunteerTrack is a privacy-first volunteer hour tracker built for students and clubs. It's free, open-source, and works entirely in the browser.\n\nSource: https://github.com/Hriday21223/VolunteerTrack\n\nLet us know if you have any other questions!`
  )

  return intro + '\n\n' + body + closing
}

export default function Admin() {
  const nav = useNavigate()
  const { user } = useAuth()
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [drafts, setDrafts] = useState({})
  const [tab, setTab] = useState('inbox')
  const [schools, setSchools] = useState([])
  const [loadingSchools, setLoadingSchools] = useState(false)
  const [payModal, setPayModal] = useState(null) // school id
  const [payNotes, setPayNotes] = useState('')
  const [toast, setToast] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [notifyMsg, setNotifyMsg] = useState('')
  const [showDueModal, setShowDueModal] = useState(false)
  const [showNotifyModal, setShowNotifyModal] = useState(false)
  const [notifySchoolId, setNotifySchoolId] = useState(null) // null = all schools, string = specific school
  const [incidents, setIncidents] = useState([])
  const [agentLog, setAgentLog] = useState([])
  const [fixing, setFixing] = useState(null)
  useEffect(() => {
    try { setIncidents(JSON.parse(localStorage.getItem('voluntrack:incidents') || '[]')) } catch { setIncidents([]) }
    try { setAgentLog(JSON.parse(localStorage.getItem('voluntrack:agent_log') || '[]')) } catch { setAgentLog([]) }
    const handler = () => {
      try { setIncidents(JSON.parse(localStorage.getItem('voluntrack:incidents') || '[]')) } catch { setIncidents([]) }
      try { setAgentLog(JSON.parse(localStorage.getItem('voluntrack:agent_log') || '[]')) } catch { setAgentLog([]) }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  useEffect(() => {
    setIsAuthorized(user?.role === 'admin')
  }, [user?.role])

  const loadSchools = useCallback(async () => {
    setLoadingSchools(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      if (!token) return
      const res = await fetch(`${apiUrl}/school/admin/list`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 403) { setLoadingSchools(false); return }
      if (!res.ok) return
      const data = await res.json()
      setSchools(data.schools || [])
    } catch {} finally {
      setLoadingSchools(false)
    }
  }, [])

  const markPaid = async (id) => {
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/admin/${id}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'paid', notes: payNotes }),
      })
      if (!res.ok) throw new Error('Failed')
      setPayModal(null); setPayNotes(''); loadSchools()
      setToastMessage('School marked as paid'); setToast(true)
    } catch { setToastMessage('Failed to update payment'); setToast(true) }
  }

  const rejectPayment = async (id) => {
    const reason = prompt('Why is this payment confirmation being rejected? The school will be emailed this reason.')
    if (!reason || !reason.trim()) return
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/admin/${id}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'rejected', notes: reason.trim() }),
      })
      if (!res.ok) throw new Error('Failed')
      loadSchools()
      setToastMessage('Payment rejected — school notified'); setToast(true)
    } catch { setToastMessage('Failed to reject payment'); setToast(true) }
  }

  const markUnpaid = async (id) => {
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/admin/${id}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'unpaid' }),
      })
      if (!res.ok) throw new Error('Failed')
      loadSchools()
      setToastMessage('School marked as unpaid'); setToast(true)
    } catch { setToastMessage('Failed to update payment'); setToast(true) }
  }

  const deleteSchool = async (id, name) => {
    if (!confirm(`Delete "${name}" and unlink all its students?`)) return
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/admin/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed')
      loadSchools()
    } catch {}
  }

  const exportCsv = () => {
    const header = 'Name,Code,Contact Email,Payment Status,Payment Notes,Students,Joined\n'
    const rows = schools.map((s) =>
      `"${s.name}","${s.pin}","${s.contact_email || ''}","${s.payment_status}","${s.payment_notes || ''}",${s.student_count},"${new Date(s.created_at).toLocaleDateString()}"`
    ).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'schools.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const setGlobalDueDate = async () => {
    if (!dueDate) return
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/admin/payment-due-date`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dueDate }),
      })
      if (!res.ok) throw new Error('Failed')
      setShowDueModal(false)
      loadSchools()
      setToastMessage('Payment due date updated for all schools')
      setToast(true)
    } catch { setToastMessage('Failed to set due date'); setToast(true) }
  }

  const sendNotify = async () => {
    if (!notifyMsg.trim()) return
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const url = notifySchoolId
        ? `${apiUrl}/school/admin/notify-school/${notifySchoolId}`
        : `${apiUrl}/school/admin/notify-payment`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: notifyMsg.trim() }),
      })
      if (!res.ok) throw new Error('Failed')
      setShowNotifyModal(false); setNotifyMsg(''); setNotifySchoolId(null)
      setToastMessage('Notification sent')
      setToast(true)
    } catch { setToastMessage('Failed to send notification'); setToast(true) }
  }

  const contacts = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('voluntrack:contacts') || '[]').sort((a, b) => b.sentAt - a.sentAt)
    } catch { return [] }
  }, [])

  const reviews = useMemo(() => {
    return getReviews().sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
  }, [])

  useEffect(() => {
    loadSchools()
  }, [loadSchools])

  // Show access denied if user is not authorized
  if (!isAuthorized) {
    return (
      <AppLayout title="Admin" subtitle="Access denied">
        <Card>
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 grid place-items-center text-red-600 mx-auto mb-4">
              <XCircle className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-semibold text-earth-900 dark:text-earth-100 mb-2">Access Denied</h2>
            <p className="text-earth-600 dark:text-earth-400 mb-6">
              You don't have permission to access this area.
            </p>
            <button onClick={() => nav(-1)} className="btn-primary">
              Go Back
            </button>
          </div>
        </Card>
      </AppLayout>
    )
  }


  const toggleDraft = (idx) => {
    setDrafts((prev) => {
      const next = { ...prev }
      if (next[idx]) {
        delete next[idx]
      } else {
        next[idx] = generateDraft(contacts[idx])
      }
      return next
    })
  }

  const remove = (idx) => {
    const next = contacts.filter((_, i) => i !== idx)
    localStorage.setItem('voluntrack:contacts', JSON.stringify(next))
    window.location.reload()
  }

  const clearAll = () => {
    if (!confirm('Delete all messages?')) return
    localStorage.setItem('voluntrack:contacts', JSON.stringify([]))
    window.location.reload()
  }

  return (
    <AppLayout
      title={tab === 'inbox' ? 'Contact inbox' : tab === 'reviews' ? 'Reviews' : tab === 'incidents' ? 'Incidents' : 'Manage schools'}
      subtitle={tab === 'inbox' ? `${contacts.length} message${contacts.length === 1 ? '' : 's'} received` : tab === 'reviews' ? `${reviews.length} review${reviews.length === 1 ? '' : 's'} submitted` : tab === 'incidents' ? `${incidents.length} incident${incidents.length === 1 ? '' : 's'} logged` : `${schools.length} school${schools.length === 1 ? '' : 's'} registered`}
      action={
        <div className="flex gap-2">
          <button onClick={() => setTab('inbox')} className={`btn-sm ${tab === 'inbox' ? 'btn-primary' : 'btn-ghost'}`}>
            <MessageSquare className="w-3.5 h-3.5 mr-1" /> Inbox
          </button>
          <button onClick={() => setTab('reviews')} className={`btn-sm ${tab === 'reviews' ? 'btn-primary' : 'btn-ghost'}`}>
            <Star className="w-3.5 h-3.5 mr-1" /> Reviews
          </button>
          <button onClick={() => { setTab('schools'); loadSchools() }} className={`btn-sm ${tab === 'schools' ? 'btn-primary' : 'btn-ghost'}`}>
            <School className="w-3.5 h-3.5 mr-1" /> Schools
          </button>
          <button onClick={() => setTab('incidents')} className={`btn-sm ${tab === 'incidents' ? 'btn-primary' : 'btn-ghost'} relative`}>
            <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Incidents
            {incidents.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center font-bold">{incidents.length > 9 ? '9+' : incidents.length}</span>
            )}
          </button>
        </div>
      }
    >
      {tab === 'reviews' ? (
        reviews.length === 0 ? (
          <Card>
            <div className="text-center py-12 text-earth-500">
              <Star className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-earth-900 dark:text-earth-100">No reviews yet</p>
              <p className="text-sm mt-1">Reviews submitted by users will appear here.</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-4">
            {reviews.map((r) => (
              <Card key={r.id} padded={false} className="p-5">
                <div className="flex items-start gap-4">
                  <div className="flex gap-1 shrink-0">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star key={n} className={`w-5 h-5 ${n <= r.rating ? 'fill-brand-400 text-brand-400' : 'text-earth-600'}`} />
                    ))}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-earth-500">{new Date(r.submittedAt).toLocaleString()}</span>
                    </div>
                    {r.comment && (
                      <p className="mt-2 text-sm text-earth-300 whitespace-pre-wrap">{r.comment}</p>
                    )}
                    {!r.comment && (
                      <p className="mt-2 text-xs text-earth-500 italic">No comment left</p>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : tab === 'schools' ? (
        loadingSchools ? (
          <Card><p className="text-center text-earth-400 py-8">Loading schools…</p></Card>
        ) : schools.length === 0 ? (
          <Card>
            <div className="text-center py-12 text-earth-500">
              <School className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-earth-900 dark:text-earth-100">No schools registered</p>
              <p className="text-sm mt-1">Schools will appear here when they register.</p>
              <Link to="/school/register" className="btn-primary inline-flex mt-4">Register a school</Link>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 mb-4">
              {(() => {
                const dueRows = schools.filter((s) => s.payment_due_date)
                if (dueRows.length > 0) {
                  const daysLeft = Math.ceil((new Date(dueRows[0].payment_due_date) - new Date()) / (1000 * 60 * 60 * 24))
                  if (daysLeft <= 10 && daysLeft >= 0) {
                    return (
                      <div className="w-full p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-sm mb-2">
                        <Calendar className="w-4 h-4 inline mr-1" />
                        Payment due in <strong>{daysLeft} day{daysLeft === 1 ? '' : 's'}</strong>
                      </div>
                    )
                  }
                }
                return null
              })()}
              <button onClick={exportCsv} className="btn-sm btn-ghost">
                <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
              </button>
              <button onClick={() => setShowDueModal(true)} className="btn-sm btn-ghost">
                <Calendar className="w-3.5 h-3.5 mr-1" /> Set due date
              </button>
              <button onClick={() => { setNotifySchoolId(null); setShowNotifyModal(true) }} className="btn-sm btn-ghost">
                <Bell className="w-3.5 h-3.5 mr-1" /> Notify all schools
              </button>
              <Link to="/school/register" className="btn-sm btn-primary ml-auto">
                <School className="w-3.5 h-3.5 mr-1" /> Add school
              </Link>
            </div>
            {schools.map((s) => (
              <Card key={s.id} padded={false} className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <School className="w-8 h-8 text-brand-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{s.name}</p>
                      <p className="text-xs text-earth-400">
                        Code: <span className="font-mono">{s.pin}</span>
                        {s.contact_email && ` · ${s.contact_email}`}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-1">
                        <span className="text-xs text-earth-500">
                          <Users className="w-3 h-3 inline mr-1" />
                          {s.student_count} student{s.student_count === 1 ? '' : 's'} ·
                          Joined {new Date(s.created_at).toLocaleDateString()}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          s.payment_status === 'paid'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : s.payment_status === 'pending'
                            ? 'bg-blue-500/10 text-blue-400'
                            : s.payment_status === 'rejected'
                            ? 'bg-red-500/10 text-red-400'
                            : 'bg-amber-500/10 text-amber-400'
                        }`}>
                          {s.payment_status === 'paid' ? 'Paid' : s.payment_status === 'pending' ? 'Pending review' : s.payment_status === 'rejected' ? 'Rejected' : 'Unpaid'}
                        </span>
                      </div>
                      {s.payment_confirmation_ref && s.payment_status === 'pending' && (
                        <p className="text-xs text-earth-500 mt-0.5">Ref: <span className="font-mono">{s.payment_confirmation_ref}</span></p>
                      )}
                      {s.payment_notes && (
                        <p className="text-xs text-earth-500 mt-0.5">{s.payment_notes}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {s.payment_status === 'paid' ? (
                      <button onClick={() => markUnpaid(s.id)} className="text-amber-400 hover:text-amber-300 p-2" title="Mark as unpaid">
                        <CreditCard className="w-4 h-4" />
                      </button>
                    ) : (
                      <button onClick={() => { setPayModal(s.id); setPayNotes('') }} className="text-emerald-400 hover:text-emerald-300 p-2" title="Mark as paid">
                        <CreditCard className="w-4 h-4" />
                      </button>
                    )}
                    {s.payment_status === 'pending' && (
                      <button onClick={() => rejectPayment(s.id)} className="text-red-400 hover:text-red-300 p-2" title="Reject payment confirmation">
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => { setNotifySchoolId(s.id); setShowNotifyModal(true) }} className="text-brand-400 hover:text-brand-300 p-2" title="Notify this school">
                      <Bell className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteSchool(s.id, s.name)} className="text-red-400 hover:text-red-300 p-2" title="Delete school">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : tab === 'incidents' ? (
        <>
          {incidents.filter((i) => i.status !== 'resolved').length === 0 ? (
            <Card>
              <div className="text-center py-12 text-earth-500">
                <AlertTriangle className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <p className="font-medium text-earth-900 dark:text-earth-100">No active incidents</p>
                <p className="text-sm mt-1">All services are running normally.</p>
              </div>
            </Card>
          ) : (
            <div className="space-y-3 mb-6">
                {incidents.filter((i) => i.status !== 'resolved').map((inc) => {
                  const statusColors = {
                    detected: 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800',
                    investigating: 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800',
                    fixing: 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800',
                    resolved: 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800',
                    failed: 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800',
                  }
                  const statusIcons = {
                    detected: <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />,
                    investigating: <Loader2 className="w-4 h-4 text-amber-500 mt-0.5 shrink-0 animate-spin" />,
                    fixing: <Wrench className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />,
                    resolved: <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />,
                    failed: <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />,
                  }
                  const isRunning = fixing === inc.id
                  return (
                    <Card key={inc.id} padded={false} className={`p-4 border ${statusColors[inc.status] || statusColors.detected}`}>
                      <div className="flex items-start gap-3">
                        {statusIcons[inc.status] || statusIcons.detected}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm text-earth-800 dark:text-earth-200">{inc.service}</p>
                            <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${
                              inc.status === 'resolved' ? 'text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/30' :
                              inc.status === 'failed' ? 'text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30' :
                              inc.status === 'investigating' || inc.status === 'fixing' ? 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30' :
                              'text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30'
                            }`}>{inc.status}</span>
                          </div>
                          <p className="text-xs text-earth-500 dark:text-earth-400 mt-0.5">{inc.detail}</p>
                          <p className="text-xs text-earth-400 dark:text-earth-500 mt-0.5">{new Date(inc.detectedAt).toLocaleString()}</p>
                          {inc.status === 'detected' && (
                            <div className="flex gap-2 mt-2">
                              <button onClick={async () => { setFixing(inc.id); await runAgent(inc.service, inc.id); setFixing(null); try { setIncidents(JSON.parse(localStorage.getItem('voluntrack:incidents') || '[]')) } catch {} }} disabled={isRunning} className="text-xs font-semibold px-2.5 py-1 rounded bg-green-500 text-white hover:bg-green-600 disabled:opacity-50">
                                {isRunning ? 'Fixing...' : 'Approve Fix'}
                              </button>
                              <button onClick={() => { updateIncidentStatus(inc.id, 'failed'); logAgentAction(`Fix for ${inc.service} rejected by admin`, 'error'); try { setIncidents(JSON.parse(localStorage.getItem('voluntrack:incidents') || '[]')) } catch {} }} className="text-xs font-semibold px-2.5 py-1 rounded bg-red-500/20 text-red-600 hover:bg-red-500/30">Reject</button>
                            </div>
                          )}
                        </div>
                      </div>
                    </Card>
                  )
                })}
            </div>
          )}

          <Card>
            <h3 className="font-display font-semibold text-base mb-3 flex items-center gap-2">
              <Bot className="w-4 h-4 text-brand-600" /> AI Agent Log
            </h3>
            {agentLog.length === 0 ? (
              <p className="text-sm text-earth-500 dark:text-earth-400">No agent activity yet.</p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {agentLog.map((entry) => {
                  const typeColors = {
                    info: 'text-blue-600 dark:text-blue-400',
                    fixing: 'text-amber-600 dark:text-amber-400',
                    success: 'text-green-600 dark:text-green-400',
                    error: 'text-red-600 dark:text-red-400',
                  }
                  return (
                    <div key={entry.id} className="flex items-start gap-2 text-xs">
                      <span className="text-earth-400 dark:text-earth-500 shrink-0 w-16">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                      <span className={typeColors[entry.type] || 'text-earth-600 dark:text-earth-300'}>{entry.message}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </>
      ) : contacts.length === 0 ? (
        <Card>
          <div className="text-center py-12 text-earth-500">
            <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="font-medium text-earth-900 dark:text-earth-100">No messages yet</p>
            <p className="text-sm mt-1">New contact submissions will appear here automatically.</p>
            <Link to="/contact" className="btn-primary inline-flex mt-4">Go to contact page</Link>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {contacts.map((c, idx) => (
            <Card key={c.sentAt + idx} padded={false} className="p-5">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-earth-900 dark:text-earth-100">{c.name || 'Unknown'}</span>
                    <a href={`mailto:${c.email}`} className="text-brand-700 dark:text-brand-300 hover:underline text-sm break-all">{c.email}</a>
                    <span className="text-xs text-earth-500 whitespace-nowrap">{new Date(c.sentAt).toLocaleString()}</span>
                  </div>
                  <div className="mt-1 text-xs font-medium uppercase tracking-wide text-earth-600 dark:text-earth-300">{c.subject || 'General question'}</div>
                  <p className="mt-2 text-sm text-earth-800 dark:text-earth-200 whitespace-pre-wrap">{c.message}</p>
                  {drafts[idx] && (
                    <div className="mt-3 p-3 rounded-xl bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800">
                      <div className="text-xs font-semibold text-brand-700 dark:text-brand-300 mb-1">AI draft</div>
                      <p className="text-sm text-earth-700 dark:text-earth-300 whitespace-pre-wrap">{drafts[idx]}</p>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <button onClick={() => toggleDraft(idx)} className="p-2 rounded-lg text-earth-500 hover:text-brand-700 hover:bg-brand-500/10 self-start"
                    title={drafts[idx] ? 'Hide draft' : 'Generate draft reply'}>
                    <Sparkles className={`w-4 h-4 ${drafts[idx] ? 'text-brand-600' : ''}`} />
                  </button>
                  <button onClick={() => remove(idx)} className="p-2 rounded-lg text-earth-500 hover:text-red-600 hover:bg-red-500/10 self-start" title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {payModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPayModal(null)}>
          <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2">Mark school as paid</h3>
            <p className="text-sm text-earth-400 mb-4">Record how they paid (cash, check, Venmo, etc.)</p>
            <div className="space-y-3">
              <textarea
                className="input" rows={3}
                placeholder="e.g. Paid via check #1024 on June 1"
                value={payNotes} onChange={(e) => setPayNotes(e.target.value)}
              />
              <div className="flex gap-2">
                <button onClick={() => setPayModal(null)} className="btn-ghost flex-1">Cancel</button>
                <button onClick={() => markPaid(payModal)} className="btn-primary flex-1">Mark as paid</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {showDueModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowDueModal(false)}>
          <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2">Set payment due date</h3>
            <p className="text-sm text-earth-400 mb-4">This date applies to all schools.</p>
            <div className="space-y-3">
              <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              <div className="flex gap-2">
                <button onClick={() => setShowDueModal(false)} className="btn-ghost flex-1">Cancel</button>
                <button onClick={setGlobalDueDate} className="btn-primary flex-1" disabled={!dueDate}>Save</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {showNotifyModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setShowNotifyModal(false); setNotifySchoolId(null) }}>
          <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2">
              {notifySchoolId ? 'Notify this school' : 'Notify all schools'}
            </h3>
            <p className="text-sm text-earth-400 mb-4">The notification will appear on the school dashboard.</p>
            <div className="space-y-3">
              <textarea
                className="input" rows={3}
                placeholder="e.g. Annual subscription payment is due Jun 30"
                value={notifyMsg} onChange={(e) => setNotifyMsg(e.target.value)}
              />
              <div className="flex gap-2">
                <button onClick={() => setShowNotifyModal(false)} className="btn-ghost flex-1">Cancel</button>
                <button onClick={sendNotify} className="btn-primary flex-1" disabled={!notifyMsg.trim()}>Send</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      <Toast open={toast} onClose={() => setToast(false)}>{toastMessage}</Toast>
    </AppLayout>
  )
}
