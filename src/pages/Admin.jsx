import { useMemo, useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Trash2, Mail, MessageSquare, ShieldCheck, XCircle, Sparkles, School, Users, CreditCard, Download, Calendar, Bell, Star, Heart, AlertTriangle, Bot, Loader2, Wrench, CheckCircle2, UserPlus, RefreshCw } from 'lucide-react'
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
    `Hi ${name}, thanks for writing in!`,
    `Hey ${name}, good to hear from you.`,
    `Hi ${name} — appreciate you reaching out.`,
  ]
  const intro = intros[contact.sentAt ? contact.sentAt.length % intros.length : 0]

  const closings = [
    '\n\nBest,\nHriday (VolunTrack)',
    '\n\nTalk soon,\nHriday (VolunTrack)',
    '\n\nThanks again,\nHriday (VolunTrack)',
  ]
  const closing = closings[contact.sentAt ? contact.sentAt.length % closings.length : 0]

  const bodies = {
    'General question': (
      `VolunTrack is a free, privacy-first app for logging volunteer hours — students track activities, set goals, earn badges, and export ready-to-print PDF reports. It works fully offline after the first load, and by default everything stays on your own device (no account needed unless you want one).\n\nIf there's a school or organization behind your question, we also support school accounts now — a dashboard for reviewing student hours, PDF verification, and PIN-based student linking.\n\nHappy to answer anything specific — just reply here, or poke around the code: https://github.com/Hriday21223/VolunTrack`
    ),
    'Bug report': (
      `Sorry you ran into this, and thanks for flagging it. To track it down quickly, could you send over:\n- Browser and device (e.g. Chrome on Mac, Safari on iPhone)\n- What you were doing right before it happened\n- Any error message or a screenshot, if you have one\n\nYou're welcome to reply directly here, or open an issue on GitHub if you'd rather: https://github.com/Hriday21223/VolunTrack/issues\n\nI'll dig in as soon as I hear back.`
    ),
    'Feature request': (
      `Really appreciate the suggestion — this is exactly the kind of feedback that shapes what gets built next.\n\nFor context, VolunTrack today covers hour logging, goals, badges, reminders, printable reports and certificates, and full school accounts (dashboards, PDF verification, payment tracking, admin invites). Your idea sounds like it'd fit well alongside that.\n\nMind opening it as an issue on GitHub so it doesn't get lost? https://github.com/Hriday21223/VolunTrack/issues — or just reply here and I'll take it from there.`
    ),
    'School or organization partnership': (
      `Great timing — school accounts are live on VolunTrack today, not just on a roadmap. Once your school is set up, you get:\n- A dashboard to review and verify student volunteer hours (with PDF proof uploads)\n- A school code students use to link their accounts\n- Co-admin accounts if you've got more than one staff member managing it\n\nRather than asking you to fill out a signup form yourself, I'll go ahead and send your school an invite email with a link to finish setup — you'll just need to set a password and pick a school code. Expect that shortly; let me know if you'd like me to use a different contact email than this one.\n\nHappy to answer any questions in the meantime.`
    ),
  }

  const body = bodies[subject] || (
    `VolunTrack is a free, privacy-first volunteer hour tracker for students, clubs, and now schools too — logging, goals, badges, printable reports, and school dashboards all in one place. Take a look: https://github.com/Hriday21223/VolunTrack\n\nLet me know if you have any other questions!`
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
  const [noteModal, setNoteModal] = useState(null) // school id
  const [noteDraft, setNoteDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [toast, setToast] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [notifyMsg, setNotifyMsg] = useState('')
  const [showDueModal, setShowDueModal] = useState(false)
  const [showNotifyModal, setShowNotifyModal] = useState(false)
  const [notifySchoolId, setNotifySchoolId] = useState(null) // null = all schools, string = specific school
  const [invites, setInvites] = useState([])
  const [loadingInvites, setLoadingInvites] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [sendingInvite, setSendingInvite] = useState(false)
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

  const loadInvites = useCallback(async () => {
    setLoadingInvites(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      if (!token) return
      const res = await fetch(`${apiUrl}/school/admin/invites`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const data = await res.json()
      setInvites(data.invites || [])
    } catch {} finally {
      setLoadingInvites(false)
    }
  }, [])

  const sendInvite = async () => {
    if (!inviteName.trim() || !inviteEmail.trim()) return
    setSendingInvite(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/admin/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: inviteName.trim(), email: inviteEmail.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setShowInviteModal(false); setInviteName(''); setInviteEmail('')
      loadInvites()
      setToastMessage('Invite sent'); setToast(true)
    } catch (e) { setToastMessage(e.message || 'Failed to send invite'); setToast(true) } finally { setSendingInvite(false) }
  }

  const resendInvite = async (id) => {
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/admin/invite/${id}/resend`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      loadInvites()
      setToastMessage('Invite resent'); setToast(true)
    } catch (e) { setToastMessage(e.message || 'Failed to resend invite'); setToast(true) }
  }

  const deleteInvite = async (id) => {
    if (!confirm('Delete this invite?')) return
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/admin/invite/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed')
      loadInvites()
    } catch {}
  }

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

  const saveNote = async (id) => {
    setSavingNote(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/admin/${id}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ note: noteDraft }),
      })
      if (!res.ok) throw new Error('Failed')
      setNoteModal(null); setNoteDraft(''); loadSchools()
      setToastMessage('Internal note saved'); setToast(true)
    } catch { setToastMessage('Failed to save note'); setToast(true) } finally { setSavingNote(false) }
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
      title={tab === 'inbox' ? 'Contact inbox' : tab === 'reviews' ? 'Reviews' : tab === 'incidents' ? 'Incidents' : tab === 'invites' ? 'Pending invites' : 'Manage schools'}
      subtitle={tab === 'inbox' ? `${contacts.length} message${contacts.length === 1 ? '' : 's'} received` : tab === 'reviews' ? `${reviews.length} review${reviews.length === 1 ? '' : 's'} submitted` : tab === 'incidents' ? `${incidents.length} incident${incidents.length === 1 ? '' : 's'} logged` : tab === 'invites' ? `${invites.length} invite${invites.length === 1 ? '' : 's'} sent` : `${schools.length} school${schools.length === 1 ? '' : 's'} registered`}
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
          <button onClick={() => { setTab('invites'); loadInvites() }} className={`btn-sm ${tab === 'invites' ? 'btn-primary' : 'btn-ghost'}`}>
            <UserPlus className="w-3.5 h-3.5 mr-1" /> Invites
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
              <button onClick={() => setShowInviteModal(true)} className="btn-primary inline-flex mt-4">Invite a school</button>
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
              <button onClick={() => setShowInviteModal(true)} className="btn-sm btn-primary ml-auto">
                <UserPlus className="w-3.5 h-3.5 mr-1" /> Invite school
              </button>
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
                      {s.admin_notes && (
                        <p className="text-xs text-amber-500/80 mt-0.5 flex items-start gap-1">
                          <ShieldCheck className="w-3 h-3 mt-0.5 shrink-0" />
                          <span><span className="font-medium">Internal note (admin only):</span> {s.admin_notes}</span>
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => { setNoteModal(s.id); setNoteDraft(s.admin_notes || '') }} className={`p-2 ${s.admin_notes ? 'text-amber-400 hover:text-amber-300' : 'text-earth-400 hover:text-earth-300'}`} title="Internal note (visible to admins only)">
                      <ShieldCheck className="w-4 h-4" />
                    </button>
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
      ) : tab === 'invites' ? (
        loadingInvites ? (
          <Card><p className="text-center text-earth-400 py-8">Loading invites…</p></Card>
        ) : invites.length === 0 ? (
          <Card>
            <div className="text-center py-12 text-earth-500">
              <UserPlus className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-earth-900 dark:text-earth-100">No invites sent</p>
              <p className="text-sm mt-1">Invite a school and they'll get a link to finish setup themselves.</p>
              <button onClick={() => setShowInviteModal(true)} className="btn-primary inline-flex mt-4">
                <UserPlus className="w-3.5 h-3.5 mr-1" /> Invite a school
              </button>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end mb-4">
              <button onClick={() => setShowInviteModal(true)} className="btn-sm btn-primary">
                <UserPlus className="w-3.5 h-3.5 mr-1" /> Invite school
              </button>
            </div>
            {invites.map((inv) => (
              <Card key={inv.id} padded={false} className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <UserPlus className="w-8 h-8 text-brand-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{inv.name}</p>
                      <p className="text-xs text-earth-400">{inv.email}</p>
                      <div className="flex flex-wrap gap-2 mt-1">
                        <span className="text-xs text-earth-500">Sent {new Date(inv.created_at).toLocaleDateString()}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          inv.effective_status === 'completed'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : inv.effective_status === 'expired'
                            ? 'bg-red-500/10 text-red-400'
                            : 'bg-amber-500/10 text-amber-400'
                        }`}>
                          {inv.effective_status === 'completed' ? 'Set up' : inv.effective_status === 'expired' ? 'Expired' : 'Pending'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {inv.effective_status !== 'completed' && (
                      <button onClick={() => resendInvite(inv.id)} className="text-brand-400 hover:text-brand-300 p-2" title="Resend invite">
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => deleteInvite(inv.id)} className="text-red-400 hover:text-red-300 p-2" title="Delete invite">
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

      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowInviteModal(false)}>
          <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2">Invite a school</h3>
            <p className="text-sm text-earth-400 mb-4">They'll get an email with a link to set their own password and school code. The link expires in 3 days.</p>
            <div className="space-y-3">
              <input
                className="input" placeholder="School name"
                value={inviteName} onChange={(e) => setInviteName(e.target.value)}
              />
              <input
                className="input" type="email" placeholder="admin@school.edu"
                value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
              />
              <div className="flex gap-2">
                <button onClick={() => setShowInviteModal(false)} className="btn-ghost flex-1">Cancel</button>
                <button onClick={sendInvite} className="btn-primary flex-1" disabled={sendingInvite || !inviteName.trim() || !inviteEmail.trim()}>
                  {sendingInvite ? 'Sending…' : 'Send invite'}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {noteModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setNoteModal(null)}>
          <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-400" /> Internal note</h3>
            <p className="text-sm text-earth-400 mb-4">Only visible to admins — the school never sees this.</p>
            <div className="space-y-3">
              <textarea
                className="input" rows={4}
                placeholder="e.g. Called 6/1, they're waiting on district approval for the wire"
                value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
              />
              <div className="flex gap-2">
                <button onClick={() => setNoteModal(null)} className="btn-ghost flex-1">Cancel</button>
                <button onClick={() => saveNote(noteModal)} className="btn-primary flex-1" disabled={savingNote}>{savingNote ? 'Saving…' : 'Save note'}</button>
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
