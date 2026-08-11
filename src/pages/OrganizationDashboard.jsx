import { useState, useEffect, useCallback } from 'react'
import { Building2, UserPlus, School, Users } from 'lucide-react'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import { useAuth } from '@/hooks/useAuth.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// Minimal by design: an organization's dashboard only adds schools and shows
// its own school list — day-to-day management (students, PDFs, co-admins,
// payment) stays entirely on each school's own dashboard (SchoolDashboard.jsx).
export default function OrganizationDashboard() {
  const { user } = useAuth()
  const [tab, setTab] = useState('schools')
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

  useEffect(() => {
    if (!user) return
    loadSchools()
  }, [user, loadSchools])

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
      setToastMessage('Invite sent'); setToast(true)
    } catch (e) { setToastMessage(e.message || 'Failed to send invite'); setToast(true) } finally { setSendingInvite(false) }
  }

  return (
    <AppLayout
      title={tab === 'schools' ? 'Your schools' : 'Pending invites'}
      subtitle={tab === 'schools' ? `${schools.length} school${schools.length === 1 ? '' : 's'} added` : `${invites.length} invite${invites.length === 1 ? '' : 's'} sent`}
      action={
        <div className="flex gap-2">
          <button onClick={() => setTab('schools')} className={`btn-sm ${tab === 'schools' ? 'btn-primary' : 'btn-ghost'}`}>
            <School className="w-3.5 h-3.5 mr-1" /> Schools
          </button>
          <button onClick={() => { setTab('invites'); loadInvites() }} className={`btn-sm ${tab === 'invites' ? 'btn-primary' : 'btn-ghost'}`}>
            <UserPlus className="w-3.5 h-3.5 mr-1" /> Invites
          </button>
        </div>
      }
    >
      {tab === 'schools' ? (
        loadingSchools ? (
          <Card><p className="text-center text-earth-400 py-8">Loading schools…</p></Card>
        ) : schools.length === 0 ? (
          <Card>
            <div className="text-center py-12 text-earth-500">
              <Building2 className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-earth-900 dark:text-earth-100">No schools yet</p>
              <p className="text-sm mt-1">Add a school and they'll get an email to finish setting up their own account.</p>
              <button onClick={() => setShowInviteModal(true)} className="btn-primary inline-flex mt-4">
                <UserPlus className="w-3.5 h-3.5 mr-1" /> Add a school
              </button>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end mb-4">
              <button onClick={() => setShowInviteModal(true)} className="btn-sm btn-primary">
                <UserPlus className="w-3.5 h-3.5 mr-1" /> Add school
              </button>
            </div>
            {schools.map((s) => (
              <Card key={s.id} padded={false} className="p-4">
                <div className="flex items-center gap-3">
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
                        Added {new Date(s.created_at).toLocaleDateString()}
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
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : (
        loadingInvites ? (
          <Card><p className="text-center text-earth-400 py-8">Loading invites…</p></Card>
        ) : invites.length === 0 ? (
          <Card>
            <div className="text-center py-12 text-earth-500">
              <UserPlus className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-earth-900 dark:text-earth-100">No invites sent</p>
              <p className="text-sm mt-1">Add a school and they'll get a link to finish setup themselves.</p>
              <button onClick={() => setShowInviteModal(true)} className="btn-primary inline-flex mt-4">
                <UserPlus className="w-3.5 h-3.5 mr-1" /> Add a school
              </button>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end mb-4">
              <button onClick={() => setShowInviteModal(true)} className="btn-sm btn-primary">
                <UserPlus className="w-3.5 h-3.5 mr-1" /> Add school
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
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowInviteModal(false)}>
          <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2">Add a school</h3>
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

      <Toast open={toast} onClose={() => setToast(false)}>{toastMessage}</Toast>
    </AppLayout>
  )
}
