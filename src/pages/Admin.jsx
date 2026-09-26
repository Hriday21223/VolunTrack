import { useMemo, useState, useEffect, useCallback } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Trash2, Mail, MessageSquare, ShieldCheck, XCircle, Sparkles, School, Users, CreditCard, Download, Calendar, Bell, Star, Heart, AlertTriangle, Wrench, CheckCircle2, UserPlus, RefreshCw, Copy, Check, Building2, DollarSign, Receipt, History, Ban, Terminal, Search, Tag, Gift, Send, Compass, ExternalLink } from 'lucide-react'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import SpotlightTour from '@/components/SpotlightTour.jsx'
import { useAuth } from '@/hooks/useAuth.jsx'
import { getIncidents, createIncident, resolveIncident, deleteIncident, getHealth, HEALTH_UNKNOWN } from '@/lib/status.js'
import { generateInvoicePDF } from '@/lib/export.js'
import { NO_PROMO, promoAppliesTo, applyPromoAmount, promoLabel, promoRemaining, PROMO_AUDIENCES, PROMO_PERIODS, PROMO_VISIBILITIES } from '@promo'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const RESOLVED_API_URL = apiUrl.startsWith('http') ? apiUrl : `${window.location.origin}${apiUrl}`

const ADMIN_TOUR_STEPS = [
  { selector: '[data-tour="admin-inbox"]', title: 'Inbox', description: 'Contact-form messages land here, threaded by conversation, with AI-drafted replies you can send or copy.' },
  { selector: '[data-tour="admin-schools"]', title: 'Schools', description: 'Verify payments, leave internal-only notes, and manage every school on the platform.' },
  { selector: '[data-tour="admin-incidents"]', title: 'Incidents', description: 'Real backend/database health checks show up here — resolve them, or log one yourself.' },
]

// Deterministic-but-varied invoice description, seeded by entity name so the
// same school doesn't always get the exact same wording (mirrors generateDraft above).
function generateInvoiceDescription({ entityName, billingPeriod }) {
  const now = new Date()
  const year = now.getFullYear()
  const semester = now.getMonth() >= 6 ? `fall ${year}` : `spring ${year}`
  const periodLabel = billingPeriod === 'yearly' ? 'annual' : billingPeriod === 'one_time' ? 'one-time' : 'monthly'
  const name = entityName || 'this account'

  const seed = String(entityName ?? '').split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
  const templates = [
    `VolunTrack ${periodLabel} subscription — ${semester} semester for ${name}.`,
    `${name}'s VolunTrack ${periodLabel} plan, covering the ${semester} semester.`,
    `VolunTrack subscription (${periodLabel}) for ${name} — ${semester} semester.`,
  ]
  return templates[seed % templates.length]
}

function generateDraft(contact) {
  const subject = contact.subject || 'General question'
  const name = contact.name || 'there'
  // Deterministic-but-varied pick, seeded by the thread id/timestamp so the
  // same contact doesn't always get the exact same opener.
  const seed = String(contact.thread_id ?? contact.sentAt ?? '')
    .split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0)

  const intros = [
    `Hi ${name}, thanks for writing in!`,
    `Hey ${name}, good to hear from you.`,
    `Hi ${name} — appreciate you reaching out.`,
  ]
  const intro = intros[seed % intros.length]

  const closings = [
    '\n\nBest,\nVolunTrack',
    '\n\nTalk soon,\nVolunTrack',
    '\n\nThanks again,\nVolunTrack',
  ]
  const closing = closings[seed % closings.length]

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
      `Great timing — school accounts are live on VolunTrack today, not just on a roadmap. Once your school is set up, you get:\n- A dashboard to review and verify student volunteer hours (with PDF proof uploads)\n- A school code students use to link their accounts\n- Co-admin accounts if you've got more than one staff member managing it\n\nPricing is based on your school's size, so once I know a bit more (student count, semester vs. year-round use) I'll send over a quote alongside the invite. Rather than asking you to fill out a signup form yourself, I'll go ahead and send your school an invite email with a link to finish setup — you'll just need to set a password and pick a school code. Expect that shortly; let me know if you'd like me to use a different contact email than this one.\n\nHappy to answer any questions in the meantime.`
    ),
  }

  const body = bodies[subject] || (
    `VolunTrack is a free, privacy-first volunteer hour tracker for students, clubs, and now schools too — logging, goals, badges, printable reports, and school dashboards all in one place. Take a look: https://github.com/Hriday21223/VolunTrack\n\nLet me know if you have any other questions!`
  )

  return intro + '\n\n' + body + closing
}

const ADMIN_TABS = ['inbox', 'reviews', 'schools', 'invites', 'organizations', 'incidents', 'settings', 'api', 'blueprint']

// Living reference pages for how this app is actually built, kept outside the
// repo so they can be updated without a deploy. Admin-only: they describe every
// role's powers and the server's gates, which is not public documentation.
const BLUEPRINT_DOCS = [
  {
    title: 'The VolunTrack Field Guide',
    url: 'https://claude.ai/artifact/6kfF7uqPM7rSG9maQWYKyh',
    summary: 'Every role and feature, read from the source: what each of the seven account types can do, billing and pricing, supervisor verification, public tasks, auth, data custody, and the quirks worth knowing.',
  },
  {
    title: 'App Pipeline',
    url: 'https://claude.ai/artifact/Vgp53Gh2VBkYgQf1SMVAEq',
    summary: 'How a click becomes a stored hour: the localStorage lane, the Postgres lane, the direct-to-bucket proof path, the middleware chain, and all 18 mounted routers with their access gates.',
  },
]

const METHOD_COLORS = {
  GET: 'text-emerald-600 dark:text-emerald-400',
  POST: 'text-sky-600 dark:text-sky-400',
  PATCH: 'text-amber-600 dark:text-amber-400',
  PUT: 'text-amber-600 dark:text-amber-400',
  DELETE: 'text-red-600 dark:text-red-400',
}

function ApiHealthPill({ label, ok, detail }) {
  return (
    <div className={`rounded-lg border px-3 py-2 flex items-center gap-2 ${ok ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10' : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10'}`}>
      {ok ? <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" /> : <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
      <div className="min-w-0">
        <p className="text-xs font-semibold text-earth-800 dark:text-earth-100">{label}</p>
        <p className="text-[11px] text-earth-500 dark:text-earth-400">{detail}</p>
      </div>
    </div>
  )
}

export default function Admin() {
  const nav = useNavigate()
  const { tab: tabParam } = useParams()
  const { user } = useAuth()
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [threads, setThreads] = useState([])
  const [loadingThreads, setLoadingThreads] = useState(false)
  const [reviews, setReviews] = useState([])
  const [loadingReviews, setLoadingReviews] = useState(false)
  const [schedulingId, setSchedulingId] = useState(null)
  const [scheduleDraft, setScheduleDraft] = useState({ publishAt: '', removeAfterDays: 30 })
  const [drafts, setDrafts] = useState({})
  const [expandedThreadId, setExpandedThreadId] = useState(null)
  const [threadMessages, setThreadMessages] = useState({})
  const [copiedIdx, setCopiedIdx] = useState(null)
  const [sendingIds, setSendingIds] = useState(() => new Set())
  const [sendErrors, setSendErrors] = useState({})
  const tab = ADMIN_TABS.includes(tabParam) ? tabParam : 'inbox'
  const setTab = (t) => nav(`/admin/${t}`)
  const [schools, setSchools] = useState([])
  const [loadingSchools, setLoadingSchools] = useState(false)
  const [payModal, setPayModal] = useState(null) // school id
  const [payNotes, setPayNotes] = useState('')
  const [noteModal, setNoteModal] = useState(null) // school id
  const [noteDraft, setNoteDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [priceModal, setPriceModal] = useState(null) // school id
  const [priceAmountDraft, setPriceAmountDraft] = useState('')
  const [pricePeriodDraft, setPricePeriodDraft] = useState('monthly')
  const [savingPrice, setSavingPrice] = useState(false)
  const [toast, setToast] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [dueDateModal, setDueDateModal] = useState(null) // school id
  const [dueDateDraft, setDueDateDraft] = useState('')
  const [savingDueDate, setSavingDueDate] = useState(false)
  const [notifyMsg, setNotifyMsg] = useState('')
  const [notifyAmount, setNotifyAmount] = useState('')
  const [notifyBillingPeriod, setNotifyBillingPeriod] = useState('monthly')
  const [showNotifyModal, setShowNotifyModal] = useState(false)
  const [orgPriceModal, setOrgPriceModal] = useState(null) // org id
  const [orgPriceAmountDraft, setOrgPriceAmountDraft] = useState('')
  const [orgPricePeriodDraft, setOrgPricePeriodDraft] = useState('monthly')
  const [savingOrgPrice, setSavingOrgPrice] = useState(false)
  const [orgDueDateModal, setOrgDueDateModal] = useState(null) // org id
  const [orgDueDateDraft, setOrgDueDateDraft] = useState('')
  const [savingOrgDueDate, setSavingOrgDueDate] = useState(false)
  const [orgNoteModal, setOrgNoteModal] = useState(null) // org id
  const [orgNoteDraft, setOrgNoteDraft] = useState('')
  const [savingOrgNote, setSavingOrgNote] = useState(false)
  const [orgPayModal, setOrgPayModal] = useState(null) // org id
  const [orgPayNotes, setOrgPayNotes] = useState('')
  const [notifySchoolId, setNotifySchoolId] = useState(null) // null = all schools, string = specific school
  const [notifyOrgId, setNotifyOrgId] = useState(null) // string = specific organization (org notify has no "all" broadcast)
  const [invoiceModal, setInvoiceModal] = useState(null) // { entityType, entityId, entityName }
  const [invoiceAmountDraft, setInvoiceAmountDraft] = useState('')
  const [invoiceBillingPeriodDraft, setInvoiceBillingPeriodDraft] = useState('monthly')
  const [invoiceDescriptionDraft, setInvoiceDescriptionDraft] = useState('')
  const [invoiceDueDateDraft, setInvoiceDueDateDraft] = useState('')
  const [sendingInvoice, setSendingInvoice] = useState(false)
  const [historyModal, setHistoryModal] = useState(null) // { entityType, entityId, entityName }
  const [historyEvents, setHistoryEvents] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [invoiceActionId, setInvoiceActionId] = useState(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [officeHoursDraft, setOfficeHoursDraft] = useState({ days: '', hours: '', note: '' })
  const [paymentDraft, setPaymentDraft] = useState({ bankName: '', accountName: '', accountNumber: '', routingNumber: '', swift: '', reference: '', notes: '' })
  const [savingPaymentInfo, setSavingPaymentInfo] = useState(false)
  const [loadingOfficeHours, setLoadingOfficeHours] = useState(false)
  const [savingOfficeHours, setSavingOfficeHours] = useState(false)
  const [promoDraft, setPromoDraft] = useState({ ...NO_PROMO })
  const [loadingPromo, setLoadingPromo] = useState(false)
  const [savingPromo, setSavingPromo] = useState(false)
  const [promoUsed, setPromoUsed] = useState(0)
  const [blueprints, setBlueprints] = useState(BLUEPRINT_DOCS)
  const [blueprintsEditable, setBlueprintsEditable] = useState(false)
  const [loadingBlueprints, setLoadingBlueprints] = useState(false)
  const [savingBlueprints, setSavingBlueprints] = useState(false)
  const [blueprintDraft, setBlueprintDraft] = useState({ title: '', url: '', summary: '' })
  const [invitePreview, setInvitePreview] = useState(null) // dry-run result, doubles as the confirm dialog
  const [sendingInvites, setSendingInvites] = useState(false)
  // The offer as it applies to the entity in the open invoice modal, straight
  // from the server — { offer, isFirstInvoice, eligible, reason }.
  const [invoicePromo, setInvoicePromo] = useState(null)
  const [applyPromoToInvoice, setApplyPromoToInvoice] = useState(false)
  // A referral credit this customer has earned, chosen instead of the join
  // offer — the server rejects both on one invoice.
  const [selectedCreditId, setSelectedCreditId] = useState('')
  const [invites, setInvites] = useState([])
  const [loadingInvites, setLoadingInvites] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteKind, setInviteKind] = useState('school') // 'school' | 'organization'
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [sendingInvite, setSendingInvite] = useState(false)
  const [organizations, setOrganizations] = useState([])
  const [loadingOrganizations, setLoadingOrganizations] = useState(false)
  const [incidents, setIncidents] = useState([])
  const [loadingIncidents, setLoadingIncidents] = useState(false)
  const [resolvingId, setResolvingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [newIncident, setNewIncident] = useState({ service: '', detail: '', issueUrl: '' })
  const [loggingIncident, setLoggingIncident] = useState(false)

  const loadIncidents = useCallback(async () => {
    setLoadingIncidents(true)
    try {
      // null means the fetch told us nothing (rate-limited, offline) — leave
      // the list on screen rather than blanking it to "no incidents".
      const result = await getIncidents()
      if (result) setIncidents(result)
    } finally { setLoadingIncidents(false) }
  }, [])

  const [apiHealth, setApiHealth] = useState(null)
  const [apiRoutes, setApiRoutes] = useState([])
  const [loadingApiInfo, setLoadingApiInfo] = useState(false)
  const [apiCopied, setApiCopied] = useState('')

  const loadApiInfo = useCallback(async () => {
    setLoadingApiInfo(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const [health, routesRes] = await Promise.all([
        getHealth(),
        token
          ? fetch(`${apiUrl}/status/routes`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
          : Promise.resolve(null),
      ])
      // HEALTH_UNKNOWN means the backend answered without health data; keep
      // the last real reading if we have one, and never read it as "down".
      setApiHealth((prev) => (health === HEALTH_UNKNOWN && prev && prev !== HEALTH_UNKNOWN ? prev : health))
      setApiRoutes(routesRes?.routes || [])
    } finally {
      setLoadingApiInfo(false)
    }
  }, [])

  useEffect(() => { loadIncidents() }, [loadIncidents])

  const submitIncident = async () => {
    if (!newIncident.service.trim()) return
    setLoggingIncident(true)
    try {
      await createIncident(newIncident)
      setNewIncident({ service: '', detail: '', issueUrl: '' })
      await loadIncidents()
      setToastMessage('Incident logged'); setToast(true)
    } catch (error) { setToastMessage(error.message || 'Failed to log incident'); setToast(true) } finally { setLoggingIncident(false) }
  }

  const resolveOne = async (id) => {
    setResolvingId(id)
    try {
      await resolveIncident(id)
      await loadIncidents()
    } catch (error) { setToastMessage(error.message || 'Failed to resolve incident'); setToast(true) } finally { setResolvingId(null) }
  }

  // Two clicks on purpose: deleting is the only way to unpublish an incident
  // from the public /status page, and there's no undo.
  const deleteOne = async (id) => {
    if (confirmDeleteId !== id) { setConfirmDeleteId(id); return }
    setDeletingId(id)
    try {
      await deleteIncident(id)
      setConfirmDeleteId(null)
      await loadIncidents()
      setToastMessage('Incident deleted'); setToast(true)
    } catch (error) { setToastMessage(error.message || 'Failed to delete incident'); setToast(true) } finally { setDeletingId(null) }
  }

  useEffect(() => {
    setIsAuthorized(user?.role === 'admin')
  }, [user?.role])

  useEffect(() => {
    if (!ADMIN_TABS.includes(tabParam)) nav('/admin/inbox', { replace: true })
  }, [tabParam, nav])

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

  // Kind-to-endpoint-base map — school and organization invites are separate
  // backend resources (school_invites vs organization_invites tables) but
  // share this one tab in the UI, tagged by `kind` after merging.
  const inviteBase = (kind) => (kind === 'organization' ? `${apiUrl}/organization/admin` : `${apiUrl}/school/admin`)

  const loadInvites = useCallback(async () => {
    setLoadingInvites(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      if (!token) return
      const [schoolRes, orgRes] = await Promise.all([
        fetch(`${apiUrl}/school/admin/invites`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiUrl}/organization/admin/invites`, { headers: { Authorization: `Bearer ${token}` } }),
      ])
      const schoolData = schoolRes.ok ? await schoolRes.json() : { invites: [] }
      const orgData = orgRes.ok ? await orgRes.json() : { invites: [] }
      const merged = [
        ...(schoolData.invites || []).map((inv) => ({ ...inv, kind: 'school' })),
        ...(orgData.invites || []).map((inv) => ({ ...inv, kind: 'organization' })),
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      setInvites(merged)
    } catch {} finally {
      setLoadingInvites(false)
    }
  }, [])

  const sendInvite = async () => {
    if (!inviteName.trim() || !inviteEmail.trim()) return
    setSendingInvite(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${inviteBase(inviteKind)}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: inviteName.trim(), email: inviteEmail.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setShowInviteModal(false); setInviteName(''); setInviteEmail('')
      loadInvites()
      setToastMessage(data.emailSent === false ? 'Invite created, but the email failed to send — check email settings' : 'Invite sent')
      setToast(true)
    } catch (e) { setToastMessage(e.message || 'Failed to send invite'); setToast(true) } finally { setSendingInvite(false) }
  }

  const resendInvite = async (id, kind) => {
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${inviteBase(kind)}/invite/${id}/resend`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      loadInvites()
      setToastMessage(data.emailSent === false ? 'Invite updated, but the email failed to send — check email settings' : 'Invite resent')
      setToast(true)
    } catch (e) { setToastMessage(e.message || 'Failed to resend invite'); setToast(true) }
  }

  const deleteInvite = async (id, kind) => {
    if (!confirm('Delete this invite?')) return
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${inviteBase(kind)}/invite/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed')
      loadInvites()
    } catch {}
  }

  const loadOrganizations = useCallback(async () => {
    setLoadingOrganizations(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      if (!token) return
      const res = await fetch(`${apiUrl}/school/admin/organizations`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const data = await res.json()
      setOrganizations(data.organizations || [])
    } catch {} finally {
      setLoadingOrganizations(false)
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
      const data = await res.json()
      if (!res.ok) throw new Error('Failed')
      loadSchools()
      setToastMessage(
        data.unchanged ? 'Payment was already rejected with that reason'
          : data.emailSent === false ? 'Payment rejected, but the school could not be emailed — check email settings'
          : 'Payment rejected — school notified',
      )
      setToast(true)
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

  const savePrice = async (id) => {
    setSavingPrice(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/admin/${id}/price`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ amount: priceAmountDraft.trim(), period: pricePeriodDraft }),
      })
      if (!res.ok) throw new Error('Failed')
      setPriceModal(null); setPriceAmountDraft(''); setPricePeriodDraft('monthly'); loadSchools()
      setToastMessage('Price saved'); setToast(true)
    } catch { setToastMessage('Failed to save price'); setToast(true) } finally { setSavingPrice(false) }
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
    const header = 'Name,Account ID,Code,Contact Email,Payment Status,Payment Notes,Students,Joined\n'
    const rows = schools.map((s) =>
      `"${s.name}","${s.account_code || ''}","${s.pin}","${s.contact_email || ''}","${s.payment_status}","${s.payment_notes || ''}",${s.student_count},"${new Date(s.created_at).toLocaleDateString()}"`
    ).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'schools.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const saveDueDate = async (id, value = dueDateDraft) => {
    setSavingDueDate(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/admin/${id}/due-date`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dueDate: value }),
      })
      if (!res.ok) throw new Error('Failed')
      setDueDateModal(null); setDueDateDraft(''); loadSchools()
      setToastMessage(value ? 'Due date saved' : 'Due date cleared'); setToast(true)
    } catch { setToastMessage('Failed to save due date'); setToast(true) } finally { setSavingDueDate(false) }
  }

  const saveOrgPrice = async (id) => {
    setSavingOrgPrice(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/organization/admin/${id}/price`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ amount: orgPriceAmountDraft.trim(), period: orgPricePeriodDraft }),
      })
      if (!res.ok) throw new Error('Failed')
      setOrgPriceModal(null); setOrgPriceAmountDraft(''); setOrgPricePeriodDraft('monthly'); loadOrganizations()
      setToastMessage('Price saved'); setToast(true)
    } catch { setToastMessage('Failed to save price'); setToast(true) } finally { setSavingOrgPrice(false) }
  }

  const saveOrgDueDate = async (id, value = orgDueDateDraft) => {
    setSavingOrgDueDate(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/organization/admin/${id}/due-date`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dueDate: value }),
      })
      if (!res.ok) throw new Error('Failed')
      setOrgDueDateModal(null); setOrgDueDateDraft(''); loadOrganizations()
      setToastMessage(value ? 'Due date saved' : 'Due date cleared'); setToast(true)
    } catch { setToastMessage('Failed to save due date'); setToast(true) } finally { setSavingOrgDueDate(false) }
  }

  const sendNotify = async () => {
    if (!notifyMsg.trim()) return
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const url = notifyOrgId
        ? `${apiUrl}/organization/admin/notify-org/${notifyOrgId}`
        : notifySchoolId
        ? `${apiUrl}/school/admin/notify-school/${notifySchoolId}`
        : `${apiUrl}/school/admin/notify-payment`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: notifyMsg.trim(),
          amount: notifyAmount.trim() || undefined,
          billingPeriod: notifyAmount.trim() ? notifyBillingPeriod : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error('Failed')
      setShowNotifyModal(false); setNotifyMsg(''); setNotifyAmount(''); setNotifyBillingPeriod('monthly'); setNotifySchoolId(null); setNotifyOrgId(null)
      if ('emailsTotal' in data) {
        setToastMessage(data.emailsSent === data.emailsTotal ? `Notification sent to all ${data.emailsTotal} schools` : `Notification sent to ${data.emailsSent}/${data.emailsTotal} schools — some emails failed`)
      } else if (data.hasContactEmail === false) {
        setToastMessage('Notification saved — no contact email on file, nothing was emailed')
      } else if (data.emailSent === false) {
        setToastMessage('Notification saved, but the email failed to send — check email settings')
      } else {
        setToastMessage('Notification sent')
      }
      setToast(true)
    } catch { setToastMessage('Failed to send notification'); setToast(true) }
  }

  const saveOrgNote = async (id) => {
    setSavingOrgNote(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/organization/admin/${id}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ note: orgNoteDraft }),
      })
      if (!res.ok) throw new Error('Failed')
      setOrgNoteModal(null); setOrgNoteDraft(''); loadOrganizations()
      setToastMessage('Internal note saved'); setToast(true)
    } catch { setToastMessage('Failed to save note'); setToast(true) } finally { setSavingOrgNote(false) }
  }

  const updateOrgPayment = async (id, status, notes) => {
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/organization/admin/${id}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status, notes }),
      })
      if (!res.ok) throw new Error('Failed')
      if (status === 'paid') { setOrgPayModal(null); setOrgPayNotes('') }
      loadOrganizations()
      setToastMessage(`Organization marked as ${status}`); setToast(true)
    } catch { setToastMessage('Failed to update payment'); setToast(true) }
  }

  const deleteOrganization = async (id, name) => {
    if (!confirm(`Delete "${name}"? Its schools will be unlinked, not deleted.`)) return
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/organization/admin/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed')
      loadOrganizations()
    } catch {}
  }

  // The live eligibility check for the entity whose invoice modal is open, with
  // the billing period the admin currently has selected folded in — the server
  // deliberately leaves that out, since the admin can still change it here.
  const invoicePromoCheck = useMemo(() => {
    if (!invoicePromo?.offer) return { eligible: false, reason: invoicePromo?.reason || null }
    if (!invoicePromo.eligible) return { eligible: false, reason: invoicePromo.reason }
    return promoAppliesTo(invoicePromo.offer, {
      entityType: invoiceModal?.entityType,
      billingPeriod: invoiceBillingPeriodDraft,
      isFirstInvoice: invoicePromo.isFirstInvoice,
      redemptionsUsed: invoicePromo.redemptionsUsed,
    })
  }, [invoicePromo, invoiceModal, invoiceBillingPeriodDraft])

  // What the customer will actually be billed. Mirrors what the server
  // recomputes on submit, via the same @promo module.
  const invoiceTotals = useMemo(() => {
    const base = Number(invoiceAmountDraft)
    if (!Number.isFinite(base) || base <= 0) return null
    const credit = (invoicePromo?.credits || []).find((c) => c.id === selectedCreditId)
    if (credit) return applyPromoAmount(base, Number(credit.percent_off))
    if (!applyPromoToInvoice || !invoicePromoCheck.eligible) return null
    return applyPromoAmount(base, invoicePromo.offer.percentOff)
  }, [invoiceAmountDraft, applyPromoToInvoice, invoicePromoCheck, invoicePromo, selectedCreditId])

  const openInvoiceModal = (entityType, entity) => {
    const numericAmount = (entity.price_amount || '').replace(/[^0-9.]/g, '')
    setInvoiceModal({ entityType, entityId: entity.id, entityName: entity.name, accountCode: entity.account_code })
    setInvoiceAmountDraft(numericAmount)
    setInvoiceBillingPeriodDraft(entity.price_period || 'monthly')
    setInvoiceDescriptionDraft('')
    setInvoiceDueDateDraft(entity.payment_due_date ? String(entity.payment_due_date).slice(0, 10) : '')
    setInvoicePromo(null)
    setApplyPromoToInvoice(false)
    setSelectedCreditId('')
    ;(async () => {
      try {
        const token = localStorage.getItem('voluntrack:auth_token')
        const res = await fetch(`${apiUrl}/invoices/admin/${entityType}/${entity.id}/promo`, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) return
        const data = await res.json()
        setInvoicePromo(data)
        // Pre-tick it: if an offer is running and this account qualifies, the
        // admin almost certainly means to honour what the signup page promised.
        if (data.eligible) setApplyPromoToInvoice(true)
        // A customer with a credit waiting almost always means to spend it,
        // and it can't be combined with the join offer anyway.
        if (data.credits?.length) { setSelectedCreditId(data.credits[0].id); setApplyPromoToInvoice(false) }
      } catch {}
    })()
  }

  const sendInvoice = async () => {
    if (!invoiceModal || !invoiceAmountDraft.trim() || !invoiceDescriptionDraft.trim()) return
    setSendingInvoice(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/invoices/admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          entityType: invoiceModal.entityType,
          entityId: invoiceModal.entityId,
          amount: invoiceAmountDraft.trim(),
          billingPeriod: invoiceBillingPeriodDraft,
          description: invoiceDescriptionDraft.trim() || undefined,
          dueDate: invoiceDueDateDraft || undefined,
          applyPromo: !selectedCreditId && applyPromoToInvoice && invoicePromoCheck.eligible,
          referralCreditId: selectedCreditId || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error('Failed')
      setInvoiceModal(null); setInvoiceAmountDraft(''); setInvoiceDescriptionDraft(''); setInvoiceDueDateDraft('')
      setInvoicePromo(null); setApplyPromoToInvoice(false); setSelectedCreditId('')
      if (data.invoice?.hasContactEmail === false) {
        setToastMessage('Invoice created — no contact email on file, nothing was emailed')
      } else if (data.invoice?.emailSent === false) {
        setToastMessage('Invoice created, but the email failed to send — check email settings')
      } else {
        setToastMessage(data.invoice?.discountLabel ? `Invoice sent — $${Number(data.invoice.amount).toFixed(2)} after ${data.invoice.discountPercent}% off` : 'Invoice sent')
      }
      setToast(true)
    } catch { setToastMessage('Failed to send invoice'); setToast(true) } finally { setSendingInvoice(false) }
  }

  const openHistory = async (entityType, entity) => {
    setHistoryModal({ entityType, entityId: entity.id, entityName: entity.name, accountCode: entity.account_code })
    setLoadingHistory(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/invoices/admin/${entityType}/${entity.id}/history`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = res.ok ? await res.json() : { events: [] }
      setHistoryEvents(data.events || [])
    } catch { setHistoryEvents([]) } finally { setLoadingHistory(false) }
  }

  const resolveInvoice = async (invoiceId, status) => {
    setInvoiceActionId(invoiceId)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/invoices/admin/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error('Failed')
      if (historyModal) await openHistory(historyModal.entityType, { id: historyModal.entityId, name: historyModal.entityName, account_code: historyModal.accountCode })
      if (historyModal?.entityType === 'school') loadSchools(); else loadOrganizations()
      setToastMessage(status === 'paid' ? 'Invoice marked paid' : 'Invoice voided'); setToast(true)
    } catch { setToastMessage('Failed to update invoice'); setToast(true) } finally { setInvoiceActionId(null) }
  }

  const downloadInvoicePdf = (event) => {
    generateInvoicePDF({
      invoiceNumber: event.invoice_number,
      entityName: historyModal?.entityName,
      accountCode: historyModal?.accountCode,
      amount: event.amount,
      subtotal: event.subtotal,
      discountLabel: event.discount_label,
      billingPeriod: event.billing_period,
      description: event.description,
      dueDate: event.due_date,
      createdAt: event.created_at,
    })
  }

  const loadPaymentInstructions = useCallback(async () => {
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/settings/payment-instructions`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) {
        const data = await res.json()
        setPaymentDraft((prev) => ({ ...prev, ...data }))
      }
    } catch {}
  }, [])

  const savePaymentInstructions = async () => {
    setSavingPaymentInfo(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/settings/payment-instructions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(paymentDraft),
      })
      if (!res.ok) throw new Error('Failed')
      setToastMessage('Payment instructions updated'); setToast(true)
    } catch { setToastMessage('Failed to update payment instructions'); setToast(true) } finally { setSavingPaymentInfo(false) }
  }

  const loadPromo = useCallback(async () => {
    setLoadingPromo(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/settings/promo/admin`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) {
        const data = await res.json()
        setPromoDraft({ ...NO_PROMO, ...(data.offer || {}) })
        setPromoUsed(data.redemptionsUsed || 0)
      }
    } catch {} finally { setLoadingPromo(false) }
  }, [])

  const savePromo = async () => {
    setSavingPromo(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/settings/promo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...promoDraft,
          endsAt: promoDraft.endsAt || '',
          maxRedemptions: promoDraft.maxRedemptions === '' ? null : promoDraft.maxRedemptions,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setPromoDraft({ ...NO_PROMO, ...data.offer })
      setPromoUsed(data.redemptionsUsed || 0)
      setToastMessage(data.offer.enabled ? 'Offer is live' : 'Offer saved (not running)')
      setToast(true)
    } catch (e) { setToastMessage(e.message || 'Failed to save the offer'); setToast(true) } finally { setSavingPromo(false) }
  }

  // Two steps on purpose: this fans out real email to every customer, so the
  // admin sees exactly who would be written to before anything is sent.
  const previewInvites = async (force = false) => {
    setSendingInvites(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/referral/admin/send-invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dryRun: true, force }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setInvitePreview({ ...data, force })
    } catch (e) { setToastMessage(e.message || 'Could not build the invite list'); setToast(true) } finally { setSendingInvites(false) }
  }

  const sendInvites = async () => {
    setSendingInvites(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/referral/admin/send-invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ force: invitePreview?.force === true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setInvitePreview(null)
      const failed = data.failed?.length ? `, ${data.failed.length} failed` : ''
      setToastMessage(`Sent ${data.sent} invite${data.sent === 1 ? '' : 's'}${data.skipped ? `, ${data.skipped} skipped` : ''}${failed}`)
      setToast(true)
    } catch (e) { setToastMessage(e.message || 'Could not send the invites'); setToast(true) } finally { setSendingInvites(false) }
  }

  const loadBlueprints = useCallback(async () => {
    setLoadingBlueprints(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/settings/blueprint-docs`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) {
        const data = await res.json()
        setBlueprints(Array.isArray(data.docs) ? data.docs : BLUEPRINT_DOCS)
        setBlueprintsEditable(true)
      } else {
        // No database configured (503) — show the shipped links read-only
        // rather than an empty tab.
        setBlueprints(BLUEPRINT_DOCS)
        setBlueprintsEditable(false)
      }
    } catch {
      setBlueprints(BLUEPRINT_DOCS)
      setBlueprintsEditable(false)
    } finally { setLoadingBlueprints(false) }
  }, [])

  // One endpoint, one list: adding and removing both send the whole list, so
  // the saved value is always exactly what the tab is showing.
  const saveBlueprints = async (docs) => {
    setSavingBlueprints(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/settings/blueprint-docs`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ docs }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not save the blueprints')
      setBlueprints(data.docs)
      return true
    } catch (e) {
      setToastMessage(e.message || 'Could not save the blueprints')
      setToast(true)
      return false
    } finally { setSavingBlueprints(false) }
  }

  const addBlueprint = async () => {
    const title = blueprintDraft.title.trim()
    const url = blueprintDraft.url.trim()
    const summary = blueprintDraft.summary.trim()
    if (!title || !url) {
      setToastMessage('A blueprint needs a title and an https link.')
      setToast(true)
      return
    }
    const saved = await saveBlueprints([...blueprints, { title, url, summary }])
    if (saved) {
      setBlueprintDraft({ title: '', url: '', summary: '' })
      setToastMessage('Blueprint added')
      setToast(true)
    }
  }

  const removeBlueprint = async (url) => {
    if (!confirm('Remove this blueprint link?')) return
    const saved = await saveBlueprints(blueprints.filter((doc) => doc.url !== url))
    if (saved) {
      setToastMessage('Blueprint removed')
      setToast(true)
    }
  }

  const loadOfficeHours = useCallback(async () => {
    setLoadingOfficeHours(true)
    try {
      const res = await fetch(`${apiUrl}/settings/office-hours`)
      if (res.ok) setOfficeHoursDraft(await res.json())
    } catch {} finally {
      setLoadingOfficeHours(false)
    }
  }, [])

  // Loads whichever tab's data is lazy-fetched — runs on mount for a
  // deep link (e.g. /admin/schools) and again on every tab switch.
  useEffect(() => {
    // The box is shared by the Schools and Organizations tabs; a query left
    // over from the other tab would silently hide every row.
    setCustomerSearch('')
    if (tab === 'schools') loadSchools()
    else if (tab === 'invites') loadInvites()
    else if (tab === 'organizations') loadOrganizations()
    else if (tab === 'settings') { loadOfficeHours(); loadPaymentInstructions(); loadPromo() }
    // The inbox annotates a quoted coupon with whether it is the live one.
    else if (tab === 'inbox') loadPromo()
    else if (tab === 'api') loadApiInfo()
    else if (tab === 'blueprint') loadBlueprints()
  }, [tab, loadSchools, loadInvites, loadOrganizations, loadOfficeHours, loadPaymentInstructions, loadPromo, loadApiInfo, loadBlueprints])

  // One box filters both customer lists — name, contact email, or the account
  // ID an admin has just read off an incoming bank transfer.
  const matchesCustomerSearch = (entity) => {
    const q = customerSearch.trim().toLowerCase()
    if (!q) return true
    return [entity.name, entity.contact_email, entity.account_code, entity.pin]
      .some((field) => String(field || '').toLowerCase().includes(q))
  }

  const saveOfficeHours = async () => {
    if (!officeHoursDraft.days.trim() || !officeHoursDraft.hours.trim()) return
    setSavingOfficeHours(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/settings/office-hours`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(officeHoursDraft),
      })
      if (!res.ok) throw new Error('Failed')
      setToastMessage('Office hours updated'); setToast(true)
    } catch { setToastMessage('Failed to update office hours'); setToast(true) } finally { setSavingOfficeHours(false) }
  }

  const loadThreads = useCallback(async () => {
    setLoadingThreads(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      if (!token) return
      const res = await fetch(`${apiUrl}/contact/admin/threads`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const data = await res.json()
      setThreads(data.threads || [])
    } catch {} finally {
      setLoadingThreads(false)
    }
  }, [])

  const loadReviews = useCallback(async () => {
    setLoadingReviews(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      if (!token) return
      const res = await fetch(`${apiUrl}/reviews/admin/list`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const data = await res.json()
      setReviews(data.reviews || [])
    } catch {} finally {
      setLoadingReviews(false)
    }
  }, [])

  const unpublishReview = async (id) => {
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/reviews/admin/${id}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ approved: false }),
      })
      if (!res.ok) throw new Error('Failed')
      await loadReviews()
    } catch { setToastMessage('Failed to update review'); setToast(true) }
  }

  const openSchedule = (r) => {
    setSchedulingId(r.id)
    setScheduleDraft({
      publishAt: r.publish_at ? r.publish_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
      removeAfterDays: 30,
    })
  }

  const confirmSchedule = async (id) => {
    const removeAfterDays = Number(scheduleDraft.removeAfterDays)
    if (!Number.isInteger(removeAfterDays) || removeAfterDays < 1 || removeAfterDays > 365) {
      setToastMessage('Remove-after must be 1–365 days'); setToast(true); return
    }
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/reviews/admin/${id}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ publishAt: scheduleDraft.publishAt, removeAfterDays }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed')
      setSchedulingId(null)
      await loadReviews()
    } catch (e) { setToastMessage(e.message || 'Failed to schedule review'); setToast(true) }
  }

  const deleteReview = async (id) => {
    if (!confirm('Delete this review permanently?')) return
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/reviews/admin/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed')
      setReviews((prev) => prev.filter((r) => r.id !== id))
    } catch { setToastMessage('Failed to delete review'); setToast(true) }
  }

  useEffect(() => {
    loadSchools()
  }, [loadSchools])

  useEffect(() => {
    loadReviews()
  }, [loadReviews])

  useEffect(() => {
    loadThreads()
  }, [loadThreads])

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


  const toggleDraft = (threadId) => {
    setDrafts((prev) => {
      const next = { ...prev }
      if (next[threadId]) {
        delete next[threadId]
      } else {
        const thread = threads.find((t) => t.thread_id === threadId)
        next[threadId] = generateDraft(thread)
      }
      return next
    })
  }

  const toggleThreadMessages = async (threadId) => {
    if (expandedThreadId === threadId) {
      setExpandedThreadId(null)
      return
    }
    setExpandedThreadId(threadId)
    if (threadMessages[threadId]) return
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/contact/admin/threads/${threadId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to load conversation')
      const data = await res.json()
      setThreadMessages((prev) => ({ ...prev, [threadId]: data.messages || [] }))
    } catch {
      setToastMessage('Could not load full conversation')
      setToast(true)
      setExpandedThreadId(null)
    }
  }

  const copyDraft = async (threadId) => {
    try {
      await navigator.clipboard.writeText(drafts[threadId])
      setCopiedIdx(threadId)
      setTimeout(() => setCopiedIdx((cur) => (cur === threadId ? null : cur)), 2000)
    } catch {
      setToastMessage('Could not copy — select and copy the text manually.')
      setToast(true)
    }
  }

  const copyApiText = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text)
      setApiCopied(key)
      setTimeout(() => setApiCopied((cur) => (cur === key ? '' : cur)), 2000)
    } catch {
      setToastMessage('Could not copy — select and copy the text manually.')
      setToast(true)
    }
  }

  const removeThread = async (threadId) => {
    if (!confirm('Delete this entire conversation?')) return
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/contact/admin/threads/${threadId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to delete')
      setThreads((prev) => prev.filter((t) => t.thread_id !== threadId))
    } catch {
      setToastMessage('Failed to delete conversation')
      setToast(true)
    }
  }

  const sendDraft = async (threadId) => {
    const draft = drafts[threadId]
    if (!draft) return
    setSendingIds((prev) => new Set(prev).add(threadId))
    setSendErrors((prev) => { const next = { ...prev }; delete next[threadId]; return next })
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/contact/admin/threads/${threadId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: draft }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send')
      if (!data.sent) throw new Error('Reply saved, but the email could not be delivered')
      setDrafts((prev) => { const next = { ...prev }; delete next[threadId]; return next })
      setToastMessage('Reply sent')
      setToast(true)
      loadThreads()
    } catch (e) {
      setSendErrors((prev) => ({ ...prev, [threadId]: e.message }))
      setToastMessage(e.message)
      setToast(true)
    } finally {
      setSendingIds((prev) => { const next = new Set(prev); next.delete(threadId); return next })
    }
  }

  return (
    <AppLayout
      title={tab === 'inbox' ? 'Contact inbox' : tab === 'reviews' ? 'Reviews' : tab === 'incidents' ? 'Incidents' : tab === 'invites' ? 'Pending invites' : tab === 'organizations' ? 'Organizations' : tab === 'settings' ? 'Site settings' : tab === 'api' ? 'API' : tab === 'blueprint' ? 'Blueprint' : 'Manage schools'}
      subtitle={tab === 'inbox' ? `${threads.length} conversation${threads.length === 1 ? '' : 's'}` : tab === 'reviews' ? `${reviews.length} review${reviews.length === 1 ? '' : 's'} submitted` : tab === 'incidents' ? `${incidents.length} incident${incidents.length === 1 ? '' : 's'} logged` : tab === 'invites' ? `${invites.length} invite${invites.length === 1 ? '' : 's'} sent` : tab === 'organizations' ? `${organizations.length} organization${organizations.length === 1 ? '' : 's'}` : tab === 'settings' ? 'Contact page content and payment instructions' : tab === 'api' ? `${apiRoutes.length} route${apiRoutes.length === 1 ? '' : 's'} live` : tab === 'blueprint' ? 'How this app is built, end to end' : `${schools.length} school${schools.length === 1 ? '' : 's'} registered`}
      action={
        <div className="flex gap-2">
          <button data-tour="admin-inbox" onClick={() => setTab('inbox')} className={`btn-sm ${tab === 'inbox' ? 'btn-primary' : 'btn-ghost'}`}>
            <MessageSquare className="w-3.5 h-3.5 mr-1" /> Inbox
          </button>
          <button onClick={() => setTab('reviews')} className={`btn-sm ${tab === 'reviews' ? 'btn-primary' : 'btn-ghost'}`}>
            <Star className="w-3.5 h-3.5 mr-1" /> Reviews
          </button>
          <button data-tour="admin-schools" onClick={() => setTab('schools')} className={`btn-sm ${tab === 'schools' ? 'btn-primary' : 'btn-ghost'}`}>
            <School className="w-3.5 h-3.5 mr-1" /> Schools
          </button>
          <button onClick={() => setTab('invites')} className={`btn-sm ${tab === 'invites' ? 'btn-primary' : 'btn-ghost'}`}>
            <UserPlus className="w-3.5 h-3.5 mr-1" /> Invites
          </button>
          <button onClick={() => setTab('organizations')} className={`btn-sm ${tab === 'organizations' ? 'btn-primary' : 'btn-ghost'}`}>
            <Building2 className="w-3.5 h-3.5 mr-1" /> Organizations
          </button>
          <button data-tour="admin-incidents" onClick={() => { setTab('incidents'); loadIncidents() }} className={`btn-sm ${tab === 'incidents' ? 'btn-primary' : 'btn-ghost'} relative`}>
            <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Incidents
            {incidents.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center font-bold">{incidents.length > 9 ? '9+' : incidents.length}</span>
            )}
          </button>
          <button onClick={() => setTab('settings')} className={`btn-sm ${tab === 'settings' ? 'btn-primary' : 'btn-ghost'}`}>
            <Wrench className="w-3.5 h-3.5 mr-1" /> Settings
          </button>
          <button onClick={() => { setTab('api'); loadApiInfo() }} className={`btn-sm ${tab === 'api' ? 'btn-primary' : 'btn-ghost'}`}>
            <Terminal className="w-3.5 h-3.5 mr-1" /> API
          </button>
          <button onClick={() => setTab('blueprint')} className={`btn-sm ${tab === 'blueprint' ? 'btn-primary' : 'btn-ghost'}`}>
            <Compass className="w-3.5 h-3.5 mr-1" /> Blueprint
          </button>
        </div>
      }
    >
      {tab === 'inbox' && !loadingThreads && (
        <SpotlightTour storageKey="voluntrack:tour-seen:admin" steps={ADMIN_TOUR_STEPS} />
      )}
      {tab === 'reviews' ? (
        loadingReviews ? (
          <Card><p className="text-center text-earth-400 py-8">Loading reviews…</p></Card>
        ) : reviews.length === 0 ? (
          <Card>
            <div className="text-center py-12 text-earth-500">
              <Star className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-earth-900 dark:text-earth-100">No reviews yet</p>
              <p className="text-sm mt-1">Reviews submitted by users will appear here.</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-4">
            {reviews.map((r) => {
              const status = r.status || (r.approved ? 'live' : 'pending')
              const STATUS_STYLE = {
                pending: { label: 'Awaiting reviewer', cls: 'bg-amber-500/10 text-amber-400' },
                declined: { label: 'Declined by reviewer', cls: 'bg-red-500/10 text-red-400' },
                awaiting_admin: { label: 'Ready for approval', cls: 'bg-blue-500/10 text-blue-400' },
                scheduled: { label: 'Scheduled', cls: 'bg-amber-500/10 text-amber-400' },
                live: { label: 'Live · public', cls: 'bg-emerald-500/10 text-emerald-400' },
                expired: { label: 'Expired', cls: 'bg-earth-500/10 text-earth-400' },
              }[status]
              const canSchedule = status === 'awaiting_admin' || status === 'scheduled' || status === 'expired'
              return (
                <Card key={r.id} padded={false} className="p-5">
                  <div className="flex items-start gap-4">
                    <div className="flex gap-1 shrink-0">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} className={`w-5 h-5 ${n <= r.rating ? 'fill-brand-400 text-brand-400' : 'text-earth-600'}`} />
                      ))}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-earth-300">{r.name || `Anonymous${r.role ? ` (${r.role})` : ''}`}</span>
                        {r.email && <span className="text-xs text-earth-500">{r.email}</span>}
                        <span className="text-xs text-earth-500">{new Date(r.created_at).toLocaleString()}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE.cls}`}>
                          {STATUS_STYLE.label}
                        </span>
                        {(status === 'live' || status === 'scheduled' || status === 'expired') && r.publish_at && r.expires_at && (
                          <span className="text-xs text-earth-500">
                            {new Date(r.publish_at).toLocaleDateString()} – {new Date(r.expires_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      {r.comment && (
                        <p className="mt-2 text-sm text-earth-300 whitespace-pre-wrap">{r.comment}</p>
                      )}
                      {!r.comment && (
                        <p className="mt-2 text-xs text-earth-500 italic">No comment left</p>
                      )}
                      {schedulingId === r.id && (
                        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
                          <label className="text-xs text-earth-400">
                            Show starting
                            <input
                              type="date"
                              value={scheduleDraft.publishAt}
                              onChange={(e) => setScheduleDraft((d) => ({ ...d, publishAt: e.target.value }))}
                              className="mt-1 block rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1.5 text-sm text-white"
                            />
                          </label>
                          <label className="text-xs text-earth-400">
                            Remove after (days)
                            <input
                              type="number"
                              min={1}
                              max={365}
                              value={scheduleDraft.removeAfterDays}
                              onChange={(e) => setScheduleDraft((d) => ({ ...d, removeAfterDays: e.target.value }))}
                              className="mt-1 block w-24 rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1.5 text-sm text-white"
                            />
                          </label>
                          <button onClick={() => confirmSchedule(r.id)} className="btn-sm btn-primary">Confirm</button>
                          <button onClick={() => setSchedulingId(null)} className="btn-sm btn-ghost">Cancel</button>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {(status === 'live' || status === 'scheduled') && (
                        <button onClick={() => unpublishReview(r.id)} className="p-2 rounded-lg text-amber-400 hover:bg-amber-500/10" title="Unpublish">
                          <XCircle className="w-4 h-4" />
                        </button>
                      )}
                      {canSchedule && (
                        <button onClick={() => openSchedule(r)} className="p-2 rounded-lg text-emerald-400 hover:bg-emerald-500/10" title={status === 'expired' ? 'Reschedule' : 'Approve & schedule'}>
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => deleteReview(r.id)} className="p-2 rounded-lg text-red-400 hover:bg-red-500/10" title="Delete">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </Card>
              )
            })}
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
              <button onClick={() => { setInviteKind('school'); setShowInviteModal(true) }} className="btn-primary inline-flex mt-4">Invite a school</button>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 mb-4">
              {(() => {
                const upcoming = schools
                  .filter((s) => s.payment_due_date && s.payment_status !== 'paid')
                  .map((s) => ({ ...s, daysLeft: Math.ceil((new Date(s.payment_due_date) - new Date()) / (1000 * 60 * 60 * 24)) }))
                  .filter((s) => s.daysLeft >= 0 && s.daysLeft <= 10)
                  .sort((a, b) => a.daysLeft - b.daysLeft)
                if (upcoming.length > 0) {
                  const soonest = upcoming[0]
                  return (
                    <div className="w-full p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-sm mb-2">
                      <Calendar className="w-4 h-4 inline mr-1" />
                      {upcoming.length} school{upcoming.length === 1 ? '' : 's'} with payment due within 10 days — soonest is <strong>{soonest.name}</strong> in <strong>{soonest.daysLeft} day{soonest.daysLeft === 1 ? '' : 's'}</strong>
                    </div>
                  )
                }
                return null
              })()}
              <button onClick={exportCsv} className="btn-sm btn-ghost">
                <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
              </button>
              <button onClick={() => { setNotifySchoolId(null); setShowNotifyModal(true) }} className="btn-sm btn-ghost">
                <Bell className="w-3.5 h-3.5 mr-1" /> Notify all schools
              </button>
              <button onClick={() => { setInviteKind('school'); setShowInviteModal(true) }} className="btn-sm btn-primary ml-auto">
                <UserPlus className="w-3.5 h-3.5 mr-1" /> Invite school
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-earth-400 shrink-0" />
              <input
                className="input flex-1"
                placeholder="Search by name, email, or account ID…"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
              />
            </div>
            {customerSearch.trim() && schools.filter(matchesCustomerSearch).length === 0 && (
              <p className="text-sm text-earth-500 text-center py-8">No schools match “{customerSearch.trim()}”.</p>
            )}
            {schools.filter(matchesCustomerSearch).map((s) => (
              <Card key={s.id} padded={false} className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <School className="w-8 h-8 text-brand-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{s.name}</p>
                      <p className="text-xs text-earth-400">
                        {s.account_code && <>Account ID: <span className="font-mono">{s.account_code}</span> · </>}
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
                        {s.price_amount && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-brand-500/10 text-brand-400">
                            {s.price_amount}{s.price_period === 'monthly' ? ' / month' : s.price_period === 'yearly' ? ' / year' : s.price_period === 'one_time' ? ' one-time' : ''}
                          </span>
                        )}
                        {s.payment_due_date && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-earth-500/10 text-earth-400">
                            Due {new Date(s.payment_due_date).toLocaleDateString()}
                          </span>
                        )}
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
                    <button onClick={() => { setPriceModal(s.id); setPriceAmountDraft(s.price_amount || ''); setPricePeriodDraft(s.price_period || 'monthly') }} className={`p-2 ${s.price_amount ? 'text-brand-400 hover:text-brand-300' : 'text-earth-400 hover:text-earth-300'}`} title="Set this school's price">
                      <DollarSign className="w-4 h-4" />
                    </button>
                    <button onClick={() => { setDueDateModal(s.id); setDueDateDraft(s.payment_due_date ? String(s.payment_due_date).slice(0, 10) : '') }} className={`p-2 ${s.payment_due_date ? 'text-brand-400 hover:text-brand-300' : 'text-earth-400 hover:text-earth-300'}`} title="Set this school's payment due date">
                      <Calendar className="w-4 h-4" />
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
                    <button onClick={() => { setNotifySchoolId(s.id); setNotifyAmount(s.price_amount || ''); setNotifyBillingPeriod(s.price_period || 'monthly'); setShowNotifyModal(true) }} className="text-brand-400 hover:text-brand-300 p-2" title="Notify this school">
                      <Bell className="w-4 h-4" />
                    </button>
                    <button onClick={() => openInvoiceModal('school', s)} className="text-brand-400 hover:text-brand-300 p-2" title="Send invoice">
                      <Receipt className="w-4 h-4" />
                    </button>
                    <button onClick={() => openHistory('school', s)} className="text-earth-400 hover:text-earth-300 p-2" title="Payment history">
                      <History className="w-4 h-4" />
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
              <p className="text-sm mt-1">Invite a school or organization and they'll get a link to finish setup themselves.</p>
              <div className="flex gap-2 justify-center mt-4">
                <button onClick={() => { setInviteKind('school'); setShowInviteModal(true) }} className="btn-primary inline-flex">
                  <UserPlus className="w-3.5 h-3.5 mr-1" /> Invite a school
                </button>
                <button onClick={() => { setInviteKind('organization'); setShowInviteModal(true) }} className="btn-ghost inline-flex">
                  <Building2 className="w-3.5 h-3.5 mr-1" /> Invite an organization
                </button>
              </div>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end gap-2 mb-4">
              <button onClick={() => { setInviteKind('school'); setShowInviteModal(true) }} className="btn-sm btn-primary">
                <UserPlus className="w-3.5 h-3.5 mr-1" /> Invite school
              </button>
              <button onClick={() => { setInviteKind('organization'); setShowInviteModal(true) }} className="btn-sm btn-ghost">
                <Building2 className="w-3.5 h-3.5 mr-1" /> Invite organization
              </button>
            </div>
            {invites.map((inv) => (
              <Card key={`${inv.kind}-${inv.id}`} padded={false} className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {inv.kind === 'organization' ? (
                      <Building2 className="w-8 h-8 text-brand-600 shrink-0" />
                    ) : (
                      <UserPlus className="w-8 h-8 text-brand-600 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{inv.name}</p>
                      <p className="text-xs text-earth-400">{inv.email}</p>
                      <div className="flex flex-wrap gap-2 mt-1">
                        <span className="text-xs text-earth-500 uppercase tracking-wide">{inv.kind === 'organization' ? 'Organization' : 'School'}</span>
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
                      <button onClick={() => resendInvite(inv.id, inv.kind)} className="text-brand-400 hover:text-brand-300 p-2" title="Resend invite">
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => deleteInvite(inv.id, inv.kind)} className="text-red-400 hover:text-red-300 p-2" title="Delete invite">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : tab === 'organizations' ? (
        loadingOrganizations ? (
          <Card><p className="text-center text-earth-400 py-8">Loading organizations…</p></Card>
        ) : organizations.length === 0 ? (
          <Card>
            <div className="text-center py-12 text-earth-500">
              <Building2 className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-earth-900 dark:text-earth-100">No organizations yet</p>
              <p className="text-sm mt-1">Organizations register themselves and add their own schools — you set their price and payment due date here.</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-earth-400 shrink-0" />
              <input
                className="input flex-1"
                placeholder="Search by name, email, or account ID…"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
              />
            </div>
            {customerSearch.trim() && organizations.filter(matchesCustomerSearch).length === 0 && (
              <p className="text-sm text-earth-500 text-center py-8">No organizations match “{customerSearch.trim()}”.</p>
            )}
            {organizations.filter(matchesCustomerSearch).map((org) => (
              <Card key={org.id} padded={false} className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Building2 className="w-8 h-8 text-brand-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{org.name}</p>
                      <p className="text-xs text-earth-400">
                        {org.account_code && <>Account ID: <span className="font-mono">{org.account_code}</span> · </>}
                        {org.contact_email}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-1">
                        <span className="text-xs text-earth-500">
                          <School className="w-3 h-3 inline mr-1" />
                          {org.school_count} school{Number(org.school_count) === 1 ? '' : 's'} ·
                          Joined {new Date(org.created_at).toLocaleDateString()}
                        </span>
                        {org.price_amount && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-brand-500/10 text-brand-400">
                            {org.price_amount}{org.price_period === 'monthly' ? ' / month' : org.price_period === 'yearly' ? ' / year' : org.price_period === 'one_time' ? ' one-time' : ''}
                          </span>
                        )}
                        {org.payment_due_date && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-earth-500/10 text-earth-400">
                            Due {new Date(org.payment_due_date).toLocaleDateString()}
                          </span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          org.payment_status === 'paid' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                        }`}>
                          {org.payment_status === 'paid' ? 'Paid' : 'Unpaid'}
                        </span>
                      </div>
                      {org.payment_notes && (
                        <p className="text-xs text-earth-500 mt-0.5">{org.payment_notes}</p>
                      )}
                      {org.admin_notes && (
                        <p className="text-xs text-amber-500/80 mt-0.5 flex items-start gap-1">
                          <ShieldCheck className="w-3 h-3 mt-0.5 shrink-0" />
                          <span><span className="font-medium">Internal note (admin only):</span> {org.admin_notes}</span>
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => { setOrgNoteModal(org.id); setOrgNoteDraft(org.admin_notes || '') }} className={`p-2 ${org.admin_notes ? 'text-amber-400 hover:text-amber-300' : 'text-earth-400 hover:text-earth-300'}`} title="Internal note (visible to admins only)">
                      <ShieldCheck className="w-4 h-4" />
                    </button>
                    <button onClick={() => { setOrgPriceModal(org.id); setOrgPriceAmountDraft(org.price_amount || ''); setOrgPricePeriodDraft(org.price_period || 'monthly') }} className={`p-2 ${org.price_amount ? 'text-brand-400 hover:text-brand-300' : 'text-earth-400 hover:text-earth-300'}`} title="Set this organization's price">
                      <DollarSign className="w-4 h-4" />
                    </button>
                    <button onClick={() => { setOrgDueDateModal(org.id); setOrgDueDateDraft(org.payment_due_date ? String(org.payment_due_date).slice(0, 10) : '') }} className={`p-2 ${org.payment_due_date ? 'text-brand-400 hover:text-brand-300' : 'text-earth-400 hover:text-earth-300'}`} title="Set this organization's payment due date">
                      <Calendar className="w-4 h-4" />
                    </button>
                    {org.payment_status === 'paid' ? (
                      <button onClick={() => updateOrgPayment(org.id, 'unpaid')} className="text-amber-400 hover:text-amber-300 p-2" title="Mark as unpaid">
                        <CreditCard className="w-4 h-4" />
                      </button>
                    ) : (
                      <button onClick={() => { setOrgPayModal(org.id); setOrgPayNotes('') }} className="text-emerald-400 hover:text-emerald-300 p-2" title="Mark as paid">
                        <CreditCard className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => { setNotifyOrgId(org.id); setNotifyAmount(org.price_amount || ''); setNotifyBillingPeriod(org.price_period || 'monthly'); setShowNotifyModal(true) }} className="text-brand-400 hover:text-brand-300 p-2" title="Notify this organization">
                      <Bell className="w-4 h-4" />
                    </button>
                    <button onClick={() => openInvoiceModal('organization', org)} className="text-brand-400 hover:text-brand-300 p-2" title="Send invoice">
                      <Receipt className="w-4 h-4" />
                    </button>
                    <button onClick={() => openHistory('organization', org)} className="text-earth-400 hover:text-earth-300 p-2" title="Payment history">
                      <History className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteOrganization(org.id, org.name)} className="text-red-400 hover:text-red-300 p-2" title="Delete organization">
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
          {loadingIncidents ? (
            <Card><p className="text-sm text-earth-400 py-4">Loading…</p></Card>
          ) : incidents.filter((i) => i.status !== 'resolved').length === 0 ? (
            <Card>
              <div className="text-center py-12 text-earth-500">
                <AlertTriangle className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <p className="font-medium text-earth-900 dark:text-earth-100">No active incidents</p>
                <p className="text-sm mt-1">All services are running normally.</p>
              </div>
            </Card>
          ) : (
            <div className="space-y-3 mb-6">
                {incidents.filter((i) => i.status !== 'resolved').map((inc) => (
                  <Card key={inc.id} padded={false} className="p-4 border bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800">
                    <div className="flex items-start gap-3">
                      <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm text-earth-800 dark:text-earth-200">{inc.service}</p>
                          <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30">{inc.status}</span>
                          {inc.source === 'admin' && (
                            <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded text-earth-600 dark:text-earth-300 bg-earth-100 dark:bg-earth-800">manual</span>
                          )}
                        </div>
                        {inc.detail && <p className="text-xs text-earth-500 dark:text-earth-400 mt-0.5">{inc.detail}</p>}
                        <p className="text-xs text-earth-400 dark:text-earth-500 mt-0.5">{new Date(inc.detectedAt).toLocaleString()}</p>
                        {inc.issueUrl && (
                          <a href={inc.issueUrl} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline mt-0.5 inline-block">
                            GitHub issue ↗
                          </a>
                        )}
                        <div className="flex gap-2 mt-2">
                          <button onClick={() => resolveOne(inc.id)} disabled={resolvingId === inc.id} className="text-xs font-semibold px-2.5 py-1 rounded bg-green-500 text-white hover:bg-green-600 disabled:opacity-50">
                            {resolvingId === inc.id ? 'Resolving...' : 'Resolve'}
                          </button>
                          <button onClick={() => deleteOne(inc.id)} disabled={deletingId === inc.id} className="text-xs font-semibold px-2.5 py-1 rounded border border-red-300 dark:border-red-800 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50">
                            {deletingId === inc.id ? 'Deleting...' : confirmDeleteId === inc.id ? 'Confirm delete?' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
            </div>
          )}

          {incidents.some((i) => i.status === 'resolved') && (
            <Card className="mb-6">
              <h3 className="font-display font-semibold text-base mb-1">Resolved history</h3>
              <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">
                These are still listed publicly on /status. Resolving doesn't unpublish an incident — deleting does.
              </p>
              <div className="space-y-2">
                {incidents.filter((i) => i.status === 'resolved').map((inc) => (
                  <div key={inc.id} className="flex items-start justify-between gap-2 border-b border-earth-100 dark:border-earth-800 pb-2 last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm text-earth-800 dark:text-earth-200 truncate">{inc.service}</p>
                      <p className="text-xs text-earth-400 dark:text-earth-500">{new Date(inc.detectedAt).toLocaleString()}</p>
                    </div>
                    <button onClick={() => deleteOne(inc.id)} disabled={deletingId === inc.id} className="text-xs font-semibold px-2.5 py-1 rounded shrink-0 border border-red-300 dark:border-red-800 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50">
                      {deletingId === inc.id ? 'Deleting...' : confirmDeleteId === inc.id ? 'Confirm delete?' : 'Delete'}
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <h3 className="font-display font-semibold text-base mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-brand-600" /> Log an incident
            </h3>
            <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
              Database and email failures, and backend outages, are logged automatically. Use this for anything else (e.g. a third-party outage or planned maintenance).
            </p>
            <div className="space-y-3 max-w-sm">
              <div>
                <label className="text-xs font-medium text-earth-500 dark:text-earth-400">Service</label>
                <input
                  type="text"
                  value={newIncident.service}
                  onChange={(e) => setNewIncident({ ...newIncident, service: e.target.value })}
                  placeholder="e.g. Payment provider"
                  className="input mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-earth-500 dark:text-earth-400">Detail</label>
                <input
                  type="text"
                  value={newIncident.detail}
                  onChange={(e) => setNewIncident({ ...newIncident, detail: e.target.value })}
                  placeholder="Optional details"
                  className="input mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-earth-500 dark:text-earth-400">GitHub issue</label>
                <input
                  type="url"
                  value={newIncident.issueUrl}
                  onChange={(e) => setNewIncident({ ...newIncident, issueUrl: e.target.value })}
                  placeholder="https://github.com/org/repo/issues/123"
                  className="input mt-1"
                />
              </div>
              <button onClick={submitIncident} disabled={loggingIncident || !newIncident.service.trim()} className="btn-primary btn-sm">
                {loggingIncident ? 'Logging…' : 'Log incident'}
              </button>
            </div>
          </Card>
        </>
      ) : tab === 'settings' ? (
        <div className="space-y-6">
        <Card>
          <h3 className="font-display font-semibold text-base mb-3 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-brand-600" /> Office hours
          </h3>
          <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">Shown on the public Contact page.</p>
          {loadingOfficeHours ? (
            <p className="text-sm text-earth-400 py-4">Loading…</p>
          ) : (
            <div className="space-y-3 max-w-sm">
              <div>
                <label className="text-xs font-medium text-earth-500 dark:text-earth-400">Days</label>
                <input
                  type="text"
                  value={officeHoursDraft.days}
                  onChange={(e) => setOfficeHoursDraft({ ...officeHoursDraft, days: e.target.value })}
                  placeholder="Monday – Friday"
                  className="input mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-earth-500 dark:text-earth-400">Hours</label>
                <input
                  type="text"
                  value={officeHoursDraft.hours}
                  onChange={(e) => setOfficeHoursDraft({ ...officeHoursDraft, hours: e.target.value })}
                  placeholder="9:00 AM – 5:00 PM (CT)"
                  className="input mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-earth-500 dark:text-earth-400">Note</label>
                <input
                  type="text"
                  value={officeHoursDraft.note}
                  onChange={(e) => setOfficeHoursDraft({ ...officeHoursDraft, note: e.target.value })}
                  placeholder="Replies may take up to 48 hours."
                  className="input mt-1"
                />
              </div>
              <button onClick={saveOfficeHours} disabled={savingOfficeHours} className="btn-primary btn-sm">
                {savingOfficeHours ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </Card>
        <Card>
          <div className="flex items-start justify-between gap-3 mb-3">
            <h3 className="font-display font-semibold text-base flex items-center gap-2">
              <Tag className="w-4 h-4 text-brand-600" /> Join offer
            </h3>
            <label className="inline-flex items-center gap-2 text-sm shrink-0">
              <input
                type="checkbox"
                checked={promoDraft.enabled}
                onChange={(e) => setPromoDraft({ ...promoDraft, enabled: e.target.checked })}
              />
              Running
            </label>
          </div>
          <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
            A discount for schools and organizations that sign up — shown on the home page, the signup pages and their
            dashboards, and offered as a one-click discount when you invoice a new account. Switch it off to take it down
            everywhere; invoices already sent keep the price they were sent at.
          </p>
          {loadingPromo ? (
            <p className="text-sm text-earth-400 py-4">Loading…</p>
          ) : (
            <div className="space-y-3 max-w-sm">
              <div>
                <label className="text-xs font-medium text-earth-500 dark:text-earth-400">Headline</label>
                <input
                  type="text"
                  value={promoDraft.headline}
                  onChange={(e) => setPromoDraft({ ...promoDraft, headline: e.target.value })}
                  placeholder="Launch offer"
                  className="input mt-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-earth-500 dark:text-earth-400">Percent off</label>
                  <input
                    type="number" min="1" max="100" step="1"
                    value={promoDraft.percentOff}
                    onChange={(e) => setPromoDraft({ ...promoDraft, percentOff: e.target.value })}
                    className="input mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-earth-500 dark:text-earth-400">Ends (optional)</label>
                  <input
                    type="date"
                    value={promoDraft.endsAt || ''}
                    onChange={(e) => setPromoDraft({ ...promoDraft, endsAt: e.target.value })}
                    className="input mt-1"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-earth-500 dark:text-earth-400">Code (optional)</label>
                  <input
                    type="text"
                    value={promoDraft.code}
                    onChange={(e) => setPromoDraft({ ...promoDraft, code: e.target.value.toUpperCase() })}
                    placeholder="LAUNCH10"
                    className="input mt-1 font-mono tracking-wider"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-earth-500 dark:text-earth-400">Usage limit</label>
                  <input
                    type="number" min="1" step="1"
                    value={promoDraft.maxRedemptions ?? ''}
                    onChange={(e) => setPromoDraft({ ...promoDraft, maxRedemptions: e.target.value === '' ? null : Number(e.target.value) })}
                    placeholder="Unlimited"
                    className="input mt-1"
                  />
                </div>
              </div>
              <p className="text-xs text-earth-500 dark:text-earth-400 -mt-1">
                The code is printed on the banner for customers to quote. A usage limit needs one, since claims are
                counted against it.
                {promoDraft.code && (
                  <>
                    {' '}<strong>{promoUsed}</strong> claimed
                    {promoDraft.maxRedemptions
                      ? ` of ${promoDraft.maxRedemptions} — ${promoRemaining(promoDraft, promoUsed)} left.`
                      : ' so far.'}
                    {' '}Voiding an invoice gives its use back.
                  </>
                )}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-earth-500 dark:text-earth-400">Who it&apos;s for</label>
                  <select
                    className="input mt-1"
                    value={promoDraft.audience}
                    onChange={(e) => setPromoDraft({ ...promoDraft, audience: e.target.value })}
                  >
                    {PROMO_AUDIENCES.map((a) => (
                      <option key={a} value={a}>{a === 'both' ? 'Schools & organizations' : a === 'school' ? 'Schools only' : 'Organizations only'}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-earth-500 dark:text-earth-400">Billing period</label>
                  <select
                    className="input mt-1"
                    value={promoDraft.appliesTo}
                    onChange={(e) => setPromoDraft({ ...promoDraft, appliesTo: e.target.value })}
                  >
                    {PROMO_PERIODS.map((period) => (
                      <option key={period} value={period}>{period === 'any' ? 'Any' : period === 'one_time' ? 'One-time' : period === 'monthly' ? 'Monthly' : 'Yearly'}</option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={promoDraft.firstInvoiceOnly}
                  onChange={(e) => setPromoDraft({ ...promoDraft, firstInvoiceOnly: e.target.checked })}
                />
                <span>First invoice only — an account that has already been invoiced can&apos;t claim it again.</span>
              </label>
              <div>
                <label className="text-xs font-medium text-earth-500 dark:text-earth-400">Where it shows</label>
                <select
                  className="input mt-1"
                  value={promoDraft.visibility}
                  onChange={(e) => setPromoDraft({ ...promoDraft, visibility: e.target.value })}
                >
                  {PROMO_VISIBILITIES.map((v) => (
                    <option key={v} value={v}>
                      {v === 'public' ? 'Public — home page, signup pages, dashboards' : 'Invite only — never shown on the site'}
                    </option>
                  ))}
                </select>
                {promoDraft.visibility === 'invite' && (
                  <p className="text-xs text-earth-500 dark:text-earth-400 mt-1">
                    Nothing renders on the landing page, signup pages or About. Existing customers still see it on their
                    own dashboard, which is where they get their referral code.
                  </p>
                )}
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={promoDraft.referral}
                  onChange={(e) => setPromoDraft({ ...promoDraft, referral: e.target.checked })}
                />
                <span>
                  Referral — a customer who sends someone new also gets {promoDraft.percentOff || 10}% off their next
                  invoice, as well as the discount for whoever joins.
                </span>
              </label>
              <div>
                <label className="text-xs font-medium text-earth-500 dark:text-earth-400">Details</label>
                <textarea
                  rows={2}
                  value={promoDraft.details}
                  onChange={(e) => setPromoDraft({ ...promoDraft, details: e.target.value })}
                  placeholder={`Get ${promoLabel(promoDraft)} when your school joins.`}
                  className="input mt-1"
                />
                <p className="text-xs text-earth-500 dark:text-earth-400 mt-1">
                  Leave blank and the banner reads &ldquo;Get {promoLabel(promoDraft)}.&rdquo;
                </p>
              </div>
              <button onClick={savePromo} disabled={savingPromo} className="btn-primary btn-sm">
                {savingPromo ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </Card>
        <Card>
          <h3 className="font-display font-semibold text-base mb-3 flex items-center gap-2">
            <Gift className="w-4 h-4 text-brand-600" /> Invite existing customers
          </h3>
          <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
            Email every school and organization their own referral code so they can pass it on. Each one gets a separate
            message — never a shared thread — and it is sent as an automated email they can&apos;t reply to. Anyone already
            invited is skipped, so sending twice won&apos;t mail them again.
          </p>
          {!promoDraft.referral || !promoDraft.enabled ? (
            <p className="text-sm text-earth-500 dark:text-earth-400">
              Turn on a running offer with <strong>Referral</strong> ticked above, then save, to send invites.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => previewInvites(false)} disabled={sendingInvites} className="btn-primary btn-sm inline-flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5" /> {sendingInvites ? 'Working…' : 'Preview recipients'}
              </button>
              <button onClick={() => previewInvites(true)} disabled={sendingInvites} className="btn-ghost btn-sm">
                Include already-invited
              </button>
            </div>
          )}
        </Card>
        <Card>
          <h3 className="font-display font-semibold text-base mb-3 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-brand-600" /> Payment instructions
          </h3>
          <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
            How schools and organizations pay you. Shown on their dashboards next to their account ID, and included in
            invoice emails and payment notices. Leave a field blank to hide it.
          </p>
          <div className="space-y-3 max-w-sm">
              <div>
                <label className="text-xs font-medium text-earth-500 dark:text-earth-400">Bank name</label>
                <input
                  type="text"
                  value={paymentDraft.bankName || ''}
                  onChange={(e) => setPaymentDraft({ ...paymentDraft, bankName: e.target.value })}
                  placeholder="First National Bank"
                  className="input mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-earth-500 dark:text-earth-400">Account name</label>
                <input
                  type="text"
                  value={paymentDraft.accountName || ''}
                  onChange={(e) => setPaymentDraft({ ...paymentDraft, accountName: e.target.value })}
                  placeholder="VolunTrack LLC"
                  className="input mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-earth-500 dark:text-earth-400">Account number</label>
                <input
                  type="text"
                  value={paymentDraft.accountNumber || ''}
                  onChange={(e) => setPaymentDraft({ ...paymentDraft, accountNumber: e.target.value })}
                  placeholder="000123456789"
                  className="input mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-earth-500 dark:text-earth-400">Routing number</label>
                <input
                  type="text"
                  value={paymentDraft.routingNumber || ''}
                  onChange={(e) => setPaymentDraft({ ...paymentDraft, routingNumber: e.target.value })}
                  placeholder="021000021"
                  className="input mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-earth-500 dark:text-earth-400">SWIFT / BIC</label>
                <input
                  type="text"
                  value={paymentDraft.swift || ''}
                  onChange={(e) => setPaymentDraft({ ...paymentDraft, swift: e.target.value })}
                  placeholder="FNBAUS33"
                  className="input mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-earth-500 dark:text-earth-400">Payment reference</label>
                <input
                  type="text"
                  value={paymentDraft.reference || ''}
                  onChange={(e) => setPaymentDraft({ ...paymentDraft, reference: e.target.value })}
                  placeholder="Use your Account ID as the reference"
                  className="input mt-1"
                />
              </div>
            <div>
              <label className="text-xs font-medium text-earth-500 dark:text-earth-400">Other notes</label>
              <textarea
                rows={3}
                value={paymentDraft.notes || ''}
                onChange={(e) => setPaymentDraft({ ...paymentDraft, notes: e.target.value })}
                placeholder="Cheques payable to VolunTrack LLC, 123 Main St…"
                className="input mt-1"
              />
            </div>
            <button onClick={savePaymentInstructions} disabled={savingPaymentInfo} className="btn-primary btn-sm">
              {savingPaymentInfo ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Card>
        </div>
      ) : tab === 'api' ? (
        <div className="space-y-6">
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-semibold text-base flex items-center gap-2">
                <Terminal className="w-4 h-4 text-brand-600" /> Backend health
              </h3>
              <button onClick={loadApiInfo} disabled={loadingApiInfo} className="text-xs text-earth-400 hover:text-earth-600 dark:hover:text-earth-200 inline-flex items-center gap-1">
                <RefreshCw className={`w-3 h-3 ${loadingApiInfo ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>
            <div className="flex items-center gap-2 mb-4 text-xs">
              <a
                href={RESOLVED_API_URL}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-brand-600 dark:text-brand-400 hover:underline truncate"
                title="Open the backend base URL"
              >
                {RESOLVED_API_URL}
              </a>
              <button
                onClick={() => copyApiText(RESOLVED_API_URL, 'url')}
                className="shrink-0 text-earth-400 hover:text-earth-600 dark:hover:text-earth-200"
                title="Copy backend URL"
              >
                {apiCopied === 'url' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            {apiHealth === null && loadingApiInfo ? (
              <p className="text-sm text-earth-400 py-2">Checking…</p>
            ) : apiHealth === null ? (
              <p className="text-sm text-red-500 py-2 flex items-center gap-1.5"><XCircle className="w-4 h-4" /> Backend unreachable</p>
            ) : apiHealth === HEALTH_UNKNOWN ? (
              <p className="text-sm text-earth-500 dark:text-earth-400 py-2 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Backend responding, but health details are unavailable right now.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <ApiHealthPill label="Backend" ok={true} detail="responding" />
                <ApiHealthPill
                  label="Database"
                  ok={apiHealth.checks.database.ok !== false}
                  detail={apiHealth.checks.database.ok === null ? 'not configured' : apiHealth.checks.database.ok ? 'connected' : 'unreachable'}
                />
                <ApiHealthPill
                  label="Email (SMTP)"
                  ok={apiHealth.checks.email.ok}
                  detail={!(apiHealth.checks.email.configured ?? apiHealth.checks.email.ok) ? 'not configured' : apiHealth.checks.email.ok ? 'connected' : 'unreachable'}
                />
              </div>
            )}
          </Card>

          <Card>
            <h3 className="font-display font-semibold text-base mb-3 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-brand-600" /> Routes
            </h3>
            <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
              Every route currently mounted on the backend, read live off the running Express routers.
            </p>
            {loadingApiInfo && apiRoutes.length === 0 ? (
              <p className="text-sm text-earth-400 py-4">Loading…</p>
            ) : apiRoutes.length === 0 ? (
              <p className="text-sm text-earth-400 py-4">No routes returned.</p>
            ) : (
              <div className="space-y-5">
                {Object.entries(
                  apiRoutes.reduce((groups, route) => {
                    (groups[route.group] ||= []).push(route)
                    return groups
                  }, {})
                ).map(([group, routes]) => (
                  <div key={group}>
                    <p className="text-xs font-semibold uppercase tracking-wider text-earth-400 dark:text-earth-500 mb-2">{group} · {routes.length}</p>
                    <div className="space-y-1">
                      {routes.map((r) => (
                        <div key={`${r.method}-${r.path}`} className="flex items-center gap-2 text-xs py-1 px-2 rounded hover:bg-earth-50 dark:hover:bg-earth-800/40">
                          <span className={`font-mono font-semibold w-14 shrink-0 ${METHOD_COLORS[r.method] || 'text-earth-500'}`}>{r.method}</span>
                          <span className="font-mono text-earth-600 dark:text-earth-300 truncate">{r.path}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h3 className="font-display font-semibold text-base mb-1 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-brand-600" /> Example request
            </h3>
            <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">
              Uses your own signed-in session token.
            </p>
            {(() => {
              const token = localStorage.getItem('voluntrack:auth_token') || ''
              const maskedToken = token ? `${token.slice(0, 8)}…` : '<not signed in>'
              const maskedCurl = `curl -H "Authorization: Bearer ${maskedToken}" \\\n  ${RESOLVED_API_URL}/status/health`
              const realCurl = `curl -H "Authorization: Bearer ${token}" \\\n  ${RESOLVED_API_URL}/status/health`
              return (
                <div className="relative">
                  <pre className="text-xs font-mono bg-earth-50 dark:bg-earth-800/40 border border-earth-200 dark:border-earth-700 rounded-lg p-3 pr-20 overflow-x-auto whitespace-pre-wrap">{maskedCurl}</pre>
                  <button
                    onClick={() => copyApiText(realCurl, 'curl')}
                    disabled={!token}
                    className="absolute top-2 right-2 flex items-center gap-1 text-xs font-medium text-brand-700 dark:text-brand-300 hover:text-brand-900 dark:hover:text-brand-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Copy a working curl command"
                  >
                    {apiCopied === 'curl' ? (
                      <><Check className="w-3.5 h-3.5" /> Copied</>
                    ) : (
                      <><Copy className="w-3.5 h-3.5" /> Copy</>
                    )}
                  </button>
                </div>
              )
            })()}
          </Card>
        </div>
      ) : tab === 'blueprint' ? (
        <div className="space-y-6">
          <Card>
            <h3 className="font-display font-semibold text-base mb-2 flex items-center gap-2">
              <Compass className="w-4 h-4 text-brand-600" /> Reference pages
            </h3>
            <p className="text-sm text-earth-500 dark:text-earth-400">
              Written by reading <code className="font-mono text-xs">src/</code> and <code className="font-mono text-xs">server/</code> directly. They live outside the repo, so they can be refreshed without a deploy — and they are admin-only, since they spell out every role's powers and every server gate.
            </p>
          </Card>

          {loadingBlueprints ? (
            <Card><p className="text-center text-earth-400 py-8">Loading blueprints…</p></Card>
          ) : blueprints.length === 0 ? (
            <Card>
              <div className="text-center py-10 text-earth-500">
                <Compass className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <p className="font-medium text-earth-900 dark:text-earth-100">No blueprints yet</p>
                <p className="text-sm mt-1">Add a link below and it will show up here for every admin.</p>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {blueprints.map((doc) => (
                <Card key={doc.url}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-display font-semibold text-base">{doc.title}</h3>
                    {blueprintsEditable && (
                      <button
                        onClick={() => removeBlueprint(doc.url)}
                        disabled={savingBlueprints}
                        className="shrink-0 text-earth-400 hover:text-red-500 disabled:opacity-50"
                        title="Remove this blueprint"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  {doc.summary && <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">{doc.summary}</p>}
                  <div className="flex items-center gap-2">
                    <a href={doc.url} target="_blank" rel="noreferrer" className="btn-primary btn-sm inline-flex">
                      <ExternalLink className="w-3.5 h-3.5 mr-1" /> Open
                    </a>
                    <button
                      onClick={() => copyApiText(doc.url, doc.url)}
                      className="btn-ghost btn-sm inline-flex"
                      title="Copy link"
                    >
                      {apiCopied === doc.url ? (
                        <><Check className="w-3.5 h-3.5 mr-1" /> Copied</>
                      ) : (
                        <><Copy className="w-3.5 h-3.5 mr-1" /> Copy link</>
                      )}
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {blueprintsEditable ? (
            <Card>
              <h3 className="font-display font-semibold text-base mb-1 flex items-center gap-2">
                <Compass className="w-4 h-4 text-brand-600" /> Add a blueprint
              </h3>
              <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
                Paste the link to another reference page — a doc, a diagram, a runbook. It has to be an https link, and every admin sees what you add.
              </p>
              <div className="space-y-3">
                <div>
                  <label htmlFor="blueprint-title" className="block text-xs font-medium text-earth-500 dark:text-earth-400 mb-1">Title</label>
                  <input
                    id="blueprint-title"
                    className="input"
                    placeholder="Database schema walkthrough"
                    maxLength={120}
                    value={blueprintDraft.title}
                    onChange={(e) => setBlueprintDraft((d) => ({ ...d, title: e.target.value }))}
                  />
                </div>
                <div>
                  <label htmlFor="blueprint-url" className="block text-xs font-medium text-earth-500 dark:text-earth-400 mb-1">Link</label>
                  <input
                    id="blueprint-url"
                    className="input font-mono text-sm"
                    placeholder="https://…"
                    maxLength={500}
                    value={blueprintDraft.url}
                    onChange={(e) => setBlueprintDraft((d) => ({ ...d, url: e.target.value }))}
                  />
                </div>
                <div>
                  <label htmlFor="blueprint-summary" className="block text-xs font-medium text-earth-500 dark:text-earth-400 mb-1">What it covers <span className="text-earth-400">(optional)</span></label>
                  <textarea
                    id="blueprint-summary"
                    className="input min-h-[72px]"
                    placeholder="One or two lines on what a reader will find in it."
                    maxLength={800}
                    value={blueprintDraft.summary}
                    onChange={(e) => setBlueprintDraft((d) => ({ ...d, summary: e.target.value }))}
                  />
                </div>
                <button onClick={addBlueprint} disabled={savingBlueprints} className="btn-primary btn-sm inline-flex">
                  {savingBlueprints ? 'Saving…' : 'Add blueprint'}
                </button>
              </div>
            </Card>
          ) : (
            <Card>
              <p className="text-sm text-earth-500 dark:text-earth-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                These are the shipped links. Adding your own needs the backend database, which isn't reachable right now.
              </p>
            </Card>
          )}
        </div>
      ) : loadingThreads ? (
        <Card><p className="text-center text-earth-400 py-8">Loading messages…</p></Card>
      ) : threads.length === 0 ? (
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
          {threads.map((c) => {
            const id = c.thread_id
            return (
            <Card key={id} padded={false} className="p-5">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-earth-900 dark:text-earth-100">{c.name || 'Unknown'}</span>
                    <a href={`mailto:${c.email}`} className="text-brand-700 dark:text-brand-300 hover:underline text-sm break-all">{c.email}</a>
                    <span className="text-xs text-earth-500 whitespace-nowrap">{new Date(c.created_at).toLocaleString()}</span>
                    {Number(c.message_count) > 1 && (
                      <button
                        onClick={() => toggleThreadMessages(id)}
                        className="text-xs px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-600 dark:text-brand-300 font-medium hover:bg-brand-500/20"
                      >
                        {c.message_count} messages{expandedThreadId === id ? ' · hide' : ' · view conversation'}
                      </button>
                    )}
                  </div>
                  <div className="mt-1 text-xs font-medium uppercase tracking-wide text-earth-600 dark:text-earth-300">
                    {c.subject || 'General question'} {c.direction === 'outbound' && <span className="text-brand-500 normal-case">· awaiting their reply</span>}
                  </div>
                  {c.account_code && (
                    <div className="mt-1 text-xs text-earth-500">
                      Customer ID: <span className="font-mono">{c.account_code}</span>
                      {c.account_name ? ` · ${c.account_name}` : ' · no matching account'}
                    </div>
                  )}
                  {c.coupon_code && (
                    <div className="mt-1 text-xs text-earth-500">
                      Coupon: <span className="font-mono">{c.coupon_code}</span>
                      {promoDraft.code
                        ? (c.coupon_code === promoDraft.code ? ' · matches the running offer' : ' · does not match the running offer')
                        : ' · no offer is running'}
                    </div>
                  )}
                  <p className="mt-2 text-sm text-earth-800 dark:text-earth-200 whitespace-pre-wrap">{c.message}</p>
                  {expandedThreadId === id && (
                    <div className="mt-3 space-y-2 border-l-2 border-earth-200 dark:border-earth-700 pl-3">
                      {expandedThreadId === id && !threadMessages[id] ? (
                        <p className="text-xs text-earth-500">Loading conversation…</p>
                      ) : (
                        (threadMessages[id] || []).map((m) => (
                          <div key={m.id}>
                            <div className="text-xs font-semibold text-earth-600 dark:text-earth-300">
                              {m.direction === 'outbound' ? 'VolunTrack' : c.name || 'Them'}
                              <span className="ml-2 font-normal text-earth-500">{new Date(m.created_at).toLocaleString()}</span>
                            </div>
                            <p className="text-sm text-earth-800 dark:text-earth-200 whitespace-pre-wrap">{m.message}</p>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                  {drafts[id] && (
                    <div className="mt-3 p-3 rounded-xl bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800">
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-xs font-semibold text-brand-700 dark:text-brand-300">AI draft</div>
                        <button
                          onClick={() => copyDraft(id)}
                          className="flex items-center gap-1 text-xs font-medium text-brand-700 dark:text-brand-300 hover:text-brand-900 dark:hover:text-brand-100"
                          title="Copy draft to clipboard"
                        >
                          {copiedIdx === id ? (
                            <><Check className="w-3.5 h-3.5" /> Copied</>
                          ) : (
                            <><Copy className="w-3.5 h-3.5" /> Copy</>
                          )}
                        </button>
                      </div>
                      <textarea
                        className="input w-full text-sm text-earth-700 dark:text-earth-300 min-h-[160px] resize-y"
                        value={drafts[id]}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [id]: e.target.value }))}
                      />
                      <div className="flex items-center gap-2 mt-3 flex-wrap">
                        <button
                          onClick={() => { if (sendErrors[id] || confirm(`Send this reply to ${c.email}?`)) sendDraft(id) }}
                          className={`btn-sm ${sendErrors[id] ? 'btn-danger' : 'btn-primary'}`}
                          disabled={sendingIds.has(id)}
                        >
                          {sendErrors[id] ? (
                            <><RefreshCw className="w-3.5 h-3.5 mr-1" /> {sendingIds.has(id) ? 'Resending…' : 'Resend'}</>
                          ) : (
                            <><Mail className="w-3.5 h-3.5 mr-1" /> {sendingIds.has(id) ? 'Sending…' : 'Send reply'}</>
                          )}
                        </button>
                        {sendErrors[id] && (
                          <span className="text-xs text-red-500">Failed: {sendErrors[id]}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <button onClick={() => toggleDraft(id)} className="p-2 rounded-lg text-earth-500 hover:text-brand-700 hover:bg-brand-500/10 self-start"
                    title={drafts[id] ? 'Hide draft' : 'Generate draft reply'}>
                    <Sparkles className={`w-4 h-4 ${drafts[id] ? 'text-brand-600' : ''}`} />
                  </button>
                  <button onClick={() => removeThread(id)} className="p-2 rounded-lg text-earth-500 hover:text-red-600 hover:bg-red-500/10 self-start" title="Delete conversation">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </Card>
            )
          })}
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
            <h3 className="font-semibold mb-2">{inviteKind === 'organization' ? 'Invite an organization' : 'Invite a school'}</h3>
            <p className="text-sm text-earth-400 mb-4">
              {inviteKind === 'organization'
                ? "They'll get an email with a link to set their own password, then they can add their own schools. The link expires in 3 days."
                : "They'll get an email with a link to set their own password and school code. The link expires in 3 days."}
            </p>
            <div className="space-y-3">
              <input
                className="input" placeholder={inviteKind === 'organization' ? 'Organization name' : 'School name'}
                value={inviteName} onChange={(e) => setInviteName(e.target.value)}
              />
              <input
                className="input" type="email" placeholder={inviteKind === 'organization' ? 'admin@district.edu' : 'admin@school.edu'}
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

      {priceModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPriceModal(null)}>
          <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2 flex items-center gap-2"><DollarSign className="w-4 h-4 text-brand-400" /> School price</h3>
            <p className="text-sm text-earth-400 mb-4">Saved per school. Used as the default amount when you send this school a payment notice.</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Amount</label>
                  <input
                    type="text" className="input"
                    placeholder="e.g. $200"
                    value={priceAmountDraft} onChange={(e) => setPriceAmountDraft(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Billing period</label>
                  <select
                    className="input" value={pricePeriodDraft}
                    onChange={(e) => setPricePeriodDraft(e.target.value)}
                    disabled={!priceAmountDraft.trim()}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                    <option value="one_time">One-time</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setPriceModal(null)} className="btn-ghost flex-1">Cancel</button>
                <button onClick={() => savePrice(priceModal)} className="btn-primary flex-1" disabled={savingPrice}>{savingPrice ? 'Saving…' : 'Save price'}</button>
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

      {orgNoteModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setOrgNoteModal(null)}>
          <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-400" /> Internal note</h3>
            <p className="text-sm text-earth-400 mb-4">Only visible to admins — the organization never sees this.</p>
            <div className="space-y-3">
              <textarea
                className="input" rows={4}
                placeholder="e.g. Called 6/1, they're waiting on district approval for the wire"
                value={orgNoteDraft} onChange={(e) => setOrgNoteDraft(e.target.value)}
              />
              <div className="flex gap-2">
                <button onClick={() => setOrgNoteModal(null)} className="btn-ghost flex-1">Cancel</button>
                <button onClick={() => saveOrgNote(orgNoteModal)} className="btn-primary flex-1" disabled={savingOrgNote}>{savingOrgNote ? 'Saving…' : 'Save note'}</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {orgPayModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setOrgPayModal(null)}>
          <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2">Mark organization as paid</h3>
            <p className="text-sm text-earth-400 mb-4">Record how they paid (wire, check, etc.)</p>
            <div className="space-y-3">
              <textarea
                className="input" rows={3}
                placeholder="e.g. Paid via wire on June 1"
                value={orgPayNotes} onChange={(e) => setOrgPayNotes(e.target.value)}
              />
              <div className="flex gap-2">
                <button onClick={() => setOrgPayModal(null)} className="btn-ghost flex-1">Cancel</button>
                <button onClick={() => updateOrgPayment(orgPayModal, 'paid', orgPayNotes)} className="btn-primary flex-1">Mark as paid</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {dueDateModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setDueDateModal(null); setDueDateDraft('') }}>
          <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2">Payment due date</h3>
            <p className="text-sm text-earth-400 mb-4">Saved for this school only.</p>
            <div className="space-y-3">
              <input type="date" className="input" value={dueDateDraft} onChange={(e) => setDueDateDraft(e.target.value)} />
              <div className="flex gap-2">
                <button onClick={() => { setDueDateModal(null); setDueDateDraft('') }} className="btn-ghost flex-1">Cancel</button>
                {dueDateDraft && <button onClick={() => saveDueDate(dueDateModal, '')} className="btn-ghost flex-1" disabled={savingDueDate}>Clear</button>}
                <button onClick={() => saveDueDate(dueDateModal)} className="btn-primary flex-1" disabled={savingDueDate || !dueDateDraft}>{savingDueDate ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {orgPriceModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setOrgPriceModal(null)}>
          <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2 flex items-center gap-2"><DollarSign className="w-4 h-4 text-brand-400" /> Organization price</h3>
            <p className="text-sm text-earth-400 mb-4">Saved for this organization only.</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Amount</label>
                  <input
                    type="text" className="input"
                    placeholder="e.g. $2000"
                    value={orgPriceAmountDraft} onChange={(e) => setOrgPriceAmountDraft(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Billing period</label>
                  <select
                    className="input" value={orgPricePeriodDraft}
                    onChange={(e) => setOrgPricePeriodDraft(e.target.value)}
                    disabled={!orgPriceAmountDraft.trim()}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                    <option value="one_time">One-time</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setOrgPriceModal(null)} className="btn-ghost flex-1">Cancel</button>
                <button onClick={() => saveOrgPrice(orgPriceModal)} className="btn-primary flex-1" disabled={savingOrgPrice}>{savingOrgPrice ? 'Saving…' : 'Save price'}</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {orgDueDateModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setOrgDueDateModal(null); setOrgDueDateDraft('') }}>
          <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2">Payment due date</h3>
            <p className="text-sm text-earth-400 mb-4">Saved for this organization only.</p>
            <div className="space-y-3">
              <input type="date" className="input" value={orgDueDateDraft} onChange={(e) => setOrgDueDateDraft(e.target.value)} />
              <div className="flex gap-2">
                <button onClick={() => { setOrgDueDateModal(null); setOrgDueDateDraft('') }} className="btn-ghost flex-1">Cancel</button>
                {orgDueDateDraft && <button onClick={() => saveOrgDueDate(orgDueDateModal, '')} className="btn-ghost flex-1" disabled={savingOrgDueDate}>Clear</button>}
                <button onClick={() => saveOrgDueDate(orgDueDateModal)} className="btn-primary flex-1" disabled={savingOrgDueDate || !orgDueDateDraft}>{savingOrgDueDate ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {showNotifyModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setShowNotifyModal(false); setNotifySchoolId(null); setNotifyOrgId(null); setNotifyAmount(''); setNotifyBillingPeriod('monthly') }}>
          <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2">
              {notifyOrgId ? 'Notify this organization' : notifySchoolId ? 'Notify this school' : 'Notify all schools'}
            </h3>
            <p className="text-sm text-earth-400 mb-4">
              {notifyOrgId
                ? 'Sent by email to the organization\'s contact address. The due date on file is included automatically. Amount is prefilled from this organization\'s saved price — edit it here to override just this email.'
                : <>
                    Sent by email and shown on the school dashboard. The due date on file is included automatically.
                    {notifySchoolId ? ' Amount is prefilled from this school\'s saved price — edit it here to override just this email.' : ' Leave amount blank to use each school\'s own saved price; filling it in overrides every school for this send.'}
                  </>}
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Amount owed (optional)</label>
                  <input
                    type="text" className="input"
                    placeholder="e.g. $500"
                    value={notifyAmount} onChange={(e) => setNotifyAmount(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Billing period</label>
                  <select
                    className="input" value={notifyBillingPeriod}
                    onChange={(e) => setNotifyBillingPeriod(e.target.value)}
                    disabled={!notifyAmount.trim()}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                    <option value="one_time">One-time</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Payment instructions</label>
                <textarea
                  className="input" rows={3}
                  placeholder="e.g. Pay by bank transfer to Acct #1234, Routing #5678, memo: your school code"
                  value={notifyMsg} onChange={(e) => setNotifyMsg(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setShowNotifyModal(false); setNotifySchoolId(null); setNotifyOrgId(null); setNotifyAmount(''); setNotifyBillingPeriod('monthly') }} className="btn-ghost flex-1">Cancel</button>
                <button onClick={sendNotify} className="btn-primary flex-1" disabled={!notifyMsg.trim()}>Send</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {invitePreview && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setInvitePreview(null)}>
          <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2 flex items-center gap-2"><Gift className="w-4 h-4 text-brand-400" /> Send referral invites</h3>
            <p className="text-sm text-earth-400 mb-3">
              {invitePreview.wouldSend === 0
                ? 'Nobody to send to — everyone listed has already been invited.'
                : `${invitePreview.wouldSend} separate email${invitePreview.wouldSend === 1 ? '' : 's'} will be sent, one per customer.`}
            </p>
            <div className="max-h-60 overflow-y-auto rounded-xl bg-earth-500/5 p-2 space-y-1">
              {invitePreview.recipients.map((r) => (
                <div key={`${r.entityType}:${r.entityId}`} className={`text-xs flex items-center justify-between gap-2 ${r.skipped ? 'opacity-50' : ''}`}>
                  <span className="min-w-0 truncate">{r.name} <span className="text-earth-500">· {r.email}</span></span>
                  <span className="font-mono shrink-0">{r.skipped || r.code}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setInvitePreview(null)} className="btn-ghost flex-1">Cancel</button>
              <button onClick={sendInvites} disabled={sendingInvites || invitePreview.wouldSend === 0} className="btn-primary flex-1">
                {sendingInvites ? 'Sending…' : `Send ${invitePreview.wouldSend}`}
              </button>
            </div>
          </Card>
        </div>
      )}
      {invoiceModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setInvoiceModal(null)}>
          <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2 flex items-center gap-2"><Receipt className="w-4 h-4 text-brand-400" /> Send invoice</h3>
            <p className="text-sm text-earth-400 mb-4">To {invoiceModal.entityName}. Emailed immediately and added to their payment history.</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Amount</label>
                  <input
                    type="number" step="0.01" min="0" className="input"
                    placeholder="e.g. 200"
                    value={invoiceAmountDraft} onChange={(e) => setInvoiceAmountDraft(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Billing period</label>
                  <select className="input" value={invoiceBillingPeriodDraft} onChange={(e) => setInvoiceBillingPeriodDraft(e.target.value)}>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                    <option value="one_time">One-time</option>
                  </select>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label className="label">Description</label>
                  <button
                    type="button"
                    onClick={() => setInvoiceDescriptionDraft(generateInvoiceDescription({ entityName: invoiceModal.entityName, billingPeriod: invoiceBillingPeriodDraft }))}
                    className="text-xs text-brand-400 hover:text-brand-300 inline-flex items-center gap-1 mb-1"
                  >
                    <Sparkles className="w-3 h-3" /> Generate with AI
                  </button>
                </div>
                <textarea
                  className="input" rows={2}
                  placeholder="e.g. VolunTrack subscription — fall semester"
                  value={invoiceDescriptionDraft} onChange={(e) => setInvoiceDescriptionDraft(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Due date (optional)</label>
                <input type="date" className="input" value={invoiceDueDateDraft} onChange={(e) => setInvoiceDueDateDraft(e.target.value)} />
              </div>
              {invoicePromo?.credits?.length > 0 && (
                <div className="rounded-xl p-3 text-sm bg-brand-500/10 border border-brand-500/30">
                  <p className="font-medium flex items-center gap-1.5"><Gift className="w-3.5 h-3.5 text-brand-400" /> Referral credits</p>
                  <div className="mt-2 space-y-1.5">
                    {invoicePromo.credits.map((c) => (
                      <label key={c.id} className="flex items-start gap-2">
                        <input
                          type="radio"
                          name="referral-credit"
                          className="mt-0.5"
                          checked={selectedCreditId === c.id}
                          onChange={() => { setSelectedCreditId(c.id); setApplyPromoToInvoice(false) }}
                        />
                        <span>{Number(c.percent_off)}% off — for referring {c.referred_name || 'a new customer'}</span>
                      </label>
                    ))}
                    <label className="flex items-start gap-2 text-earth-500">
                      <input
                        type="radio"
                        name="referral-credit"
                        className="mt-0.5"
                        checked={selectedCreditId === ''}
                        onChange={() => setSelectedCreditId('')}
                      />
                      <span>Don&apos;t use a credit</span>
                    </label>
                  </div>
                </div>
              )}
              {invoicePromo?.offer && !selectedCreditId && (
                <div className={`rounded-xl p-3 text-sm ${invoicePromoCheck.eligible ? 'bg-brand-500/10 border border-brand-500/30' : 'bg-earth-500/5'}`}>
                  <label className={`flex items-start gap-2 ${invoicePromoCheck.eligible ? '' : 'opacity-60'}`}>
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      disabled={!invoicePromoCheck.eligible}
                      checked={applyPromoToInvoice && invoicePromoCheck.eligible}
                      onChange={(e) => setApplyPromoToInvoice(e.target.checked)}
                    />
                    <span>
                      <span className="font-medium">Apply {invoicePromo.offer.headline || 'the join offer'}</span>
                      {' — '}{promoLabel(invoicePromo.offer)}
                      {invoicePromo.offer.code && (
                        <span className="text-earth-500"> · <span className="font-mono">{invoicePromo.offer.code}</span></span>
                      )}
                    </span>
                  </label>
                  {typeof invoicePromo.remaining === 'number' && (
                    <p className="text-xs text-earth-500 mt-1.5 ml-6">
                      {invoicePromo.remaining} of {invoicePromo.offer.maxRedemptions} uses left.
                    </p>
                  )}
                  {!invoicePromoCheck.eligible && invoicePromoCheck.reason && (
                    <p className="text-xs text-earth-500 mt-1.5 ml-6">{invoicePromoCheck.reason}</p>
                  )}
                  {invoiceTotals && (
                    <p className="text-xs text-earth-600 dark:text-earth-300 mt-1.5 ml-6">
                      ${invoiceTotals.subtotal.toFixed(2)} − ${invoiceTotals.discountAmount.toFixed(2)} ={' '}
                      <strong>${invoiceTotals.total.toFixed(2)}</strong> due
                    </p>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => setInvoiceModal(null)} className="btn-ghost flex-1">Cancel</button>
                <button onClick={sendInvoice} className="btn-primary flex-1" disabled={sendingInvoice || !invoiceAmountDraft.trim() || !invoiceDescriptionDraft.trim()}>
                  {sendingInvoice ? 'Sending…' : invoiceTotals ? `Send $${invoiceTotals.total.toFixed(2)}` : 'Send invoice'}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {historyModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setHistoryModal(null)}>
          <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2 flex items-center gap-2"><History className="w-4 h-4 text-earth-400" /> Payment history</h3>
            <p className="text-sm text-earth-400 mb-4">{historyModal.entityName}</p>
            {loadingHistory ? (
              <p className="text-sm text-earth-400 py-4 text-center">Loading…</p>
            ) : historyEvents.length === 0 ? (
              <p className="text-sm text-earth-400 py-4 text-center">No invoices or payment changes yet.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {historyEvents.map((ev) => (
                  <div key={ev.id} className="p-2.5 rounded-lg bg-earth-500/5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {ev.event_type === 'invoice_sent' && `Invoice ${ev.invoice_number} sent`}
                        {ev.event_type === 'invoice_paid' && `Invoice ${ev.invoice_number} paid`}
                        {ev.event_type === 'invoice_void' && `Invoice ${ev.invoice_number} voided`}
                        {ev.event_type === 'status_paid' && 'Marked paid'}
                        {ev.event_type === 'status_unpaid' && 'Marked unpaid'}
                        {ev.event_type === 'status_rejected' && 'Payment rejected'}
                      </span>
                      {ev.amount != null && <span className="text-earth-400">${Number(ev.amount).toFixed(2)}</span>}
                    </div>
                    <p className="text-xs text-earth-400 mt-0.5">{new Date(ev.created_at).toLocaleString()}</p>
                    {ev.notes && <p className="text-xs text-earth-500 mt-1">{ev.notes}</p>}
                    {ev.event_type === 'invoice_sent' && (
                      <div className="flex gap-1 mt-2">
                        <button onClick={() => downloadInvoicePdf(ev)} className="btn-sm btn-ghost">
                          <Download className="w-3.5 h-3.5 mr-1" /> PDF
                        </button>
                        {ev.invoice_status === 'sent' && (
                          <>
                            <button onClick={() => resolveInvoice(ev.invoice_id, 'paid')} disabled={invoiceActionId === ev.invoice_id} className="btn-sm btn-primary">
                              Mark paid
                            </button>
                            <button onClick={() => resolveInvoice(ev.invoice_id, 'void')} disabled={invoiceActionId === ev.invoice_id} className="btn-sm btn-ghost text-red-400">
                              <Ban className="w-3.5 h-3.5 mr-1" /> Void
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setHistoryModal(null)} className="btn-ghost flex-1">Close</button>
            </div>
          </Card>
        </div>
      )}

      <Toast open={toast} onClose={() => setToast(false)}>{toastMessage}</Toast>
    </AppLayout>
  )
}
