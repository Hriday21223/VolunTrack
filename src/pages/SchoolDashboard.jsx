import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Upload, CheckCircle, XCircle, Clock, FileText, Download, Search, Users, MapPin, Calendar, MessageSquare, Bell, ShieldCheck, Trash2, Receipt, KeyRound } from 'lucide-react'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import SpotlightTour from '@/components/SpotlightTour.jsx'
import { useAuth } from '@/hooks/useAuth.jsx'
import SsoSettings from '@/components/SsoSettings.jsx'
import TenantDomainSettings from '@/components/TenantDomainSettings.jsx'
import HoursReportPanel from '@/components/HoursReportPanel.jsx'
import { generateInvoicePDF } from '@/lib/export.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

const SCHOOL_TOUR_STEPS = [
  { selector: '[data-tour="tab-reports"]', title: 'Reports', description: 'Review the PDF proof documents students upload, and approve or reject each one.' },
  { selector: '[data-tour="tab-students"]', title: 'Students', description: 'See everyone linked to your school, and add students by email.' },
  { selector: '[data-tour="tab-chat"]', title: 'Chat', description: 'Send an announcement to every student linked to your school at once.' },
]

// Co-admins tab is only rendered for the primary school-admin role, not
// school_staff — so its tour step only applies there too.
const SCHOOL_ADMIN_ONLY_TOUR_STEP = { selector: '[data-tour="tab-staff"]', title: 'Co-admins', description: 'Add up to 10 co-admins who can share the day-to-day work of reviewing uploads and managing students.' }

export default function SchoolDashboard() {
  const { user, refreshUser } = useAuth()
  const nav = useNavigate()
  const isSchoolAdmin = user?.role === 'school' || user?.role === 'school_staff'
  const [tab, setTab] = useState('pdfs')
  const [pdfs, setPdfs] = useState([])
  const [students, setStudents] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const [uploading, setUploading] = useState(false)
  const [selectedPdf, setSelectedPdf] = useState(null)
  const [addEmail, setAddEmail] = useState('')
  const [adding, setAdding] = useState(false)
  const [addErr, setAddErr] = useState('')
  const [subTab, setSubTab] = useState('reports')
  const [taskForm, setTaskForm] = useState({ title: '', description: '', location: '', date: '', time: '', slotsTotal: 1, phone: '', importantInfo: '' })
  const [taskBusy, setTaskBusy] = useState(false)
  const [messages, setMessages] = useState([])
  const [messageText, setMessageText] = useState('')
  const [sendingMsg, setSendingMsg] = useState(false)
  const [schoolInfo, setSchoolInfo] = useState(null)
  const [adminNotifs, setAdminNotifs] = useState([])
  const [confirmRef, setConfirmRef] = useState('')
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [staff, setStaff] = useState([])
  const [staffForm, setStaffForm] = useState({ name: '', email: '', password: '' })
  const [addingStaff, setAddingStaff] = useState(false)
  const [staffErr, setStaffErr] = useState('')
  const [invoices, setInvoices] = useState([])

  useEffect(() => {
    if (!user) return
    loadData()
  }, [user])

  const loadMessages = async () => {
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) { const d = await res.json(); setMessages(d.messages || []) }
    } catch {}
  }

  const handleSendMessage = async (e) => {
    e.preventDefault()
    if (!messageText.trim()) return
    setSendingMsg(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: messageText.trim() }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
      setMessageText('')
      loadMessages()
    } catch (e) { setToastMsg(e.message); setToast(true) } finally { setSendingMsg(false) }
  }

  const handleAddStaff = async (e) => {
    e.preventDefault()
    setStaffErr('')
    setAddingStaff(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(staffForm),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add co-admin')
      setToastMsg('Co-admin added!')
      setToast(true)
      setStaffForm({ name: '', email: '', password: '' })
      loadData()
    } catch (e) { setStaffErr(e.message) } finally { setAddingStaff(false) }
  }

  const handleRemoveStaff = async (id) => {
    if (!confirm('Remove this co-admin? They will lose access immediately.')) return
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/staff/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed')
      setToastMsg('Co-admin removed')
      setToast(true)
      loadData()
    } catch { setToastMsg('Failed to remove co-admin'); setToast(true) }
  }

  const loadData = async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const headers = { Authorization: `Bearer ${token}` }

      const [pdfRes, taskRes, infoRes] = await Promise.all([
        fetch(`${apiUrl}/school/pdfs`, { headers }),
        fetch(`${apiUrl}/school/public-tasks`),
        fetch(`${apiUrl}/school/info?id=${user.schoolId}`, { headers }),
      ])
      if (infoRes.ok) { const d = await infoRes.json(); setSchoolInfo(d.school) }
      const notifRes = await fetch(`${apiUrl}/school/admin/notifications?schoolId=${user.schoolId}`, { headers })
      if (notifRes.ok) { const d = await notifRes.json(); setAdminNotifs(d.notifications || []) }
      if (pdfRes.ok) {
        const data = await pdfRes.json()
        setPdfs(data.pdfs || [])
      }
      if (taskRes.ok) {
        const data = await taskRes.json()
        setTasks(data.tasks || [])
      }

      if (isSchoolAdmin) {
        const stuRes = await fetch(`${apiUrl}/school/students`, { headers })
        if (stuRes.ok) {
          const data = await stuRes.json()
          setStudents(data.students || [])
        }
        const staffRes = await fetch(`${apiUrl}/school/staff`, { headers })
        if (staffRes.ok) {
          const data = await staffRes.json()
          setStaff(data.staff || [])
        }
        const invoiceRes = await fetch(`${apiUrl}/invoices/mine`, { headers })
        if (invoiceRes.ok) {
          const data = await invoiceRes.json()
          setInvoices(data.invoices || [])
        }
      }
    } catch (e) {
      console.error('Load failed:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmitConfirmation = async (e) => {
    e.preventDefault()
    if (!confirmRef.trim()) return
    setConfirmBusy(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/submit-payment-confirmation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reference: confirmRef.trim() }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to submit') }
      setToastMsg('Confirmation submitted — please allow 3–5 business days for verification. We\'ll email you once approved.')
      setToast(true)
      setConfirmRef('')
      await refreshUser()
      loadData()
    } catch (e) {
      setToastMsg(e.message)
      setToast(true)
    } finally {
      setConfirmBusy(false)
    }
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setToastMsg('File too large. Max 10MB.')
      setToast(true)
      return
    }
    setUploading(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const reader = new FileReader()
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1]
        const res = await fetch(`${apiUrl}/school/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ filename: file.name, fileData: base64, fileType: file.type }),
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Upload failed')
        }
        setToastMsg('PDF uploaded!')
        setToast(true)
        loadData()
      }
      reader.readAsDataURL(file)
    } catch (e) {
      setToastMsg(e.message)
      setToast(true)
    } finally {
      setUploading(false)
    }
  }

  const reviewPdf = async (id, status) => {
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/pdf/${id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error('Failed to update')
      setToastMsg(`PDF ${status}`)
      setToast(true)
      loadData()
    } catch (e) {
      setToastMsg(e.message)
      setToast(true)
    }
  }

  const viewPdf = async (id) => {
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/pdf/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setSelectedPdf(data.pdf)
    } catch (e) {
      setToastMsg(e.message)
      setToast(true)
    }
  }

  const statusIcon = (status) => {
    if (status === 'approved') return <CheckCircle className="w-4 h-4 text-emerald-400" />
    if (status === 'rejected') return <XCircle className="w-4 h-4 text-red-400" />
    return <Clock className="w-4 h-4 text-amber-400" />
  }

  if (selectedPdf) {
    return (
      <AppLayout title="PDF Preview" subtitle={selectedPdf.filename}>
        <div className="max-w-4xl mx-auto">
          <Card className="mb-4">
            <button onClick={() => setSelectedPdf(null)} className="btn-ghost mb-4">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back
            </button>
            <div className="flex items-center gap-2 mb-4">
              {statusIcon(selectedPdf.status)}
              <span className="text-sm font-medium capitalize">{selectedPdf.status}</span>
            </div>
            <div className="bg-white rounded-xl overflow-hidden" style={{ height: '80vh' }}>
              <embed src={`data:${selectedPdf.fileType};base64,${selectedPdf.fileData}`} type="application/pdf" className="w-full h-full" />
            </div>
            {isSchoolAdmin && selectedPdf.status === 'pending' && (
              <div className="flex gap-2 mt-4">
                <button onClick={() => reviewPdf(selectedPdf.id, 'approved')} className="btn-primary flex-1">
                  <CheckCircle className="w-4 h-4 mr-2" /> Approve
                </button>
                <button onClick={() => reviewPdf(selectedPdf.id, 'rejected')} className="btn-danger flex-1">
                  <XCircle className="w-4 h-4 mr-2" /> Reject
                </button>
              </div>
            )}
          </Card>
        </div>
      </AppLayout>
    )
  }

  // Source of truth is the authenticated user's schoolPaymentStatus (set at
  // login/me and refreshed via loadData below) — NOT the /school/info fetch.
  // That fetch can fail (network error, rate limit) and must never fail the
  // gate open; schoolInfo is only used below for supplementary display.
  const paymentStatus = user?.schoolPaymentStatus
  if (isSchoolAdmin && paymentStatus && paymentStatus !== 'paid') {
    return (
      <AppLayout title="Payment Required" subtitle="Your school's account is locked until payment is verified">
        <div className="max-w-lg mx-auto space-y-4">
          {adminNotifs.length > 0 && (
            <div className="space-y-2">
              {adminNotifs.map((n) => (
                <div key={n.id} className="text-sm p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <p>{n.message}</p>
                  <p className="text-xs text-earth-500 mt-1">{new Date(n.created_at).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          )}
          <Card>
            <h3 className="font-semibold mb-2">
              {paymentStatus === 'pending' ? 'Confirmation submitted' : paymentStatus === 'rejected' ? 'Confirmation rejected' : 'Payment required'}
            </h3>
            {paymentStatus === 'pending' && (
              <p className="text-sm text-earth-500 mb-3">We received your bank confirmation number. Please allow 3–5 business days for our team to verify it — you'll get an approval email once it's confirmed, and student uploads and management will unlock automatically.</p>
            )}
            {paymentStatus === 'rejected' && (
              <p className="text-sm text-red-500 mb-3">{schoolInfo?.paymentNotes || 'Your confirmation could not be verified.'} Please double-check the number and resubmit.</p>
            )}
            {paymentStatus === 'unpaid' && (
              <p className="text-sm text-earth-500 mb-3">Please complete payment using the instructions sent to your school's email, then enter the bank confirmation number below.</p>
            )}
            {paymentStatus !== 'pending' && user?.role === 'school' && (
              <form onSubmit={handleSubmitConfirmation} className="space-y-3">
                <label htmlFor="confirmRef" className="text-sm text-earth-500">Please enter your bank confirmation / reference number</label>
                <input
                  id="confirmRef"
                  type="text"
                  placeholder="e.g. WIRE-12345 or check #4821"
                  value={confirmRef}
                  onChange={(e) => setConfirmRef(e.target.value)}
                  className="input"
                />
                <button type="submit" className="btn-primary w-full" disabled={confirmBusy || !confirmRef.trim()}>
                  {confirmBusy ? 'Submitting…' : 'Submit confirmation'}
                </button>
              </form>
            )}
            {paymentStatus !== 'pending' && user?.role === 'school_staff' && (
              <p className="text-sm text-earth-500">Only the school's primary admin account can submit a payment confirmation.</p>
            )}
          </Card>
        </div>
        <Toast show={toast} message={toastMsg} onClose={() => setToast(false)} />
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title={isSchoolAdmin ? 'School Dashboard' : 'My Documents'}
      subtitle={
        <span className="flex items-center gap-2">
          {isSchoolAdmin ? 'Review student uploads' : 'Upload verification documents'}
          {schoolInfo?.paymentStatus && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              schoolInfo.paymentStatus === 'paid'
                ? 'bg-emerald-500/20 text-emerald-600'
                : 'bg-amber-500/20 text-amber-600'
            }`}>
              {schoolInfo.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}
            </span>
          )}
        </span>
      }
      action={
        <div className="flex gap-2">
          <button data-tour="tab-reports" onClick={() => setTab('pdfs')} className={`btn-sm ${tab === 'pdfs' ? 'btn-primary' : 'btn-ghost'}`}>Reports</button>
          {isSchoolAdmin && (
            <>
              <button data-tour="tab-students" onClick={() => { setTab('students'); setSubTab('list') }} className={`btn-sm ${tab === 'students' ? 'btn-primary' : 'btn-ghost'}`}>Students</button>
              <button data-tour="tab-chat" onClick={() => { setTab('chat'); loadMessages() }} className={`btn-sm ${tab === 'chat' ? 'btn-primary' : 'btn-ghost'}`}>
                <MessageSquare className="w-3.5 h-3.5 mr-1" /> Chat
              </button>
              {user?.role === 'school' && (
                <button data-tour="tab-staff" onClick={() => setTab('staff')} className={`btn-sm ${tab === 'staff' ? 'btn-primary' : 'btn-ghost'}`}>
                  <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Co-admins
                </button>
              )}
              <button onClick={() => setTab('hours')} className={`btn-sm ${tab === 'hours' ? 'btn-primary' : 'btn-ghost'}`}>
                <Download className="w-3.5 h-3.5 mr-1" /> Hours
              </button>
              {user?.role === 'school' && (
                <button onClick={() => setTab('sso')} className={`btn-sm ${tab === 'sso' ? 'btn-primary' : 'btn-ghost'}`}>
                  <KeyRound className="w-3.5 h-3.5 mr-1" /> Sign-in
                </button>
              )}
            </>
          )}
          <button onClick={() => setTab('volunteer')} className={`btn-sm ${tab === 'volunteer' ? 'btn-primary' : 'btn-ghost'}`}>
            <Users className="w-3.5 h-3.5 mr-1" /> Volunteer
          </button>
        </div>
      }
    >
      {isSchoolAdmin && (
        <SpotlightTour
          storageKey="voluntrack:tour-seen:school"
          steps={user?.role === 'school' ? [...SCHOOL_TOUR_STEPS, SCHOOL_ADMIN_ONLY_TOUR_STEP] : SCHOOL_TOUR_STEPS}
        />
      )}
      <div className="max-w-4xl mx-auto space-y-4">
        {adminNotifs.length > 0 && (
          <Card>
            <h3 className="font-semibold text-sm flex items-center gap-2 mb-3"><Bell className="w-4 h-4 text-brand-600" /> Payment notices</h3>
            <div className="space-y-2">
              {adminNotifs.map((n) => (
                <div key={n.id} className="text-sm p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <p>{n.message}</p>
                  <p className="text-xs text-earth-500 mt-1">{new Date(n.created_at).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          </Card>
        )}
        {schoolInfo?.paymentDueDate && (() => {
          const daysLeft = Math.ceil((new Date(schoolInfo.paymentDueDate) - new Date()) / (1000 * 60 * 60 * 24))
          if (daysLeft <= 10 && daysLeft >= 0) {
            return (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-sm">
                <Calendar className="w-4 h-4 inline mr-1" />
                Payment due in <strong>{daysLeft} day{daysLeft === 1 ? '' : 's'}</strong>
              </div>
            )
          }
          return null
        })()}
        {isSchoolAdmin && invoices.length > 0 && (
          <Card>
            <h3 className="font-semibold text-sm flex items-center gap-2 mb-3"><Receipt className="w-4 h-4 text-brand-600" /> Invoices</h3>
            <div className="space-y-2">
              {invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-3 text-sm p-3 rounded-xl bg-earth-500/5">
                  <div className="min-w-0">
                    <p className="font-medium">{inv.invoice_number} <span className="text-earth-500 font-normal">${Number(inv.amount).toFixed(2)}</span></p>
                    <p className="text-xs text-earth-500 mt-0.5">
                      {inv.due_date ? `Due ${new Date(inv.due_date).toLocaleDateString()}` : new Date(inv.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      inv.status === 'paid'
                        ? 'bg-emerald-500/20 text-emerald-600'
                        : inv.status === 'void'
                        ? 'bg-earth-500/20 text-earth-500'
                        : 'bg-amber-500/20 text-amber-600'
                    }`}>
                      {inv.status === 'paid' ? 'Paid' : inv.status === 'void' ? 'Void' : 'Sent'}
                    </span>
                    <button
                      onClick={() => generateInvoicePDF({
                        invoiceNumber: inv.invoice_number,
                        entityName: schoolInfo?.name,
                        amount: inv.amount,
                        billingPeriod: inv.billing_period,
                        description: inv.description,
                        dueDate: inv.due_date,
                        createdAt: inv.created_at,
                      })}
                      className="p-1.5 text-earth-400 hover:text-earth-300"
                      title="Download PDF"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
        {tab === 'chat' && isSchoolAdmin && (
          <div className="space-y-4">
            <Card>
              <h3 className="font-semibold mb-3 flex items-center gap-2"><MessageSquare className="w-4 h-4 text-brand-600" /> Send announcement</h3>
              <form onSubmit={handleSendMessage} className="space-y-3">
                <textarea
                  className="input" rows={3} placeholder="Write a message to all students…"
                  value={messageText} onChange={(e) => setMessageText(e.target.value)} maxLength={2000} required
                />
                <button type="submit" className="btn-primary" disabled={sendingMsg || !messageText.trim()}>
                  {sendingMsg ? 'Sending…' : 'Send to all students'}
                </button>
              </form>
            </Card>
            <div className="space-y-3">
              <h3 className="font-semibold text-sm text-earth-400 uppercase tracking-wider">Previously sent</h3>
              {messages.length === 0 ? (
                <Card><p className="text-center text-earth-500 py-6 text-sm">No messages sent yet.</p></Card>
              ) : messages.map((m) => (
                <Card key={m.id} padded={false} className="p-4">
                  <p className="text-sm">{m.message}</p>
                  <p className="text-xs text-earth-500 mt-2">
                    {m.sender_name} · {new Date(m.created_at).toLocaleString()}
                  </p>
                </Card>
              ))}
            </div>
          </div>
        )}

        {user?.role === 'student' && (
          <Card>
            <h3 className="font-semibold mb-3 flex items-center gap-2"><Upload className="w-4 h-4 text-brand-600" /> Upload verification PDF</h3>
            {paymentStatus && paymentStatus !== 'paid' ? (
              <p className="text-sm p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400">
                Your school hasn't completed payment yet — submissions are paused until payment is verified.
              </p>
            ) : (
              <>
                <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">Upload volunteer hour verification documents for your school to review.</p>
                <label className="btn-primary inline-flex items-center cursor-pointer">
                  {uploading ? 'Uploading…' : <><Upload className="w-4 h-4 mr-2" /> Choose PDF</>}
                  <input type="file" accept=".pdf,application/pdf" className="hidden" onChange={handleFileUpload} disabled={uploading} />
                </label>
              </>
            )}
          </Card>
        )}

        {tab === 'students' && isSchoolAdmin && (
          <>
            <div className="flex gap-2 mb-4">
              <button onClick={() => setSubTab('list')} className={`btn-sm ${subTab === 'list' ? 'btn-primary' : 'btn-ghost'}`}>
                <Search className="w-3.5 h-3.5 mr-1" /> Student list ({students.length})
              </button>
              <button onClick={() => setSubTab('add')} className={`btn-sm ${subTab === 'add' ? 'btn-primary' : 'btn-ghost'}`}>
                <Upload className="w-3.5 h-3.5 mr-1" /> Add student
              </button>
            </div>

            {subTab === 'add' && (
              <Card>
                <h3 className="font-semibold mb-3">Add student by email</h3>
                <form onSubmit={async (e) => {
                  e.preventDefault()
                  setAddErr('')
                  setAdding(true)
                  try {
                    const token = localStorage.getItem('voluntrack:auth_token')
                    const res = await fetch(`${apiUrl}/school/add-student`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ email: addEmail }),
                    })
                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error || 'Failed')
                    setToastMsg('Student added!')
                    setToast(true)
                    setAddEmail('')
                    loadData()
                  } catch (e) { setAddErr(e.message) } finally { setAdding(false) }
                }} className="space-y-3">
                  <div className="flex gap-2">
                    <input type="email" className="input flex-1" placeholder="student@school.edu" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} required />
                    <button type="submit" className="btn-primary" disabled={adding}>{adding ? 'Adding…' : 'Add'}</button>
                  </div>
                  {addErr && <p className="text-sm text-red-500">{addErr}</p>}
                </form>
              </Card>
            )}

            {subTab === 'list' && (
              <Card>
                <h3 className="font-semibold mb-3 flex items-center gap-2"><Search className="w-4 h-4 text-brand-600" /> Students ({students.length})</h3>
                {students.length === 0 ? (
                  <p className="text-sm text-earth-500">No students linked to your school yet.</p>
                ) : (
                  <div className="divide-y divide-white/10">
                    {students.map((s) => (
                      <div key={s.id} className="py-3 flex justify-between items-center">
                        <div>
                          <p className="font-medium text-sm">{s.name}</p>
                          <p className="text-xs text-earth-400">{s.email}{s.grade ? ` · ${s.grade}` : ''}</p>
                        </div>
                        <span className="text-xs text-earth-500">{new Date(s.created_at).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}
          </>
        )}

        {tab === 'hours' && isSchoolAdmin && (
          <Card>
            <h2 className="text-lg font-semibold mb-1">Hour reports</h2>
            <p className="text-sm text-slate-500 mb-4">
              Export every student's logged hours for a date range — for administrators,
              service-hour compliance, or grant reporting.
            </p>
            <HoursReportPanel title="Volunteer hours report" />
          </Card>
        )}

        {tab === 'sso' && user?.role === 'school' && (
          <Card>
            <h2 className="text-lg font-semibold mb-1">Single sign-on</h2>
            <p className="text-sm text-slate-500 mb-4">
              Let students sign in with your school&apos;s Google or Microsoft account instead of a VolunTrack password.
            </p>
            <SsoSettings />
          </Card>
        )}

        {tab === 'sso' && user?.role === 'school' && (
          <Card className="mt-6">
            <h2 className="text-lg font-semibold mb-1">Custom domain</h2>
            <p className="text-sm text-slate-500 mb-4">
              Serve VolunTrack to your students on your own web address instead of the shared one.
            </p>
            <TenantDomainSettings />
          </Card>
        )}

        {tab === 'staff' && user?.role === 'school' && (
          <div className="space-y-4">
            <Card>
              <h3 className="font-semibold mb-1 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-brand-600" /> Add a co-admin</h3>
              <p className="text-sm text-earth-500 mb-3">
                Co-admins can review uploads, manage students, and send announcements — {staff.length}/10 used.
              </p>
              {staff.length >= 10 ? (
                <p className="text-sm p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400">
                  You've reached the limit of 10 co-admins. Remove one below to add another.
                </p>
              ) : (
                <form onSubmit={handleAddStaff} className="space-y-3">
                  <input type="text" className="input" placeholder="Name" value={staffForm.name} onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })} required />
                  <input type="email" className="input" placeholder="Email" value={staffForm.email} onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })} required />
                  <input type="password" className="input" placeholder="Temporary password (min 8 chars)" value={staffForm.password} onChange={(e) => setStaffForm({ ...staffForm, password: e.target.value })} minLength={8} required />
                  <button type="submit" className="btn-primary" disabled={addingStaff}>{addingStaff ? 'Adding…' : 'Add co-admin'}</button>
                  {staffErr && <p className="text-sm text-red-500">{staffErr}</p>}
                </form>
              )}
            </Card>

            <Card>
              <h3 className="font-semibold mb-3 flex items-center gap-2"><Users className="w-4 h-4 text-brand-600" /> Co-admins ({staff.length})</h3>
              {staff.length === 0 ? (
                <p className="text-sm text-earth-500">No co-admins added yet.</p>
              ) : (
                <div className="divide-y divide-white/10">
                  {staff.map((m) => (
                    <div key={m.id} className="py-3 flex justify-between items-center">
                      <div>
                        <p className="font-medium text-sm">{m.name}</p>
                        <p className="text-xs text-earth-400">{m.email}</p>
                      </div>
                      <button onClick={() => handleRemoveStaff(m.id)} className="text-red-400 hover:text-red-300 p-2" title="Remove co-admin">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}

        {tab === 'volunteer' && (
          <div className="space-y-4">
            <Card>
              <h3 className="font-semibold mb-3">Post a volunteer task</h3>
              <form onSubmit={async (e) => {
                e.preventDefault(); setTaskBusy(true)
                try {
                  const token = localStorage.getItem('voluntrack:auth_token')
                  const res = await fetch(`${apiUrl}/school/public-tasks`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify(taskForm),
                  })
                  if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
                   setTaskForm({ title: '', description: '', location: '', date: '', time: '', slotsTotal: 1, phone: '', importantInfo: '' })
                  setToastMsg('Task posted!'); setToast(true); loadData()
                } catch (e) { setToastMsg(e.message); setToast(true) } finally { setTaskBusy(false) }
              }} className="space-y-3">
                <input className="input" placeholder="Task title" value={taskForm.title} onChange={(e) => setTaskForm({...taskForm, title: e.target.value})} required />
                <textarea className="input" rows={2} placeholder="Description — what volunteers will do" value={taskForm.description} onChange={(e) => setTaskForm({...taskForm, description: e.target.value})} required />
                <input className="input" placeholder="Location — where it happens" value={taskForm.location} onChange={(e) => setTaskForm({...taskForm, location: e.target.value})} required />
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
                <button type="submit" className="btn-primary w-full" disabled={taskBusy}>{taskBusy ? 'Posting…' : 'Post task'}</button>
              </form>
            </Card>

            {tasks.length === 0 ? (
              <Card><p className="text-center text-earth-500 py-8">No volunteer tasks yet.</p></Card>
            ) : tasks.map((t) => {
              const filled = Number(t.slots_filled)
              const total = Number(t.slots_total)
              const full = filled >= total
              const approved = t.my_signup_status === 'approved'
              return (
                <Card key={t.id} padded={false} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{t.title}</p>
                      <p className="text-sm text-earth-400 mt-1">{t.description}</p>
                      <div className="flex flex-wrap gap-3 mt-2 text-xs text-earth-500">
                        <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {t.location}</span>
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(t.date).toLocaleDateString()}{t.time ? ` · ${t.time}` : ''}</span>
                        <span>{filled}/{total} filled</span>
                      </div>
                      {approved && t.phone && (
                        <p className="text-xs text-emerald-400 mt-1 font-medium">Contact: {t.phone}</p>
                      )}
                      {approved && t.important_info && (
                        <div className="mt-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                          <p className="text-xs font-semibold text-emerald-300 mb-0.5">Important info</p>
                          <p className="text-xs text-emerald-200/80">{t.important_info}</p>
                        </div>
                      )}
                      {t.my_signup_status === 'pending' && (
                        <p className="text-xs text-amber-400 mt-1">Awaiting organizer approval</p>
                      )}
                      {t.my_signup_status === 'rejected' && (
                        <p className="text-xs text-red-400 mt-1">Signup rejected</p>
                      )}
                    </div>
                    <div className="shrink-0">
                      {t.my_signup_status === 'approved' ? (
                        <span className="text-xs text-emerald-400 font-medium">Approved</span>
                      ) : t.my_signup_status === 'pending' ? (
                        <span className="text-xs text-amber-400 font-medium">Pending</span>
                      ) : t.my_signup_status === 'rejected' ? (
                        <span className="text-xs text-red-400 font-medium">Rejected</span>
                      ) : full ? (
                        <span className="text-xs text-red-400 font-medium">Full</span>
                      ) : (
                        <button onClick={async () => {
                          try {
                            const token = localStorage.getItem('voluntrack:auth_token')
                            const res = await fetch(`${apiUrl}/school/public-tasks/${t.id}/signup`, {
                              method: 'POST',
                              headers: { Authorization: `Bearer ${token}` },
                            })
                            if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
                            setToastMsg('Signed up — awaiting organizer approval'); setToast(true); loadData()
                          } catch (e) { setToastMsg(e.message); setToast(true) }
                        }} className="btn-primary text-sm">Sign up</button>
                      )}
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}

        {tab === 'pdfs' && (
        <div className="space-y-3">
          {loading ? (
            <p className="text-center text-earth-400 py-8">Loading…</p>
          ) : pdfs.length === 0 ? (
            <Card><p className="text-center text-earth-500 py-8">No PDFs yet.</p></Card>
          ) : pdfs.map((pdf) => (
            <Card key={pdf.id} padded={false} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <FileText className="w-8 h-8 text-brand-600 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{pdf.filename}</p>
                    <p className="text-xs text-earth-400">
                      {pdf.user_name && `${pdf.user_name} · `}
                      {new Date(pdf.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {statusIcon(pdf.status)}
                  <button onClick={() => viewPdf(pdf.id)} className="btn-ghost text-sm p-2">
                    <FileText className="w-4 h-4" />
                  </button>
                  {isSchoolAdmin && pdf.status === 'pending' && (
                    <>
                      <button onClick={() => reviewPdf(pdf.id, 'approved')} className="text-emerald-400 hover:text-emerald-300 p-1" title="Approve">
                        <CheckCircle className="w-5 h-5" />
                      </button>
                      <button onClick={() => reviewPdf(pdf.id, 'rejected')} className="text-red-400 hover:text-red-300 p-1" title="Reject">
                        <XCircle className="w-5 h-5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
        )}
      </div>

      <Toast open={toast} onClose={() => setToast(false)}>{toastMsg}</Toast>
    </AppLayout>
  )
}
