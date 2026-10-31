import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link, useParams, useLocation } from 'react-router-dom'
import { schoolTabsFromPath, schoolPathFor } from '@/lib/dashboardTabs.js'
import { ArrowLeft, Upload, CheckCircle, XCircle, Clock, FileText, Download, Eye, Search, Users, MapPin, Calendar, MessageSquare, Bell, ShieldCheck, Trash2, Receipt, KeyRound, Globe, Palette, Hash, Copy, Check, ClipboardList, GraduationCap, UserCog } from 'lucide-react'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import AnnouncementBanner from '@/components/AnnouncementBanner.jsx'
import SpotlightTour from '@/components/SpotlightTour.jsx'
import { useAuth } from '@/hooks/useAuth.jsx'
import SsoSettings from '@/components/SsoSettings.jsx'
import RequirementsSettings from '@/components/RequirementsSettings.jsx'
import HandoverForm from '@/components/HandoverForm.jsx'
import StudentNotes from '@/components/StudentNotes.jsx'
import { fetchNoteCounts } from '@/lib/studentNotes.js'
import SchoolVsSchoolCard from '@/components/SchoolVsSchoolCard.jsx'
import ImpactReportCard from '@/components/ImpactReportCard.jsx'
import { HANDOVER_ENDPOINTS } from '@/lib/handover.js'
import { gradeLabel, gradeKey, SCHOOL_GRADES } from '@policy'
import { useMyRequirements } from '@/lib/requirements.js'
import TenantDomainSettings from '@/components/TenantDomainSettings.jsx'
import TenantBrandingSettings from '@/components/TenantBrandingSettings.jsx'
import HoursReportPanel from '@/components/HoursReportPanel.jsx'
import StudentProgressPanel from '@/components/StudentProgressPanel.jsx'
import GraduationReportPanel from '@/components/GraduationReportPanel.jsx'
import GradeRolloverCard from '@/components/GradeRolloverCard.jsx'
import SchoolStarterKit from '@/components/SchoolStarterKit.jsx'
import LeaderboardSettingsCard from '@/components/LeaderboardSettingsCard.jsx'
import ChallengeCard from '@/components/ChallengeCard.jsx'
import { generateInvoicePDF, poLabel } from '@/lib/export.js'
import PdfPreview from '@/components/PdfPreview.jsx'
import SubmittedDocument from '@/components/SubmittedDocument.jsx'
import { submitDocumentToSchool } from '@/lib/schoolDocument.js'
import PaymentDetails from '@/components/PaymentDetails.jsx'
import ReferralCard from '@/components/ReferralCard.jsx'
import { fmtDate } from '@/utils/date.js'
import InviteClassCard from '@/components/InviteClassCard.jsx'
import HoursReviewPanel from '@/components/HoursReviewPanel.jsx'
import GroupHoursCard from '@/components/GroupHoursCard.jsx'
import RejectReportDialog from '@/components/RejectReportDialog.jsx'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

const SCHOOL_TOUR_STEPS = [
  { selector: '[data-tour="tab-students"]', title: tr('Students'), description: tr('See everyone linked to your school, and invite students by email.') },
  { selector: '[data-tour="tab-reports"]', title: tr('Reports'), description: tr('Review the PDF proof documents students upload and approve or reject each one — and export every student\'s hours for a date range.') },
  { selector: '[data-tour="tab-chat"]', title: tr('Announcements'), description: tr('Send a message to every student linked to your school at once.') },
]

// School setup is only rendered for the primary school-admin role, not
// school_staff — so its tour step only applies there too.
const SCHOOL_ADMIN_ONLY_TOUR_STEP = { selector: '[data-tour="tab-staff"]', title: tr('School setup'), description: tr('Add co-admins, let students sign in with your school\'s Google or Microsoft account, and serve VolunTrack on your own domain.') }

// How full a free club is, and how to upgrade (#506).
function ClubPlanCard({ count, limit }) {
  if (count == null || !limit) return null
  const full = count >= limit
  const near = !full && count >= limit * 0.8
  return (
    <Card>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold">{tr('Free club plan')}</h3>
          <p className="text-sm text-earth-500 dark:text-earth-400 mt-0.5">
            {count} of {limit} students. {full ? tr('Your club is full, so new students can’t join.') : near ? tr('You’re close to the limit.') : tr('Every school feature is included.')}
          </p>
        </div>
        <Link to="/contact?topic=school" className={full || near ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}>{tr('Upgrade to a school plan')}</Link>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-earth-100 dark:bg-earth-800 overflow-hidden">
        <div className={`h-full rounded-full ${full ? 'bg-amber-500' : 'bg-brand-500'}`} style={{ width: `${Math.min(100, (count / limit) * 100)}%` }} />
      </div>
    </Card>
  )
}

export default function SchoolDashboard() {
  const { user, refreshUser } = useAuth()
  const nav = useNavigate()
  const isSchoolAdmin = user?.role === 'school' || user?.role === 'school_staff'
  // The tab and sub-tab live in the address (#579): /school/dashboard/setup/requirements.
  const { tab: tabParam, sub: subParam } = useParams()
  const location = useLocation()
  const tabsSettled = useRef(false)
  const [tab, setTab] = useState(() => schoolTabsFromPath(tabParam, subParam).tab)
  const [pdfs, setPdfs] = useState([])
  const [students, setStudents] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const [uploading, setUploading] = useState(false)
  const [selectedPdf, setSelectedPdf] = useState(null)
  const [rejecting, setRejecting] = useState(null)
  const [addEmail, setAddEmail] = useState('')
  const [adding, setAdding] = useState(false)
  const [addErr, setAddErr] = useState('')
  const [subTab, setSubTab] = useState(() => schoolTabsFromPath(tabParam, subParam).subTab)
  // Reports and School setup each group what used to be their own top-level
  // tabs, so they carry their own sub-tab state rather than sharing subTab
  // (which the students list/add toggle already owns).
  const [reportTab, setReportTab] = useState(() => schoolTabsFromPath(tabParam, subParam).reportTab)
  const [setupTab, setSetupTab] = useState(() => schoolTabsFromPath(tabParam, subParam).setupTab)

  // Back/forward (or a link) changed the address: show that tab.
  useEffect(() => {
    const s = schoolTabsFromPath(tabParam, subParam)
    setTab(s.tab)
    setSubTab(s.subTab)
    setReportTab(s.reportTab)
    setSetupTab(s.setupTab)
  }, [tabParam, subParam])
  // A tab was picked: put it in the address, so a reload or a shared link lands
  // here. An address that only spelled the tab differently is tidied in place.
  // Students reach this page for their upload card and keep the plain address.
  useEffect(() => {
    if (!isSchoolAdmin) return
    // School setup is the main admin's; a co-admin following a link to it
    // gets Reports rather than an empty page.
    if (tab === 'setup' && user?.role !== 'school') { setTab('pdfs'); return }
    const path = schoolPathFor({ tab, subTab, reportTab, setupTab })
    // Tidying the address the page opened at replaces it; every tab picked
    // after that is its own history entry, so Back steps through them.
    if (path !== location.pathname) nav(path, { replace: !tabsSettled.current || location.pathname.toLowerCase() === path })
    tabsSettled.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, subTab, reportTab, setupTab, isSchoolAdmin])
  const [taskForm, setTaskForm] = useState({ title: '', description: '', location: '', date: '', time: '', slotsTotal: 1, phone: '', importantInfo: '' })
  const [taskBusy, setTaskBusy] = useState(false)
  const [messages, setMessages] = useState([])
  const [messageText, setMessageText] = useState('')
  const [sendingMsg, setSendingMsg] = useState(false)
  const [schoolInfo, setSchoolInfo] = useState(null)
  const [codeCopied, setCodeCopied] = useState(false)
  const [adminNotifs, setAdminNotifs] = useState([])
  const [confirmRef, setConfirmRef] = useState('')
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [staff, setStaff] = useState([])
  const [handoverStaffId, setHandoverStaffId] = useState(null)
  // Private adviser notes (#567): which student's are open, and how many each has.
  const [notesFor, setNotesFor] = useState(null)
  // A student's grade, set by the adviser (#581), from the school's own grades.
  const schoolRequirements = useMyRequirements()
  const schoolGradeOptions = schoolRequirements.policy?.goals?.grades?.length ? schoolRequirements.policy.goals.grades : SCHOOL_GRADES
  const setStudentGrade = async (id, grade) => {
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/students/${encodeURIComponent(id)}/grade`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ grade: grade || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not save the grade.')
      setStudents((list) => list.map((st) => (st.id === id ? { ...st, grade: data.grade } : st)))
    } catch (e) { setToastMsg(e.message); setToast(true) }
  }
  const [noteCounts, setNoteCounts] = useState({})
  useEffect(() => {
    if (tab === 'students' && subTab === 'list') fetchNoteCounts().then(setNoteCounts)
  }, [tab, subTab])
  const [staffForm, setStaffForm] = useState({ name: '', email: '', password: '' })
  const [addingStaff, setAddingStaff] = useState(false)
  const [staffErr, setStaffErr] = useState('')
  const [invoices, setInvoices] = useState([])
  const [accountCode, setAccountCode] = useState(null)
  // Invoice currently open in the preview overlay, or null.
  const [previewInvoice, setPreviewInvoice] = useState(null)
  // Students at another school asking to move here (#143 step 5). Nothing
  // moves until someone on this side accepts.
  const [transfers, setTransfers] = useState([])
  const [transferBusy, setTransferBusy] = useState('')

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

  // Messages load whenever that tab opens, including from its address.
  useEffect(() => {
    if (tab === 'chat') loadMessages()
  }, [tab])

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
      setToastMsg(tr('Co-admin added!'))
      setToast(true)
      setStaffForm({ name: '', email: '', password: '' })
      loadData()
    } catch (e) { setStaffErr(e.message) } finally { setAddingStaff(false) }
  }

  const handleRemoveStaff = async (id) => {
    if (!confirm(tr('Remove this co-admin? They will lose access immediately.'))) return
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/staff/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed')
      setToastMsg(tr('Co-admin removed'))
      setToast(true)
      loadData()
    } catch { setToastMsg(tr('Failed to remove co-admin')); setToast(true) }
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
          setAccountCode(data.accountCode || null)
        }
        const transferRes = await fetch(`${apiUrl}/school/transfers`, { headers })
        if (transferRes.ok) {
          const data = await transferRes.json()
          setTransfers(data.transfers || [])
        }
      }
    } catch (e) {
      console.error('Load failed:', e)
    } finally {
      setLoading(false)
    }
  }

  const copyCode = async () => {
    if (!schoolInfo?.pin) return
    try {
      await navigator.clipboard.writeText(schoolInfo.pin)
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 2000)
    } catch { /* clipboard blocked — the code is selectable on screen */ }
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
      setToastMsg(tr('Confirmation submitted — please allow 3–5 business days for verification. We\'ll email you once approved.'))
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
      setToastMsg(tr('File too large. Max 10MB.'))
      setToast(true)
      return
    }
    setUploading(true)
    try {
      // Uploads to the school's own storage where one is configured, so the
      // document never passes through us (#143 step 6).
      await submitDocumentToSchool(file)
      setToastMsg(tr('PDF uploaded!'))
      setToast(true)
      loadData()
    } catch (e) {
      setToastMsg(e.message)
      setToast(true)
    } finally {
      setUploading(false)
    }
  }

  // Accepting moves the student's account to this school; declining leaves
  // them exactly where they are. Either way the request is spent, so the list
  // is reloaded rather than patched locally.
  const decideTransfer = async (id, decision) => {
    setTransferBusy(id)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/transfers/${id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ decision }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not record the decision.')
      setToastMsg(decision === 'accept' ? 'Student transferred in.' : 'Transfer declined.')
      setToast(true)
      loadData()
    } catch (e) {
      setToastMsg(e.message)
      setToast(true)
    } finally {
      setTransferBusy('')
    }
  }

  // Approving is one tap; rejecting opens RejectReportDialog for the reason
  // the student will see (#583), and that dialog shows any error itself.
  const sendReview = async (id, status, notes) => {
    const token = localStorage.getItem('voluntrack:auth_token')
    const res = await fetch(`${apiUrl}/school/pdf/${id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status, notes }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Failed to update')
    setToastMsg(status === 'approved' ? 'Approved. The student has been told.' : 'Sent back. The student can see why.')
    setToast(true)
    if (selectedPdf?.id === id) setSelectedPdf((p) => (p ? { ...p, status, notes } : p))
    loadData()
  }
  const reviewPdf = async (id, status) => {
    if (status === 'rejected') {
      setRejecting(pdfs.find((p) => p.id === id) || selectedPdf || { id })
      return
    }
    try {
      await sendReview(id, status)
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
      // A document in the school's own storage comes back as a short-lived
      // URL instead of base64; older rows still carry fileData (#143 step 6).
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
      <AppLayout title={tr('PDF Preview')} subtitle={selectedPdf.filename}>
        <div className="max-w-4xl mx-auto">
          <Card className="mb-4">
            <button onClick={() => setSelectedPdf(null)} className="btn-ghost mb-4">
              <ArrowLeft className="w-4 h-4 mr-2" />{' '}{tr('Back')}
            </button>
            <div className="flex items-center gap-2 mb-4">
              {statusIcon(selectedPdf.status)}
              <span className="text-sm font-medium capitalize">{selectedPdf.status}</span>
            </div>
            <div className="bg-white rounded-xl overflow-hidden" style={{ height: '80vh' }}>
              {/* Documents in the school's own storage arrive as a short-lived
                  URL; rows still held by us arrive as base64 (#143 step 6). */}
              <SubmittedDocument doc={selectedPdf} />
            </div>
            {isSchoolAdmin && selectedPdf.status === 'pending' && (
              <div className="flex gap-2 mt-4">
                <button onClick={() => reviewPdf(selectedPdf.id, 'approved')} className="btn-primary flex-1">
                  <CheckCircle className="w-4 h-4 mr-2" />{' '}{tr('Approve')}
                </button>
                <button onClick={() => reviewPdf(selectedPdf.id, 'rejected')} className="btn-danger flex-1">
                  <XCircle className="w-4 h-4 mr-2" />{' '}{tr('Reject')}
                </button>
              </div>
            )}
            {selectedPdf.status !== 'pending' && selectedPdf.notes && (
              <p className="text-sm text-earth-500 dark:text-earth-400 mt-4"><span className="font-medium">{tr('Note to the student:')}</span> {selectedPdf.notes}</p>
            )}
          </Card>
        </div>
      {rejecting && (
        <RejectReportDialog
          report={rejecting}
          onClose={() => setRejecting(null)}
          onReject={async (reason) => { await sendReview(rejecting.id, 'rejected', reason); setRejecting(null) }}
        />
      )}
      </AppLayout>
    )
  }

  // Source of truth is the authenticated user's schoolPaymentStatus (set at
  // login/me and refreshed via loadData below) — NOT the /school/info fetch.
  // That fetch can fail (network error, rate limit) and must never fail the
  // gate open; schoolInfo is only used below for supplementary display.
  const billingTab = tab === 'setup' && setupTab === 'billing' && user?.role === 'school'
  // A free club (#506) is never locked, whatever its payment status.
  const isClub = user?.schoolPlan === 'club'
  const paymentStatus = isClub ? 'paid' : user?.schoolPaymentStatus
  if (isSchoolAdmin && paymentStatus && paymentStatus !== 'paid') {
    return (
      <AppLayout title={tr('Payment Required')} subtitle={tr('Your school\'s account is locked until payment is verified')}>
        <div className="max-w-lg mx-auto space-y-4">
          <AnnouncementBanner />
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
              {paymentStatus === 'pending' ? tr('Confirmation submitted') : paymentStatus === 'rejected' ? tr('Confirmation rejected') : tr('Payment required')}
            </h3>
            {paymentStatus === 'pending' && (
              <p className="text-sm text-earth-500 mb-3">{tr('We received your bank confirmation number. Please allow 3–5 business days for our team to verify it — you\'ll get an approval email once it\'s confirmed, and student uploads and management will unlock automatically.')}</p>
            )}
            {paymentStatus === 'rejected' && (
              <p className="text-sm text-red-500 mb-3">{schoolInfo?.paymentNotes || tr('Your confirmation could not be verified.')}{' '}{tr('Please double-check the number and resubmit.')}</p>
            )}
            {paymentStatus === 'unpaid' && (
              <p className="text-sm text-earth-500 mb-3">{tr('Please complete payment using the details below, then enter the bank confirmation number.')}</p>
            )}
            <PaymentDetails accountCode={accountCode} className="mb-3 text-left" />
            {paymentStatus !== 'pending' && user?.role === 'school' && (
              <form onSubmit={handleSubmitConfirmation} className="space-y-3">
                <label htmlFor="confirmRef" className="text-sm text-earth-500">{tr('Please enter your bank confirmation / reference number')}</label>
                <input
                  id="confirmRef"
                  type="text"
                  placeholder={tr('e.g. WIRE-12345 or check #4821')}
                  value={confirmRef}
                  onChange={(e) => setConfirmRef(e.target.value)}
                  className="input"
                />
                <button type="submit" className="btn-primary w-full" disabled={confirmBusy || !confirmRef.trim()}>
                  {confirmBusy ? tr('Submitting…') : tr('Submit confirmation')}
                </button>
              </form>
            )}
            {paymentStatus !== 'pending' && user?.role === 'school_staff' && (
              <p className="text-sm text-earth-500">{tr('Only the school\'s primary admin account can submit a payment confirmation.')}</p>
            )}
          </Card>
        </div>
        <Toast show={toast} message={toastMsg} onClose={() => setToast(false)} />
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title={isSchoolAdmin ? tr('School Dashboard') : tr('My Documents')}
      subtitle={
        <span className="flex items-center gap-2">
          {isSchoolAdmin ? tr('Review student uploads') : tr('Upload verification documents')}
          {schoolInfo?.plan === 'club' ? (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-brand-500/15 text-brand-700 dark:text-brand-300">{tr('Free club')}</span>
          ) : schoolInfo?.paymentStatus && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              schoolInfo.paymentStatus === 'paid'
                ? 'bg-emerald-500/20 text-emerald-600'
                : 'bg-amber-500/20 text-amber-600'
            }`}>
              {schoolInfo.paymentStatus === 'paid' ? tr('Paid') : tr('Unpaid')}
            </span>
          )}
        </span>
      }
      action={
        <div className="flex flex-wrap gap-2">
          {isSchoolAdmin && (
            <button data-tour="tab-students" onClick={() => { setTab('students'); setSubTab('list') }} className={`btn-sm ${tab === 'students' ? 'btn-primary' : 'btn-ghost'}`}>{tr('Students')}</button>
          )}
          <button data-tour="tab-reports" onClick={() => setTab('pdfs')} className={`btn-sm ${tab === 'pdfs' ? 'btn-primary' : 'btn-ghost'}`}>{tr('Reports')}</button>
          <button onClick={() => setTab('volunteer')} className={`btn-sm ${tab === 'volunteer' ? 'btn-primary' : 'btn-ghost'}`}>
            <Users className="w-3.5 h-3.5 mr-1" />{' '}{tr('Volunteer')}
          </button>
          {user?.role === 'school' && (
            <button data-tour="tab-staff" onClick={() => setTab('setup')} className={`btn-sm ${tab === 'setup' ? 'btn-primary' : 'btn-ghost'}`}>
              <ShieldCheck className="w-3.5 h-3.5 mr-1" />{' '}{tr('School setup')}
            </button>
          )}
          {/* Announcements are a quick action, not a section of the dashboard —
              an icon keeps the tab row down to the four places you actually work. */}
          {isSchoolAdmin && (
            <button
              data-tour="tab-chat"
              onClick={() => setTab('chat')}
              className={`btn-sm ${tab === 'chat' ? 'btn-primary' : 'btn-ghost'}`}
              title={tr('Announcements')}
              aria-label={tr('Announcements')}
            >
              <MessageSquare className="w-3.5 h-3.5" />
            </button>
          )}
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
        {isSchoolAdmin && <AnnouncementBanner />}
        {/* Billing used to render on every tab, which buried whichever tab you
            were actually on. It lives under School setup -> Billing now. */}
        {/* Each sub-tab bar sits at the top of the tab it belongs to. */}
        {tab === 'pdfs' && isSchoolAdmin && (
          <div className="flex flex-wrap gap-2 mb-4">
            <button onClick={() => setReportTab('documents')} className={`btn-sm ${reportTab === 'documents' ? 'btn-primary' : 'btn-ghost'}`}>
              <FileText className="w-3.5 h-3.5 mr-1" />{' '}{tr('Documents')}
            </button>
            <button onClick={() => setReportTab('hours')} className={`btn-sm ${reportTab === 'hours' ? 'btn-primary' : 'btn-ghost'}`}>
              <Download className="w-3.5 h-3.5 mr-1" />{' '}{tr('Hours')}
            </button>
          </div>
        )}

        {tab === 'setup' && user?.role === 'school' && (
          <div className="flex flex-wrap gap-2 mb-4">
            <button onClick={() => setSetupTab('staff')} className={`btn-sm ${setupTab === 'staff' ? 'btn-primary' : 'btn-ghost'}`}>
              <ShieldCheck className="w-3.5 h-3.5 mr-1" />{' '}{tr('Co-admins')}
            </button>
            <button onClick={() => setSetupTab('requirements')} className={`btn-sm ${setupTab === 'requirements' ? 'btn-primary' : 'btn-ghost'}`}>
              <ClipboardList className="w-3.5 h-3.5 mr-1" />{' '}{tr('Requirements')}
            </button>
            <button onClick={() => setSetupTab('sso')} className={`btn-sm ${setupTab === 'sso' ? 'btn-primary' : 'btn-ghost'}`}>
              <KeyRound className="w-3.5 h-3.5 mr-1" />{' '}{tr('Sign-in')}
            </button>
            <button onClick={() => setSetupTab('domain')} className={`btn-sm ${setupTab === 'domain' ? 'btn-primary' : 'btn-ghost'}`}>
              <Globe className="w-3.5 h-3.5 mr-1" />{' '}{tr('Domain')}
            </button>
            <button onClick={() => setSetupTab('branding')} className={`btn-sm ${setupTab === 'branding' ? 'btn-primary' : 'btn-ghost'}`}>
              <Palette className="w-3.5 h-3.5 mr-1" />{' '}{tr('Branding')}
            </button>
            <button onClick={() => setSetupTab('billing')} className={`btn-sm ${setupTab === 'billing' ? 'btn-primary' : 'btn-ghost'}`}>
              <Receipt className="w-3.5 h-3.5 mr-1" />{' '}{tr('Billing')}
            </button>
          </div>
        )}

        {billingTab && adminNotifs.length > 0 && (
          <Card>
            <h3 className="font-semibold text-sm flex items-center gap-2 mb-3"><Bell className="w-4 h-4 text-brand-600" />{' '}{tr('Payment notices')}</h3>
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
        {billingTab && schoolInfo?.paymentDueDate && (() => {
          const daysLeft = Math.ceil((new Date(schoolInfo.paymentDueDate) - new Date()) / (1000 * 60 * 60 * 24))
          if (daysLeft <= 10 && daysLeft >= 0) {
            return (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-sm">
                <Calendar className="w-4 h-4 inline mr-1" />
                {tr('Payment due in')}{' '}<strong>{daysLeft} day{daysLeft === 1 ? '' : 's'}</strong>
              </div>
            )
          }
          return null
        })()}
        {billingTab && <ReferralCard />}
        {billingTab && accountCode && (
          <Card>
            <PaymentDetails accountCode={accountCode} />
          </Card>
        )}
        {billingTab && invoices.length > 0 && (
          <Card>
            <h3 className="font-semibold text-sm flex items-center gap-2 mb-3"><Receipt className="w-4 h-4 text-brand-600" />{' '}{tr('Invoices')}</h3>
            <div className="space-y-2">
              {invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-3 text-sm p-3 rounded-xl bg-earth-500/5">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {inv.invoice_number}{' '}
                      {inv.discount_label && Number(inv.subtotal) > Number(inv.amount) && (
                        <span className="text-earth-400 font-normal line-through mr-1">${Number(inv.subtotal).toFixed(2)}</span>
                      )}
                      <span className="text-earth-500 font-normal">${Number(inv.amount).toFixed(2)}</span>
                    </p>
                    {inv.discount_label && (
                      <p className="text-xs text-brand-600 dark:text-brand-400 mt-0.5">{inv.discount_label}</p>
                    )}
                    <p className="text-xs text-earth-500 mt-0.5">
                      {inv.due_date ? `Due ${fmtDate(String(inv.due_date).slice(0, 10))}` : new Date(inv.created_at).toLocaleDateString()}
                      {inv.po_number && ` · ${poLabel(inv.po_number)}`}
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
                      {inv.status === 'paid' ? tr('Paid') : inv.status === 'void' ? tr('Void') : tr('Sent')}
                    </span>
                    <button
                      onClick={() => setPreviewInvoice(inv)}
                      className="p-1.5 text-earth-400 hover:text-earth-300"
                      title={tr('Preview invoice')}
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => generateInvoicePDF({
                        invoiceNumber: inv.invoice_number,
                        poNumber: inv.po_number,
                        entityName: schoolInfo?.name,
                        accountCode,
                        amount: inv.amount,
                        subtotal: inv.subtotal,
                        discountLabel: inv.discount_label,
                        billingPeriod: inv.billing_period,
                        description: inv.description,
                        dueDate: inv.due_date,
                        createdAt: inv.created_at,
                      })}
                      className="p-1.5 text-earth-400 hover:text-earth-300"
                      title={tr('Download PDF')}
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
              <h3 className="font-semibold mb-3 flex items-center gap-2"><MessageSquare className="w-4 h-4 text-brand-600" />{' '}{tr('Send announcement')}</h3>
              <form onSubmit={handleSendMessage} className="space-y-3">
                <textarea
                  className="input" rows={3} placeholder={tr('Write a message to all students…')}
                  value={messageText} onChange={(e) => setMessageText(e.target.value)} maxLength={2000} required
                />
                <button type="submit" className="btn-primary" disabled={sendingMsg || !messageText.trim()}>
                  {sendingMsg ? tr('Sending…') : tr('Send to all students')}
                </button>
              </form>
            </Card>
            <div className="space-y-3">
              <h3 className="font-semibold text-sm text-earth-400 uppercase tracking-wider">{tr('Previously sent')}</h3>
              {messages.length === 0 ? (
                <Card><p className="text-center text-earth-500 py-6 text-sm">{tr('No messages sent yet.')}</p></Card>
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
            <h3 className="font-semibold mb-3 flex items-center gap-2"><Upload className="w-4 h-4 text-brand-600" />{' '}{tr('Upload verification PDF')}</h3>
            {paymentStatus && paymentStatus !== 'paid' ? (
              <p className="text-sm p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400">
                {tr('Your school hasn\'t completed payment yet — submissions are paused until payment is verified.')}
              </p>
            ) : (
              <>
                <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">{tr('Upload volunteer hour verification documents for your school to review.')}</p>
                <label className="btn-primary inline-flex items-center cursor-pointer">
                  {uploading ? tr('Uploading…') : <><Upload className="w-4 h-4 mr-2" />{' '}{tr('Choose PDF')}</>}
                  <input type="file" accept=".pdf,application/pdf" className="hidden" onChange={handleFileUpload} disabled={uploading} />
                </label>
              </>
            )}
          </Card>
        )}

        {tab === 'students' && isSchoolAdmin && (
          <>
            {schoolInfo?.pin && (
              <Card className="mb-4">
                <h3 className="font-semibold mb-1 flex items-center gap-2"><Hash className="w-4 h-4 text-brand-600" />{' '}{tr('School code')}</h3>
                <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">
                  {tr('Students enter this in Settings → Join school to link themselves to you, or use the join link in the starter kit below.')}
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 overflow-x-auto rounded-lg bg-earth-100 dark:bg-earth-800 px-3 py-2 font-mono text-sm">{schoolInfo.pin}</code>
                  <button type="button" onClick={copyCode} className="btn-sm btn-ghost shrink-0" title={tr('Copy school code')}>
                    {codeCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {user?.role === 'school' && (
                  <p className="text-xs text-earth-500 dark:text-earth-400 mt-2">
                    {tr('To change it, go to')}{' '}<Link to="/settings" className="text-brand-400 hover:underline">{tr('Settings')}</Link>.
                  </p>
                )}
              </Card>
            )}

            {schoolInfo?.plan === 'club' && <ClubPlanCard count={schoolInfo.studentCount} limit={schoolInfo.studentLimit} />}

            {schoolInfo?.pin && (
              <SchoolStarterKit
                pin={schoolInfo.pin}
                schoolName={schoolInfo.name}
                onOpenSetup={user?.role === 'school' ? (t) => { setTab('setup'); setSetupTab(t) } : null}
              />
            )}

            <GroupHoursCard students={students} onDone={loadData} />

            <ChallengeCard manage />
            <SchoolVsSchoolCard />

            <LeaderboardSettingsCard canEdit={user?.role === 'school'} />

            {/* Students at another school asking to move here. Accepting is
                what actually moves them; their hours and approvals come with
                the account rather than being re-entered (#143 step 5). */}
            {transfers.length > 0 && (
              <Card className="mb-4">
                <h3 className="font-semibold mb-1 flex items-center gap-2">
                  <Users className="w-4 h-4 text-brand-600" />{' '}{tr('Transfer requests ({n})', { n: transfers.length })}
                </h3>
                <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">
                  {tr('These students asked to move to your school. Their volunteer record moves with them.')}
                </p>
                <div className="divide-y divide-white/10">
                  {transfers.map((t) => (
                    <div key={t.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{t.student_name}</div>
                        <div className="text-xs text-earth-500 dark:text-earth-400 truncate">
                          {t.student_email}{t.grade ? ` · ${tr('Grade {grade}', { grade: t.grade })}` : ''}
                          {t.from_school_name ? ` · currently at ${t.from_school_name}` : ''}
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => decideTransfer(t.id, 'accept')}
                          disabled={transferBusy === t.id}
                          className="btn-sm btn-primary"
                        >
                          <CheckCircle className="w-3.5 h-3.5 mr-1" /> {transferBusy === t.id ? tr('Working…') : tr('Accept')}
                        </button>
                        <button
                          onClick={() => decideTransfer(t.id, 'decline')}
                          disabled={transferBusy === t.id}
                          className="btn-sm btn-ghost"
                        >
                          <XCircle className="w-3.5 h-3.5 mr-1" />{' '}{tr('Decline')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <div className="flex flex-wrap gap-2 mb-4">
              <button onClick={() => setSubTab('list')} className={`btn-sm ${subTab === 'list' ? 'btn-primary' : 'btn-ghost'}`}>
                <Search className="w-3.5 h-3.5 mr-1" />{' '}{tr('Student list ({n})', { n: students.length })}
              </button>
              <button onClick={() => setSubTab('review')} className={`btn-sm ${subTab === 'review' ? 'btn-primary' : 'btn-ghost'}`}>
                <CheckCircle className="w-3.5 h-3.5 mr-1" />{' '}{tr('Hours to check')}
              </button>
              <button onClick={() => setSubTab('progress')} className={`btn-sm ${subTab === 'progress' ? 'btn-primary' : 'btn-ghost'}`}>
                <Clock className="w-3.5 h-3.5 mr-1" />{' '}{tr('Hours progress')}
              </button>
              <button onClick={() => setSubTab('graduation')} className={`btn-sm ${subTab === 'graduation' ? 'btn-primary' : 'btn-ghost'}`}>
                <GraduationCap className="w-3.5 h-3.5 mr-1" />{' '}{tr('Graduation report')}
              </button>
              <button onClick={() => setSubTab('add')} className={`btn-sm ${subTab === 'add' ? 'btn-primary' : 'btn-ghost'}`}>
                <Upload className="w-3.5 h-3.5 mr-1" />{' '}{tr('Invite student')}
              </button>
            </div>

            {subTab === 'review' && (
              <HoursReviewPanel onSetPlaces={user?.role === 'school' ? () => { setTab('setup'); setSetupTab('requirements') } : null} />
            )}

            {subTab === 'progress' && (
              <StudentProgressPanel onSetRequirement={user?.role === 'school' ? () => { setTab('setup'); setSetupTab('requirements') } : null} />
            )}

            {subTab === 'graduation' && (
              <>
                <GraduationReportPanel onSetRequirement={user?.role === 'school' ? () => { setTab('setup'); setSetupTab('requirements') } : null} />
                {/* After the report, so seniors are printed before they become Graduated (#481). */}
                {user?.role === 'school' && (
                  <GradeRolloverCard onChanged={loadData} onOpenGraduationReport={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />
                )}
              </>
            )}

            {subTab === 'add' && <InviteClassCard onDone={loadData} />}

            {subTab === 'add' && (
              <Card>
                <h3 className="font-semibold mb-1">{tr('Invite a student by email')}</h3>
                <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">{tr('They get an email and accept in their Settings. You\'ll see them in your student list once they do. Students can also join with your school code.')}</p>
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
                    setToastMsg(tr('Invite sent. They\'ll appear once they accept.'))
                    setToast(true)
                    setAddEmail('')
                    loadData()
                  } catch (e) { setAddErr(e.message) } finally { setAdding(false) }
                }} className="space-y-3">
                  <div className="flex gap-2">
                    <input type="email" className="input flex-1" placeholder="student@school.edu" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} required />
                    <button type="submit" className="btn-primary" disabled={adding}>{adding ? tr('Sending…') : tr('Invite')}</button>
                  </div>
                  {addErr && <p className="text-sm text-red-500">{addErr}</p>}
                </form>
              </Card>
            )}

            {subTab === 'list' && (
              <Card>
                <h3 className="font-semibold mb-3 flex items-center gap-2"><Search className="w-4 h-4 text-brand-600" />{' '}{tr('Students ({n})', { n: students.length })}</h3>
                {students.length === 0 ? (
                  <p className="text-sm text-earth-500">{tr('No students linked to your school yet.')}</p>
                ) : (
                  <div className="divide-y divide-white/10">
                    {students.map((s) => (
                      <div key={s.id} className="py-3">
                        <div className="flex justify-between items-center gap-2">
                          <div className="min-w-0">
                            <p className="font-medium text-sm">{s.name}</p>
                            <p className="text-xs text-earth-400">{s.email}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <select
                              className="input py-1 text-xs w-auto"
                              value={gradeKey(s.grade) || ''}
                              onChange={(e) => setStudentGrade(s.id, e.target.value)}
                              aria-label={`Grade for ${s.name}`}
                            >
                              <option value="">{!s.grade ? tr('No grade') : schoolGradeOptions.includes(gradeKey(s.grade)) ? tr('No grade') : /^(graduated|moved on)$/i.test(s.grade) ? s.grade : `${gradeLabel(s.grade)} (fix)`}</option>
                              {schoolGradeOptions.map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}
                            </select>
                            <span className="text-xs text-earth-500 hidden sm:inline">{new Date(s.created_at).toLocaleDateString()}</span>
                            <button type="button" className="btn-ghost btn-sm" onClick={() => setNotesFor(notesFor === s.id ? null : s.id)} aria-expanded={notesFor === s.id}>
                              {tr('Notes')}{noteCounts[s.id] ? ` (${noteCounts[s.id]})` : ''}
                            </button>
                          </div>
                        </div>
                        {notesFor === s.id && (
                          <StudentNotes studentId={s.id} onCount={(n) => setNoteCounts((c) => ({ ...c, [s.id]: n }))} />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}
          </>
        )}

        {tab === 'pdfs' && reportTab === 'hours' && isSchoolAdmin && (
          <Card>
            <h2 className="text-lg font-semibold mb-1">{tr('Hour reports')}</h2>
            <p className="text-sm text-slate-500 mb-4">
              {tr('Export every student\'s logged hours for a date range — for administrators, service-hour compliance, or grant reporting.')}
            </p>
            <HoursReportPanel title={tr('Volunteer hours report')} />
          </Card>
        )}
        {tab === 'pdfs' && reportTab === 'hours' && isSchoolAdmin && <ImpactReportCard scope="school" className="mt-4" />}

        {tab === 'setup' && setupTab === 'requirements' && user?.role === 'school' && (
          <RequirementsSettings scope="school" />
        )}

        {tab === 'setup' && setupTab === 'sso' && user?.role === 'school' && (
          <Card>
            <h2 className="text-lg font-semibold mb-1">{tr('Single sign-on')}</h2>
            <p className="text-sm text-slate-500 mb-4">
              {tr('Let students sign in with your school\'s Google or Microsoft account instead of a VolunTrack password.')}
            </p>
            <SsoSettings />
          </Card>
        )}

        {tab === 'setup' && setupTab === 'domain' && user?.role === 'school' && (
          <Card>
            <h2 className="text-lg font-semibold mb-1">{tr('Custom domain')}</h2>
            <p className="text-sm text-slate-500 mb-4">
              {tr('Serve VolunTrack to your students on your own web address instead of the shared one.')}
            </p>
            <TenantDomainSettings />
          </Card>
        )}

        {/* Branding only renders on a tenant hostname, so its tab sits
            directly after the Custom domain tab that makes one exist. */}
        {tab === 'setup' && setupTab === 'branding' && user?.role === 'school' && (
          <Card>
            <h2 className="text-lg font-semibold mb-1">{tr('Branding')}</h2>
            <p className="text-sm text-slate-500 mb-4">
              {tr('Put your school\'s logo and colour on the sign-in page students see at your own web address.')}
            </p>
            <TenantBrandingSettings />
          </Card>
        )}

        {tab === 'setup' && setupTab === 'staff' && user?.role === 'school' && (
          <div className="space-y-4">
            <Card>
              <h3 className="font-semibold mb-1 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-brand-600" />{' '}{tr('Add a co-admin')}</h3>
              <p className="text-sm text-earth-500 mb-3">
                {tr('Co-admins can review uploads, manage students, and send announcements — {n}/10 used.', { n: staff.length })}
              </p>
              {staff.length >= 10 ? (
                <p className="text-sm p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400">
                  {tr('You\'ve reached the limit of 10 co-admins. Remove one below to add another.')}
                </p>
              ) : (
                <form onSubmit={handleAddStaff} className="space-y-3">
                  <input type="text" className="input" placeholder={tr('Name')} value={staffForm.name} onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })} required />
                  <input type="email" className="input" placeholder={tr('Email')} value={staffForm.email} onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })} required />
                  <input type="password" className="input" placeholder={tr('Temporary password (min 8 chars)')} value={staffForm.password} onChange={(e) => setStaffForm({ ...staffForm, password: e.target.value })} minLength={8} required />
                  <button type="submit" className="btn-primary" disabled={addingStaff}>{addingStaff ? tr('Adding…') : tr('Add co-admin')}</button>
                  {staffErr && <p className="text-sm text-red-500">{staffErr}</p>}
                </form>
              )}
            </Card>

            <Card>
              <h3 className="font-semibold mb-3 flex items-center gap-2"><Users className="w-4 h-4 text-brand-600" />{' '}{tr('Co-admins ({n})', { n: staff.length })}</h3>
              {staff.length === 0 ? (
                <p className="text-sm text-earth-500">{tr('No co-admins added yet.')}</p>
              ) : (
                <div className="divide-y divide-white/10">
                  {staff.map((m) => (
                    <div key={m.id}>
                      <div className="py-3 flex justify-between items-center">
                        <div>
                          <p className="font-medium text-sm">{m.name}</p>
                          <p className="text-xs text-earth-400">{m.email}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setHandoverStaffId(handoverStaffId === m.id ? null : m.id)} className="btn-ghost btn-sm">
                            {tr('Make main admin')}
                          </button>
                          <button onClick={() => handleRemoveStaff(m.id)} className="text-red-400 hover:text-red-300 p-2" title={tr('Remove co-admin')}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      {handoverStaffId === m.id && (
                        <div className="pb-3">
                          <HandoverForm path={HANDOVER_ENDPOINTS.school()} preset={m} onCancel={() => setHandoverStaffId(null)} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <h3 className="font-semibold mb-1 flex items-center gap-2"><UserCog className="w-4 h-4 text-brand-600" />{' '}{tr('New principal?')}</h3>
              <p className="text-sm text-earth-500 mb-3">
                {tr('Hand this school’s main account to the person taking over. They get an email to accept and set their own password. You stay on as a co-admin until they remove you, and you’ll be signed out when they accept.')}
              </p>
              <HandoverForm path={HANDOVER_ENDPOINTS.school()} />
            </Card>
          </div>
        )}

        {tab === 'volunteer' && (
          <div className="space-y-4">
            <Card>
              <h3 className="font-semibold mb-3">{tr('Post a volunteer task')}</h3>
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
                  setToastMsg(tr('Task posted!')); setToast(true); loadData()
                } catch (e) { setToastMsg(e.message); setToast(true) } finally { setTaskBusy(false) }
              }} className="space-y-3">
                <input className="input" maxLength={200} placeholder={tr('Task title')} value={taskForm.title} onChange={(e) => setTaskForm({...taskForm, title: e.target.value})} required />
                <textarea className="input" rows={2} maxLength={5000} placeholder={tr('Description — what volunteers will do')} value={taskForm.description} onChange={(e) => setTaskForm({...taskForm, description: e.target.value})} required />
                <input className="input" maxLength={300} placeholder={tr('Location — where it happens')} value={taskForm.location} onChange={(e) => setTaskForm({...taskForm, location: e.target.value})} required />
                <textarea className="input" rows={2} maxLength={2000} placeholder={tr('Important info — only shown to approved volunteers (e.g. what to bring, parking, contact details)')} value={taskForm.importantInfo} onChange={(e) => setTaskForm({...taskForm, importantInfo: e.target.value})} />
                <input className="input" type="tel" maxLength={30} placeholder={tr('Phone number — shown to approved volunteers')} value={taskForm.phone} onChange={(e) => setTaskForm({...taskForm, phone: e.target.value})} required />
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="label text-xs">{tr('Date *')}</label>
                    <input type="date" className="input" value={taskForm.date} onChange={(e) => setTaskForm({...taskForm, date: e.target.value})} required />
                  </div>
                  <div>
                    <label className="label text-xs">{tr('Time *')}</label>
                    <input type="time" className="input" value={taskForm.time} onChange={(e) => setTaskForm({...taskForm, time: e.target.value})} required />
                  </div>
                  <div>
                    <label className="label text-xs">{tr('Volunteers needed *')}</label>
                    <input type="number" className="input" min={1} placeholder={tr('Slots')} value={taskForm.slotsTotal} onChange={(e) => setTaskForm({...taskForm, slotsTotal: e.target.value})} required />
                  </div>
                </div>
                <button type="submit" className="btn-primary w-full" disabled={taskBusy}>{taskBusy ? tr('Posting…') : tr('Post task')}</button>
              </form>
            </Card>

            {tasks.length === 0 ? (
              <Card><p className="text-center text-earth-500 py-8">{tr('No volunteer tasks yet.')}</p></Card>
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
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {fmtDate(t.date)}{t.time ? ` · ${t.time}` : ''}</span>
                        <span>{filled}/{total} filled</span>
                      </div>
                      {approved && t.phone && (
                        <p className="text-xs text-emerald-400 mt-1 font-medium">{tr('Contact:')}{' '}{t.phone}</p>
                      )}
                      {approved && t.important_info && (
                        <div className="mt-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                          <p className="text-xs font-semibold text-emerald-300 mb-0.5">{tr('Important info')}</p>
                          <p className="text-xs text-emerald-200/80">{t.important_info}</p>
                        </div>
                      )}
                      {t.my_signup_status === 'pending' && (
                        <p className="text-xs text-amber-400 mt-1">{tr('Awaiting organizer approval')}</p>
                      )}
                      {t.my_signup_status === 'rejected' && (
                        <p className="text-xs text-red-400 mt-1">{tr('Signup rejected')}</p>
                      )}
                    </div>
                    <div className="shrink-0">
                      {t.my_signup_status === 'approved' ? (
                        <span className="text-xs text-emerald-400 font-medium">{tr('Approved')}</span>
                      ) : t.my_signup_status === 'pending' ? (
                        <span className="text-xs text-amber-400 font-medium">{tr('Pending')}</span>
                      ) : t.my_signup_status === 'rejected' ? (
                        <span className="text-xs text-red-400 font-medium">{tr('Rejected')}</span>
                      ) : full ? (
                        <span className="text-xs text-red-400 font-medium">{tr('Full')}</span>
                      ) : (
                        <button onClick={async () => {
                          // Minimum age (#426): confirmed by the student, as on Opportunities.
                          if (t.min_age != null && !window.confirm(tr('This task is for volunteers {n} or older. Are you {n} or older?', { n: t.min_age }))) return
                          try {
                            const token = localStorage.getItem('voluntrack:auth_token')
                            const res = await fetch(`${apiUrl}/school/public-tasks/${t.id}/signup`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                              body: JSON.stringify(t.min_age != null ? { ageConfirmed: true } : {}),
                            })
                            if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
                            setToastMsg(tr('Signed up — awaiting organizer approval')); setToast(true); loadData()
                          } catch (e) { setToastMsg(e.message); setToast(true) }
                        }} className="btn-primary text-sm">{tr('Sign up')}</button>
                      )}
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}

        {tab === 'pdfs' && reportTab === 'documents' && (
        <div className="space-y-3">
          {loading ? (
            <p className="text-center text-earth-400 py-8">{tr('Loading…')}</p>
          ) : pdfs.length === 0 ? (
            <Card><p className="text-center text-earth-500 py-8">{tr('No PDFs yet.')}</p></Card>
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
                    {pdf.status === 'rejected' && pdf.notes && (
                      <p className="text-xs text-red-500 dark:text-red-400 mt-0.5 line-clamp-2">{tr('Sent back:')}{' '}{pdf.notes}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {statusIcon(pdf.status)}
                  <button onClick={() => viewPdf(pdf.id)} className="btn-ghost text-sm p-2">
                    <FileText className="w-4 h-4" />
                  </button>
                  {isSchoolAdmin && pdf.status === 'pending' && (
                    <>
                      <button onClick={() => reviewPdf(pdf.id, 'approved')} className="text-emerald-400 hover:text-emerald-300 p-1" title={tr('Approve')}>
                        <CheckCircle className="w-5 h-5" />
                      </button>
                      <button onClick={() => reviewPdf(pdf.id, 'rejected')} className="text-red-400 hover:text-red-300 p-1" title={tr('Reject')}>
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

      {rejecting && (
        <RejectReportDialog
          report={rejecting}
          onClose={() => setRejecting(null)}
          onReject={async (reason) => { await sendReview(rejecting.id, 'rejected', reason); setRejecting(null) }}
        />
      )}
      <Toast open={toast} onClose={() => setToast(false)}>{toastMsg}</Toast>

      {previewInvoice && (
        <PdfPreview
          title={`Invoice ${previewInvoice.invoice_number}`}
          filename={`${previewInvoice.invoice_number}.pdf`}
          getBlob={() => generateInvoicePDF({
            invoiceNumber: previewInvoice.invoice_number,
            poNumber: previewInvoice.po_number,
            entityName: schoolInfo?.name,
            accountCode,
            amount: previewInvoice.amount,
            subtotal: previewInvoice.subtotal,
            discountLabel: previewInvoice.discount_label,
            billingPeriod: previewInvoice.billing_period,
            description: previewInvoice.description,
            dueDate: previewInvoice.due_date,
            createdAt: previewInvoice.created_at,
            returnBlob: true,
          })}
          onClose={() => setPreviewInvoice(null)}
        />
      )}
    </AppLayout>
  )
}
