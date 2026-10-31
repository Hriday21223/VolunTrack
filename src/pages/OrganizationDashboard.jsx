import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { orgTabFromPath, orgPathFor } from '@/lib/dashboardTabs.js'
import { Building2, UserPlus, School, Users, Receipt, Download, Eye, ClipboardList, UserCog, Megaphone, Handshake } from 'lucide-react'
import OrgPartners from '@/components/OrgPartners.jsx'
import HandoverForm from '@/components/HandoverForm.jsx'
import OrgAnnouncementsCard from '@/components/OrgAnnouncementsCard.jsx'
import ImpactReportCard from '@/components/ImpactReportCard.jsx'
import SchoolVsSchoolCard from '@/components/SchoolVsSchoolCard.jsx'
import { HANDOVER_ENDPOINTS } from '@/lib/handover.js'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import SpotlightTour from '@/components/SpotlightTour.jsx'
import { useAuth } from '@/hooks/useAuth.jsx'
import HoursReportPanel from '@/components/HoursReportPanel.jsx'
import { generateInvoicePDF, poLabel } from '@/lib/export.js'
import PdfPreview from '@/components/PdfPreview.jsx'
import PaymentDetails from '@/components/PaymentDetails.jsx'
import ReferralCard from '@/components/ReferralCard.jsx'
import OrgRequirements from '@/components/OrgRequirements.jsx'
import AnnouncementBanner from '@/components/AnnouncementBanner.jsx'
import CompareSchoolsCard from '@/components/CompareSchoolsCard.jsx'
import { fmtDate } from '@/utils/date.js'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

const TAB_TITLES = {
  schools: tr('Your schools'),
  hours: tr('Hour reports'),
  requirements: tr('Requirements'),
  partners: tr('Partner organizations'),
  announcements: tr('Announcements'),
  invites: tr('Pending invites'),
}

const ORG_TOUR_STEPS = [
  { selector: '[data-tour="org-schools-tab"]', title: tr('Your schools'), description: tr('Every school you’ve added lives here, along with their payment status and student counts.') },
  { selector: '[data-tour="org-add-school"]', title: tr('Add a school'), description: tr('Add a school and they get an email invite to set their own password and school code.') },
  { selector: '[data-tour="org-invites-tab"]', title: tr('Invites'), description: tr('Track invites you’ve sent — pending, set up, or expired.') },
]

// Minimal by design: an organization's dashboard only adds schools and shows
// its own school list — day-to-day management (students, PDFs, co-admins,
// payment) stays entirely on each school's own dashboard (SchoolDashboard.jsx).
export default function OrganizationDashboard() {
  const { user } = useAuth()
  // The tab lives in the address (#579): /organization/dashboard/announcements.
  const { tab: tabParam } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const tabSettled = useRef(false)
  const [tab, setTab] = useState(() => orgTabFromPath(tabParam))
  useEffect(() => { setTab(orgTabFromPath(tabParam)) }, [tabParam])
  useEffect(() => {
    const path = orgPathFor(tab)
    if (path !== location.pathname) navigate(path, { replace: !tabSettled.current || location.pathname.toLowerCase() === path })
    tabSettled.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])
  // Which school's "New principal" form is open (#550).
  const [handoverSchoolId, setHandoverSchoolId] = useState(null)
  const [schools, setSchools] = useState([])
  const [loadingSchools, setLoadingSchools] = useState(true)
  const [invites, setInvites] = useState([])
  const [loadingInvites, setLoadingInvites] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [sendingInvite, setSendingInvite] = useState(false)
  const [toast, setToast] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [invoices, setInvoices] = useState([])
  // Invoice currently open in the preview overlay, or null.
  const [previewInvoice, setPreviewInvoice] = useState(null)
  const [orgName, setOrgName] = useState('')
  const [accountCode, setAccountCode] = useState(null)

  const loadInvoices = useCallback(async () => {
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/invoices/mine`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const data = await res.json()
      setInvoices(data.invoices || [])
      if (data.entityName) setOrgName(data.entityName)
      setAccountCode(data.accountCode || null)
    } catch {}
  }, [])

  const loadSchools = useCallback(async () => {
    setLoadingSchools(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/organization/schools`, {
        headers: { Authorization: `Bearer ${token}` },
      })
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
      const res = await fetch(`${apiUrl}/organization/invites`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const data = await res.json()
      setInvites(data.invites || [])
    } catch {} finally {
      setLoadingInvites(false)
    }
  }, [])
  // Invites load whenever that tab opens, including from its address.
  useEffect(() => { if (tab === 'invites') loadInvites() }, [tab, loadInvites])

  useEffect(() => {
    if (!user) return
    loadSchools()
    loadInvoices()
  }, [user, loadSchools, loadInvoices])

  const sendInvite = async () => {
    if (!inviteName.trim() || !inviteEmail.trim()) return
    setSendingInvite(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/organization/invite-school`, {
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

  return (
    <AppLayout
      title={TAB_TITLES[tab] || tr('Your schools')}
      subtitle={
        tab === 'schools' ? `${schools.length} school${schools.length === 1 ? '' : 's'} added`
          : tab === 'invites' ? `${invites.length} invite${invites.length === 1 ? '' : 's'} sent`
          : tab === 'requirements' ? tr('Defaults for every school you own')
          : tab === 'announcements' ? tr('Notices for every school you own')
          : tab === 'partners' ? tr('Nonprofits shared with every school you own')
          : tr('Export hours across your schools')
      }
      action={
        <div className="flex flex-wrap gap-2">
          <button data-tour="org-schools-tab" onClick={() => setTab('schools')} className={`btn-sm ${tab === 'schools' ? 'btn-primary' : 'btn-ghost'}`}>
            <School className="w-3.5 h-3.5 mr-1" />{' '}{tr('Schools')}
          </button>
          <button onClick={() => setTab('hours')} className={`btn-sm ${tab === 'hours' ? 'btn-primary' : 'btn-ghost'}`}>
            <Download className="w-3.5 h-3.5 mr-1" />{' '}{tr('Hours')}
          </button>
          <button onClick={() => setTab('requirements')} className={`btn-sm ${tab === 'requirements' ? 'btn-primary' : 'btn-ghost'}`}>
            <ClipboardList className="w-3.5 h-3.5 mr-1" />{' '}{tr('Requirements')}
          </button>
          <button onClick={() => setTab('partners')} className={`btn-sm ${tab === 'partners' ? 'btn-primary' : 'btn-ghost'}`}>
            <Handshake className="w-3.5 h-3.5 mr-1" />{' '}{tr('Partners')}
          </button>
          <button onClick={() => setTab('announcements')} className={`btn-sm ${tab === 'announcements' ? 'btn-primary' : 'btn-ghost'}`}>
            <Megaphone className="w-3.5 h-3.5 mr-1" />{' '}{tr('Announcements')}
          </button>
          <button data-tour="org-invites-tab" onClick={() => setTab('invites')} className={`btn-sm ${tab === 'invites' ? 'btn-primary' : 'btn-ghost'}`}>
            <UserPlus className="w-3.5 h-3.5 mr-1" />{' '}{tr('Invites')}
          </button>
        </div>
      }
    >
      <AnnouncementBanner />
      {tab === 'requirements' && <OrgRequirements schools={schools} onSchoolsChange={loadSchools} />}
      {tab === 'announcements' && <OrgAnnouncementsCard />}
      {tab === 'partners' && <OrgPartners />}

      {tab === 'hours' && (
        <Card>
          <h2 className="text-lg font-semibold mb-1">{tr('Hour reports')}</h2>
          <p className="text-sm text-slate-500 mb-4">
            {tr('Export logged hours across every school in your organization for a date range.')}
          </p>
          <HoursReportPanel title={tr('Organization volunteer hours report')} />
        </Card>
      )}
      {tab === 'hours' && <ImpactReportCard scope="organization" className="mt-4" />}

      {tab === 'schools' && !loadingSchools && (
        <SpotlightTour storageKey="voluntrack:tour-seen:org" steps={ORG_TOUR_STEPS} />
      )}
      {tab === 'schools' && <ReferralCard className="mb-4" />}
      {tab === 'schools' && accountCode && (
        <Card className="mb-4">
          <PaymentDetails accountCode={accountCode} />
        </Card>
      )}
      {tab === 'schools' && invoices.length > 0 && (
        <Card className="mb-4">
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
                      entityName: orgName,
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
      {/* This used to be a plain schools/else ternary, so every tab added
          since — Hours, and now Requirements — rendered the invites list
          underneath it. Name the tab it belongs to instead. */}
      {tab === 'schools' ? (
        loadingSchools ? (
          <Card><p className="text-center text-earth-400 py-8">{tr('Loading schools…')}</p></Card>
        ) : schools.length === 0 ? (
          <Card>
            <div className="text-center py-12 text-earth-500">
              <Building2 className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-earth-900 dark:text-earth-100">{tr('No schools yet')}</p>
              <p className="text-sm mt-1">{tr('Add a school and they\'ll get an email to finish setting up their own account.')}</p>
              <button data-tour="org-add-school" onClick={() => setShowInviteModal(true)} className="btn-primary inline-flex mt-4">
                <UserPlus className="w-3.5 h-3.5 mr-1" />{' '}{tr('Add a school')}
              </button>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {schools.length > 1 && <CompareSchoolsCard />}
            {schools.length > 1 && <SchoolVsSchoolCard manage />}
            <div className="flex justify-end mb-4">
              <button data-tour="org-add-school" onClick={() => setShowInviteModal(true)} className="btn-sm btn-primary">
                <UserPlus className="w-3.5 h-3.5 mr-1" />{' '}{tr('Add school')}
              </button>
            </div>
            {schools.map((s) => (
              <Card key={s.id} padded={false} className="p-4">
                <div className="flex items-center gap-3">
                  <School className="w-8 h-8 text-brand-600 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{s.name}</p>
                    <p className="text-xs text-earth-400">
                      {tr('Code:')}{' '}<span className="font-mono">{s.pin}</span>
                      {s.contact_email && ` · ${s.contact_email}`}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      <span className="text-xs text-earth-500">
                        <Users className="w-3 h-3 inline mr-1" />
                        {s.student_count === 1 ? tr('1 student') : tr('{n} students', { n: s.student_count })}{' · '}
                        {tr('Added {date}', { date: new Date(s.created_at).toLocaleDateString() })}
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
                        {s.payment_status === 'paid' ? tr('Paid') : s.payment_status === 'pending' ? tr('Pending review') : s.payment_status === 'rejected' ? tr('Rejected') : tr('Unpaid')}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost btn-sm ml-auto shrink-0"
                    onClick={() => setHandoverSchoolId(handoverSchoolId === s.id ? null : s.id)}
                  >
                    <UserCog className="w-3.5 h-3.5 mr-1" />{' '}{tr('New principal')}
                  </button>
                </div>
                {handoverSchoolId === s.id && (
                  <div className="mt-3 border-t border-earth-200 dark:border-white/10 pt-3">
                    <p className="text-xs text-earth-500 mb-2">
                      {tr('The new principal gets an email to accept and becomes the main admin of {school}. The current one stays as a co-admin and is signed out.', { school: s.name })}
                    </p>
                    <HandoverForm path={HANDOVER_ENDPOINTS.orgSchool(s.id)} place={s.name} onCancel={() => setHandoverSchoolId(null)} />
                  </div>
                )}
              </Card>
            ))}
          </div>
        )
      ) : tab === 'invites' ? (
        loadingInvites ? (
          <Card><p className="text-center text-earth-400 py-8">{tr('Loading invites…')}</p></Card>
        ) : invites.length === 0 ? (
          <Card>
            <div className="text-center py-12 text-earth-500">
              <UserPlus className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-earth-900 dark:text-earth-100">{tr('No invites sent')}</p>
              <p className="text-sm mt-1">{tr('Add a school and they\'ll get a link to finish setup themselves.')}</p>
              <button onClick={() => setShowInviteModal(true)} className="btn-primary inline-flex mt-4">
                <UserPlus className="w-3.5 h-3.5 mr-1" />{' '}{tr('Add a school')}
              </button>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end mb-4">
              <button onClick={() => setShowInviteModal(true)} className="btn-sm btn-primary">
                <UserPlus className="w-3.5 h-3.5 mr-1" />{' '}{tr('Add school')}
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
                        <span className="text-xs text-earth-500">{tr('Sent')}{' '}{new Date(inv.created_at).toLocaleDateString()}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          inv.effective_status === 'completed'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : inv.effective_status === 'expired'
                            ? 'bg-red-500/10 text-red-400'
                            : 'bg-amber-500/10 text-amber-400'
                        }`}>
                          {inv.effective_status === 'completed' ? tr('Set up') : inv.effective_status === 'expired' ? tr('Expired') : tr('Pending')}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : null}

      {tab === 'schools' && !loadingSchools && (
        <Card className="mt-4">
          <h3 className="font-semibold mb-1 flex items-center gap-2"><UserCog className="w-4 h-4 text-brand-600" />{' '}{tr('Someone new running the organization?')}</h3>
          <p className="text-sm text-earth-500 mb-3">
            {tr('Hand this organization’s account to them. They get an email to accept and set their own password. When they do, this login is removed from the organization and signed out.')}
          </p>
          <HandoverForm path={HANDOVER_ENDPOINTS.org()} role="director" />
        </Card>
      )}

      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowInviteModal(false)}>
          <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2">{tr('Add a school')}</h3>
            <p className="text-sm text-earth-400 mb-4">{tr('They\'ll get an email with a link to set their own password and school code. The link expires in 3 days.')}</p>
            <div className="space-y-3">
              <input
                className="input" placeholder={tr('School name')}
                value={inviteName} onChange={(e) => setInviteName(e.target.value)}
              />
              <input
                className="input" type="email" placeholder="admin@school.edu"
                value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
              />
              <div className="flex gap-2">
                <button onClick={() => setShowInviteModal(false)} className="btn-ghost flex-1">{tr('Cancel')}</button>
                <button onClick={sendInvite} className="btn-primary flex-1" disabled={sendingInvite || !inviteName.trim() || !inviteEmail.trim()}>
                  {sendingInvite ? tr('Sending…') : tr('Send invite')}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      <Toast open={toast} onClose={() => setToast(false)}>{toastMessage}</Toast>

      {previewInvoice && (
        <PdfPreview
          title={`Invoice ${previewInvoice.invoice_number}`}
          filename={`${previewInvoice.invoice_number}.pdf`}
          getBlob={() => generateInvoicePDF({
            invoiceNumber: previewInvoice.invoice_number,
            poNumber: previewInvoice.po_number,
            entityName: orgName,
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
