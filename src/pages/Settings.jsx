import { useState, useEffect, useRef, Fragment } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Moon, Sun, Plus, Trash2, Star, LogOut, Bell, ShieldCheck, Info, Lock, Shield, School, Copy, Eye, EyeOff, QrCode, Upload, Sparkles, CheckCircle2, ChevronDown, Users, X, MessageSquare } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth.jsx'
import { useData } from '@/hooks/useData.jsx'
import { useTheme } from '@/hooks/useTheme.js'
import { hashPin, sendPasswordResetCode, clearPasswordResetCode, createLog } from '@/api/index.js'
import { buildDemoLogs, buildDemoGoals, buildDemoReminders } from '@/lib/demoData.js'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import QRCode from 'qrcode'

function CollapsibleSection({ icon: Icon, label, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-4 py-3 rounded-xl bg-white/50 dark:bg-white/[0.03] border border-earth-200/60 dark:border-white/[0.06] hover:bg-earth-50 dark:hover:bg-white/[0.06] transition-colors"
      >
        <Icon className="w-4 h-4 text-brand-600 dark:text-brand-400" />
        <span className="font-display font-semibold text-sm flex-1 text-left">{label}</span>
        <ChevronDown className={`w-4 h-4 text-earth-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="mt-2 grid lg:grid-cols-2 gap-5">{children}</div>}
    </div>
  )
}

export default function Settings() {
  const { theme, setTheme, toggle } = useTheme()
  const { user, logout, deleteAccount, updateProfile, setSyncPin: setSyncPinAuth, setupTotp, verifyTotpSetup, disableTotp, setupSms, resendSmsSetup, verifySmsSetup, disableSms } = useAuth()
  const { goals, saveGoal, removeGoal, logs } = useData()
  const nav = useNavigate()
  const [newGoal, setNewGoal] = useState({ title: '', targetHours: 50, primary: false })
  const [toast, setToast] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [pinSaved, setPinSaved] = useState(false)
  const [displaySyncPin, setDisplaySyncPin] = useState('')
  const [showSyncPin, setShowSyncPin] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [syncPassword, setSyncPassword] = useState('')
  const [showSyncPasswordPrompt, setShowSyncPasswordPrompt] = useState(false)
  const [showPwText, setShowPwText] = useState(false)
  const [syncPasswordBusy, setSyncPasswordBusy] = useState(false)
  const [schoolCode, setSchoolCode] = useState('')
  const [schoolName, setSchoolName] = useState('')
  const [schoolBusy, setSchoolBusy] = useState(false)
  const [childLinkCode, setChildLinkCode] = useState(null)
  const [childLinkBusy, setChildLinkBusy] = useState(false)
  const [linkChildInput, setLinkChildInput] = useState('')
  const [linkChildBusy, setLinkChildBusy] = useState(false)
  const [linkChildErr, setLinkChildErr] = useState('')
  const [linkedChildren, setLinkedChildren] = useState([])
  const [pdfs, setPdfs] = useState([])
  const [showSchool, setShowSchool] = useState(false)
  const [schoolInfo, setSchoolInfo] = useState(null)
  const [showQR, setShowQR] = useState(false)
  const qrCanvasRef = useRef(null)

  // 2FA state
  const [totpSetup, setTotpSetup] = useState(null) // { secret, uri, backupCodes }
  const [totpCode, setTotpCode] = useState('')
  const [totpBusy, setTotpBusy] = useState(false)
  const [totpErr, setTotpErr] = useState('')
  const [totpDone, setTotpDone] = useState(false)
  const [disablePw, setDisablePw] = useState('')
  const [showDisableForm, setShowDisableForm] = useState(false)
  const totpQrRef = useRef(null)

  // SMS 2FA state
  const [smsPhone, setSmsPhone] = useState('')
  const [smsSetupPending, setSmsSetupPending] = useState(false)
  const [smsCode, setSmsCode] = useState('')
  const [smsBusy, setSmsBusy] = useState(false)
  const [smsErr, setSmsErr] = useState('')
  const [smsDone, setSmsDone] = useState(false)
  const [smsDevCode, setSmsDevCode] = useState('')
  const [smsResendMsg, setSmsResendMsg] = useState('')
  const [smsDisablePw, setSmsDisablePw] = useState('')
  const [showSmsDisableForm, setShowSmsDisableForm] = useState(false)

  useEffect(() => {
    if (showQR && displaySyncPin && qrCanvasRef.current) {
      QRCode.toCanvas(qrCanvasRef.current, displaySyncPin, {
        width: 200,
        margin: 2,
        color: { dark: '#111827', light: '#ffffff' },
      })
    }
  }, [showQR, displaySyncPin])

  useEffect(() => {
    if (totpSetup?.uri && totpQrRef.current) {
      QRCode.toCanvas(totpQrRef.current, totpSetup.uri, {
        width: 180,
        margin: 2,
        color: { dark: '#111827', light: '#ffffff' },
      })
    }
  }, [totpSetup?.uri])

  const handleSetupTotp = async () => {
    setTotpErr('')
    setTotpBusy(true)
    try {
      const data = await setupTotp()
      setTotpSetup(data)
    } catch (e) {
      setTotpErr(e.message)
    } finally {
      setTotpBusy(false)
    }
  }

  const handleVerifyTotpSetup = async (e) => {
    e.preventDefault()
    setTotpErr('')
    setTotpBusy(true)
    try {
      await verifyTotpSetup(totpCode)
      setTotpDone(true)
      setTotpSetup(null)
      setTotpCode('')
    } catch (e) {
      setTotpErr(e.message)
    } finally {
      setTotpBusy(false)
    }
  }

  const handleDisableTotp = async (e) => {
    e.preventDefault()
    setTotpErr('')
    setTotpBusy(true)
    try {
      await disableTotp(disablePw)
      setShowDisableForm(false)
      setDisablePw('')
      setToastMessage('2FA disabled')
      setToast(true)
    } catch (e) {
      setTotpErr(e.message)
    } finally {
      setTotpBusy(false)
    }
  }

  const handleSetupSms = async (e) => {
    e.preventDefault()
    setSmsErr('')
    setSmsBusy(true)
    try {
      const data = await setupSms(smsPhone)
      setSmsDevCode(data.devCode || '')
      setSmsSetupPending(true)
    } catch (e) {
      setSmsErr(e.message)
    } finally {
      setSmsBusy(false)
    }
  }

  const handleResendSmsSetup = async () => {
    setSmsErr('')
    setSmsResendMsg('')
    try {
      const data = await resendSmsSetup()
      setSmsDevCode(data.devCode || '')
      setSmsResendMsg('A new code was sent.')
      setTimeout(() => setSmsResendMsg(''), 4000)
    } catch (e) {
      setSmsErr(e.message)
    }
  }

  const handleVerifySmsSetup = async (e) => {
    e.preventDefault()
    setSmsErr('')
    setSmsBusy(true)
    try {
      await verifySmsSetup(smsCode)
      setSmsDone(true)
      setSmsSetupPending(false)
      setSmsCode('')
      setSmsPhone('')
      setSmsDevCode('')
    } catch (e) {
      setSmsErr(e.message)
    } finally {
      setSmsBusy(false)
    }
  }

  const handleDisableSms = async (e) => {
    e.preventDefault()
    setSmsErr('')
    setSmsBusy(true)
    try {
      await disableSms(smsDisablePw)
      setShowSmsDisableForm(false)
      setSmsDisablePw('')
      setToastMessage('SMS 2FA disabled')
      setToast(true)
    } catch (e) {
      setSmsErr(e.message)
    } finally {
      setSmsBusy(false)
    }
  }

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    setIsMobile(mq.matches)
    const handler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Load sync PIN from user profile on mount
  useEffect(() => {
    if (user?.syncPin) {
      setDisplaySyncPin(user.syncPin)
      setShowSyncPin(true)
    }
  }, [user?.syncPin])

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('')
  const [pwForm, setPwForm] = useState({ current: '', newPw: '', confirm: '' })
  const [showPw, setShowPw] = useState(false)
  const [pwBusy, setPwBusy] = useState(false)
  const [pwError, setPwError] = useState('')
  const [pwDone, setPwDone] = useState(false)

  const addGoal = (e) => {
    e.preventDefault()
    if (!newGoal.title.trim()) return
    saveGoal({ ...newGoal, title: newGoal.title.trim(), targetHours: Number(newGoal.targetHours) || 0 })
    setNewGoal({ title: '', targetHours: 50, primary: false })
    setToastMessage('Goal added')
    setToast(true)
  }

  const onChangePassword = async (e) => {
    e.preventDefault()
    setPwError('')
    setPwDone(false)
    if (!pwForm.current || !pwForm.newPw || !pwForm.confirm) { setPwError('Fill in all fields.'); return }
    if (pwForm.newPw.length < 6) { setPwError('New password must be at least 6 characters.'); return }
    if (pwForm.newPw !== pwForm.confirm) { setPwError('Passwords do not match.'); return }
    setPwBusy(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const apiUrl = import.meta.env.VITE_API_URL || '/api'
      const res = await fetch(`${apiUrl}/auth/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ email: user.email, currentPassword: pwForm.current, newPassword: pwForm.newPw }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update password')
      }
      setPwForm({ current: '', newPw: '', confirm: '' })
      setPwDone(true)
    } catch (err) {
      setPwError(err.message)
    } finally {
      setPwBusy(false)
    }
  }

  const handleDeleteAccount = () => {
    if (!user) return
    deleteAccount()
    nav('/login')
  }

  useEffect(() => {
    if (!user?.schoolId) return
    ;(async () => {
      try {
        const res = await fetch(`${apiUrl}/school/info?id=${user.schoolId}`)
        if (!res.ok) return
        const data = await res.json()
        if (data.school) setSchoolInfo(data.school)
      } catch {}
    })()
  }, [user?.schoolId])

  const familyApiUrl = import.meta.env.VITE_API_URL || '/api'
  const authHeaders = () => {
    const token = localStorage.getItem('voluntrack:auth_token')
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  }

  useEffect(() => {
    if (user?.role !== 'student') return
    ;(async () => {
      try {
        const res = await fetch(`${familyApiUrl}/parent/child-link-code`, { headers: authHeaders() })
        if (!res.ok) return
        const data = await res.json()
        setChildLinkCode(data.childLinkCode)
      } catch {}
    })()
  }, [user?.role])

  const loadLinkedChildren = async () => {
    try {
      const res = await fetch(`${familyApiUrl}/parent/children`, { headers: authHeaders() })
      if (!res.ok) return
      const data = await res.json()
      setLinkedChildren(data.children || [])
    } catch {}
  }

  useEffect(() => {
    if (user?.role !== 'parent') return
    loadLinkedChildren()
  }, [user?.role])

  const generateChildLinkCode = async () => {
    setChildLinkBusy(true)
    try {
      const res = await fetch(`${familyApiUrl}/parent/child-link-code`, { method: 'POST', headers: authHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not generate a code.')
      setChildLinkCode(data.childLinkCode)
      setToastMessage('Code generated')
      setToast(true)
    } catch (error) {
      setToastMessage(error.message)
      setToast(true)
    } finally {
      setChildLinkBusy(false)
    }
  }

  const linkChild = async () => {
    if (!linkChildInput.trim()) return
    setLinkChildBusy(true)
    setLinkChildErr('')
    try {
      const res = await fetch(`${familyApiUrl}/parent/link`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ code: linkChildInput.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not link to that student.')
      setLinkChildInput('')
      setToastMessage(`Linked to ${data.child?.name || 'student'}`)
      setToast(true)
      loadLinkedChildren()
    } catch (error) {
      setLinkChildErr(error.message)
    } finally {
      setLinkChildBusy(false)
    }
  }

  const unlinkChild = async (childId) => {
    try {
      await fetch(`${familyApiUrl}/parent/children/${childId}`, { method: 'DELETE', headers: authHeaders() })
      loadLinkedChildren()
    } catch {}
  }

  const savePin = () => {
    if (!user) return
    if (!/^[0-9]{4}$/.test(pin)) return
    if (pin !== pinConfirm) return
    updateProfile({ pinHash: hashPin(pin) })
    setPin('')
    setPinConfirm('')
    setPinSaved(true)
    setToastMessage('PIN saved')
    setToast(true)
  }

  const makePrimary = (id) => {
    goals.forEach((g) => saveGoal({ ...g, primary: g.id === id }))
  }

  const generateSyncPin = async () => {
    try {
      const newPin = Math.floor(10000 + Math.random() * 90000).toString()

      const token = localStorage.getItem('voluntrack:auth_token')
      if (!token) {
        setSyncPassword('')
        setShowSyncPasswordPrompt(true)
        setDisplaySyncPin(newPin)
        return
      }

      await setSyncPinAuth(newPin)
      setDisplaySyncPin(newPin)
      setShowSyncPin(true)
      setToastMessage('Sync PIN generated')
      setToast(true)
    } catch (error) {
      setToastMessage(error.message || 'Failed to generate sync PIN')
      setToast(true)
    }
  }

  const confirmSyncPin = async () => {
    if (!syncPassword) return
    if (!displaySyncPin) return
    setSyncPasswordBusy(true)
    const apiUrl = import.meta.env.VITE_API_URL || '/api'
    try {
      const response = await fetch(`${apiUrl}/auth/sync-pin-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: syncPassword, syncPin: displaySyncPin }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to link account')

      localStorage.setItem('voluntrack:auth_token', data.token)
      setShowSyncPin(true)
      setShowSyncPasswordPrompt(false)
      setSyncPassword('')
      setToastMessage('Account linked! Sync PIN generated.')
      setToast(true)
      return
    } catch (error) {
      // If password is incorrect, try to sync the database password
      // using a locally-generated recovery code
      if (error.message === 'Password is incorrect.') {
        try {
          const updated = sendPasswordResetCode(user.email)
          if (updated && updated.resetPasswordCode) {
            const code = updated.resetPasswordCode
            const sendRes = await fetch(`${apiUrl}/send-reset-email`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: user.email, code, type: 'password' }),
            })
            if (sendRes.ok || sendRes.status === 500 || sendRes.status === 503) {
              const resetRes = await fetch(`${apiUrl}/auth/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: user.email, code, newPassword: syncPassword }),
              })
              if (resetRes.ok) {
                clearPasswordResetCode(user.email)
                const retryRes = await fetch(`${apiUrl}/auth/sync-pin-auth`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: user.email, password: syncPassword, syncPin: displaySyncPin }),
                })
                const retryData = await retryRes.json()
                if (retryRes.ok) {
                  localStorage.setItem('voluntrack:auth_token', retryData.token)
                  setShowSyncPin(true)
                  setShowSyncPasswordPrompt(false)
                  setSyncPassword('')
                  setToastMessage('Password synced! Sync PIN generated.')
                  setToast(true)
                  return
                }
              }
            }
          }
        } catch {
          // fall through to error message below
        }
      }
      setToastMessage(error.message || 'Failed to link account')
      setToast(true)
    } finally {
      setSyncPasswordBusy(false)
    }
  }

  const copySyncPin = () => {
    navigator.clipboard.writeText(displaySyncPin)
    setToastMessage('PIN copied to clipboard')
    setToast(true)
  }

  return (
    <AppLayout title="Settings" subtitle="Make VolunTrack your own.">
      <div className="space-y-3">

        <CollapsibleSection icon={Star} label="Goals & Data" defaultOpen={true}>
          <Card>
            <h3 className="font-display font-semibold mb-3 flex items-center gap-2"><Star className="w-4 h-4 text-amber-500" /> Goals</h3>
            <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">Set a target and we'll track your progress toward it. The primary goal powers your dashboard ring.</p>

            {goals.length === 0 ? (
              <div className="text-sm text-earth-500 dark:text-earth-400 py-4 text-center border border-dashed border-earth-200 dark:border-[#243529] rounded-xl mb-4">
                No goals yet — add one below.
              </div>
            ) : (
              <ul className="space-y-2 mb-4">
                {goals.map((g) => (
                  <li key={g.id} className="flex items-center gap-3 p-3 rounded-xl border border-earth-100 dark:border-[#1f2e25]">
                    <button
                      onClick={() => makePrimary(g.id)}
                      className={`w-5 h-5 rounded-full border-2 ${g.primary ? 'bg-brand-500 border-brand-500' : 'border-earth-300 dark:border-[#3a4a3f]'}`}
                      title={g.primary ? 'Primary goal' : 'Make primary'}
                      aria-label="Toggle primary"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{g.title}</div>
                      <div className="text-xs text-earth-500 dark:text-earth-400">{g.targetHours}h target</div>
                    </div>
                    <button onClick={() => removeGoal(g.id)} className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={addGoal} className="grid sm:grid-cols-[1fr_120px_auto] gap-2">
              <input
                className="input" placeholder="Goal title (e.g. 50 hours by June)"
                value={newGoal.title} onChange={(e) => setNewGoal((g) => ({ ...g, title: e.target.value }))}
              />
              <input
                type="number" min="1" className="input"
                value={newGoal.targetHours} onChange={(e) => setNewGoal((g) => ({ ...g, targetHours: e.target.value }))}
              />
              <button className="btn-primary"><Plus className="w-4 h-4" /> Add</button>
            </form>
          </Card>

          <Card className="border border-dashed border-brand-700/30 bg-brand-900/5">
            <h3 className="font-display font-semibold mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4 text-brand-400" /> Demo data</h3>
            <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
              Populate your account with sample logs, goals, and reminders to explore the app before adding your own data.
            </p>
            <button
              onClick={() => {
                const existing = logs.length
                if (existing > 0 && !confirm('This will add demo data alongside your existing logs. Continue?')) return
                buildDemoLogs().forEach((l) => createLog(l))
                buildDemoGoals().forEach((g) => saveGoal(g))
                setToastMessage('Demo data loaded! Refresh to see it.')
                setToast(true)
              }}
              className="btn-primary inline-flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" /> Load demo data
            </button>
          </Card>
        </CollapsibleSection>

        <CollapsibleSection icon={Lock} label="Account & Security" defaultOpen={true}>
          <Card>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center text-brand-600 dark:text-brand-400 font-display font-bold text-sm uppercase">
                {user?.name?.charAt(0) || '?'}
              </div>
              <div>
                <p className="font-medium">{user?.name || 'User'}</p>
                <p className="text-xs text-earth-400">{user?.email}</p>
              </div>
              <span className="ml-auto text-xs px-2.5 py-1 rounded-full bg-brand-500/10 text-brand-500 dark:text-brand-400 font-medium capitalize">
                {user?.role || 'student'}
              </span>
            </div>
          </Card>
          <Card>
            <h3 className="font-display font-semibold mb-3 flex items-center gap-2"><Lock className="w-4 h-4 text-brand-600" /> Change password</h3>
            <form onSubmit={onChangePassword} className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="label flex items-center gap-1.5"><Lock className="w-4 h-4" /> Current password</label>
                <input type={showPw ? 'text' : 'password'} className="input" value={pwForm.current} onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))} required />
              </div>
              <div>
                <label className="label flex items-center gap-1.5"><Lock className="w-4 h-4" /> New password</label>
                <input type={showPw ? 'text' : 'password'} className="input" value={pwForm.newPw} onChange={(e) => setPwForm((f) => ({ ...f, newPw: e.target.value }))} required minLength={6} />
              </div>
              <div>
                <label className="label flex items-center gap-1.5"><Lock className="w-4 h-4" /> Confirm new</label>
                <div className="flex gap-2">
                  <input type={showPw ? 'text' : 'password'} className="input flex-1" value={pwForm.confirm} onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))} required />
                  <button type="button" onClick={() => setShowPw(!showPw)} className="btn-ghost px-2" title={showPw ? 'Hide' : 'Show'}>
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {pwError && <div className="sm:col-span-3 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg">{pwError}</div>}
              {pwDone && <div className="sm:col-span-3 text-sm text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-300 px-3 py-2 rounded-lg flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Password updated</div>}
              <div className="sm:col-span-3">
                <button className="btn-primary" type="submit" disabled={pwBusy}>
                  {pwBusy ? 'Updating\u2026' : 'Update password'}
                </button>
              </div>
            </form>
          </Card>

          <Card>
            <h3 className="font-display font-semibold mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-brand-600" /> Two-Factor Authentication</h3>
            <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
              Add an extra layer of security to your account by requiring a code from your authenticator app when you sign in.
            </p>

            {user?.totpEnabled ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <span className="text-sm font-medium text-emerald-300">2FA is enabled</span>
                </div>
                {showDisableForm ? (
                  <form onSubmit={handleDisableTotp} className="space-y-3">
                    <p className="text-sm text-earth-400">Enter your password to disable 2FA:</p>
                    <input
                      type="password"
                      value={disablePw}
                      onChange={(e) => setDisablePw(e.target.value)}
                      placeholder="Your password"
                      className="input w-full"
                      required
                    />
                    {totpErr && <div className="text-sm text-red-400">{totpErr}</div>}
                    <div className="flex gap-2">
                      <button type="submit" disabled={totpBusy} className="btn-danger flex-1">
                        {totpBusy ? 'Disabling…' : 'Disable 2FA'}
                      </button>
                      <button type="button" onClick={() => { setShowDisableForm(false); setDisablePw(''); setTotpErr('') }} className="btn-ghost flex-1">
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <button onClick={() => setShowDisableForm(true)} className="btn-ghost w-full text-red-400 hover:text-red-300">
                    Disable 2FA
                  </button>
                )}
              </div>
            ) : totpSetup ? (
              <div className="space-y-4">
                <div className="text-center">
                  <p className="text-sm text-earth-400 mb-3">Scan this QR code with your authenticator app:</p>
                  <div className="flex justify-center p-4 bg-white rounded-xl">
                    <canvas ref={totpQrRef} />
                  </div>
                  <p className="text-xs text-earth-500 mt-2">Or enter this code manually:</p>
                  <p className="font-mono text-sm text-earth-300 bg-slate-900/50 px-3 py-1.5 rounded-lg mt-1 select-all">{totpSetup.secret}</p>
                </div>

                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <p className="text-xs font-semibold text-amber-300 mb-1">Save your backup codes</p>
                  <p className="text-xs text-amber-200/80 mb-2">Store these safely. Each code can only be used once if you lose access to your authenticator.</p>
                  <div className="grid grid-cols-2 gap-1">
                    {totpSetup.backupCodes.map((code, i) => (
                      <code key={i} className="text-xs font-mono text-amber-100 bg-slate-900/50 px-2 py-1 rounded text-center">{code}</code>
                    ))}
                  </div>
                </div>

                <form onSubmit={handleVerifyTotpSetup} className="space-y-3">
                  <label className="label">Enter the 6-digit code from your app to confirm</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="input w-full text-center text-lg tracking-widest font-mono"
                    autoFocus
                  />
                  {totpErr && <div className="text-sm text-red-400">{totpErr}</div>}
                  <div className="flex gap-2">
                    <button type="submit" disabled={totpBusy || totpCode.length !== 6} className="btn-primary flex-1">
                      {totpBusy ? 'Verifying…' : 'Enable 2FA'}
                    </button>
                    <button type="button" onClick={() => { setTotpSetup(null); setTotpCode(''); setTotpErr('') }} className="btn-ghost flex-1">
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            ) : user?.smsEnabled ? (
              <div className="text-sm text-earth-400 p-3 rounded-xl bg-slate-900/30 border border-white/5">
                SMS 2FA is already enabled. Disable it below to switch to an authenticator app.
              </div>
            ) : (
              <button onClick={handleSetupTotp} disabled={totpBusy} className="btn-primary w-full">
                {totpBusy ? 'Setting up…' : 'Enable 2FA'}
              </button>
            )}

            {totpDone && (
              <div className="mt-3 text-sm text-emerald-400 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> 2FA enabled successfully!
              </div>
            )}
          </Card>

          <Card>
            <h3 className="font-display font-semibold mb-3 flex items-center gap-2"><MessageSquare className="w-4 h-4 text-brand-600" /> SMS Two-Factor Authentication</h3>
            <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
              An alternative to the authenticator app above — requires a code texted to your phone when you sign in. Only one 2FA method can be active at a time.
            </p>

            {user?.totpEnabled ? (
              <div className="text-sm text-earth-400 p-3 rounded-xl bg-slate-900/30 border border-white/5">
                Authenticator app 2FA is already enabled. Disable it above to switch to SMS.
              </div>
            ) : user?.smsEnabled ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <span className="text-sm font-medium text-emerald-300">SMS 2FA is enabled for {user.phone}</span>
                </div>
                {showSmsDisableForm ? (
                  <form onSubmit={handleDisableSms} className="space-y-3">
                    <p className="text-sm text-earth-400">Enter your password to disable SMS 2FA:</p>
                    <input
                      type="password"
                      value={smsDisablePw}
                      onChange={(e) => setSmsDisablePw(e.target.value)}
                      placeholder="Your password"
                      className="input w-full"
                      required
                    />
                    {smsErr && <div className="text-sm text-red-400">{smsErr}</div>}
                    <div className="flex gap-2">
                      <button type="submit" disabled={smsBusy} className="btn-danger flex-1">
                        {smsBusy ? 'Disabling…' : 'Disable SMS 2FA'}
                      </button>
                      <button type="button" onClick={() => { setShowSmsDisableForm(false); setSmsDisablePw(''); setSmsErr('') }} className="btn-ghost flex-1">
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <button onClick={() => setShowSmsDisableForm(true)} className="btn-ghost w-full text-red-400 hover:text-red-300">
                    Disable SMS 2FA
                  </button>
                )}
              </div>
            ) : smsSetupPending ? (
              <form onSubmit={handleVerifySmsSetup} className="space-y-3">
                <p className="text-sm text-earth-400">Enter the 6-digit code we sent to {smsPhone}:</p>
                {smsDevCode && (
                  <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200">
                    No SMS provider configured — dev code: <span className="font-mono font-semibold">{smsDevCode}</span>
                  </div>
                )}
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={smsCode}
                  onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="input w-full text-center text-lg tracking-widest font-mono"
                  autoFocus
                />
                {smsErr && <div className="text-sm text-red-400">{smsErr}</div>}
                {smsResendMsg && <div className="text-sm text-emerald-400">{smsResendMsg}</div>}
                <div className="flex gap-2">
                  <button type="submit" disabled={smsBusy || smsCode.length !== 6} className="btn-primary flex-1">
                    {smsBusy ? 'Verifying…' : 'Enable SMS 2FA'}
                  </button>
                  <button type="button" onClick={() => { setSmsSetupPending(false); setSmsCode(''); setSmsErr(''); setSmsDevCode('') }} className="btn-ghost flex-1">
                    Cancel
                  </button>
                </div>
                <button type="button" onClick={handleResendSmsSetup} className="w-full text-center text-sm text-brand-500 hover:underline">
                  Resend code
                </button>
              </form>
            ) : (
              <form onSubmit={handleSetupSms} className="space-y-3">
                <label className="label">Phone number</label>
                <input
                  type="tel"
                  value={smsPhone}
                  onChange={(e) => setSmsPhone(e.target.value)}
                  placeholder="+1 555 555 0100"
                  className="input w-full"
                  required
                />
                {smsErr && <div className="text-sm text-red-400">{smsErr}</div>}
                <button type="submit" disabled={smsBusy} className="btn-primary w-full">
                  {smsBusy ? 'Sending code…' : 'Send verification code'}
                </button>
              </form>
            )}

            {smsDone && (
              <div className="mt-3 text-sm text-emerald-400 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> SMS 2FA enabled successfully!
              </div>
            )}
          </Card>

          <Card>
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4 text-brand-600" />
              <h3 className="font-display font-semibold">App unlock PIN</h3>
            </div>
            <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
              Set a 4-digit app unlock PIN to sign in quickly instead of typing your password. If you forget it, reset it with your email and a PIN recovery code.
            </p>
            <div className="space-y-3">
              <label className="label">New app unlock PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="1234"
                className="input w-full bg-slate-900/80 text-white border-white/10"
              />
              <label className="label">Confirm app unlock PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="1234"
                className="input w-full bg-slate-900/80 text-white border-white/10"
              />
              <button
                type="button"
                onClick={savePin}
                disabled={!/^[0-9]{4}$/.test(pin) || pin !== pinConfirm}
                className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save app unlock PIN
              </button>
              <div className="text-xs text-earth-400">
                Forgot your app unlock PIN? <Link to="/reset-pin" className="text-brand-700 hover:underline">Reset it via email</Link>.
              </div>
              {pinSaved && <div className="text-sm text-emerald-300">App unlock PIN saved. Use it on the login screen.</div>}
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4 text-brand-600" />
              <h3 className="font-display font-semibold">
                {isMobile ? 'Laptop sync PIN' : 'Mobile sync PIN'}
              </h3>
            </div>
            <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
              {isMobile
                ? 'Generate a 5-digit PIN to sync your account with your laptop. Share this PIN with your computer to access your data.'
                : 'Generate a 5-digit PIN to sync your account with the mobile app. Share this PIN with your mobile device to access your data.'}
            </p>
            {showSyncPasswordPrompt ? (
              <div className="space-y-3">
                <div className="p-4 bg-slate-900/80 rounded-xl border border-amber-500/30">
                  <p className="text-xs text-amber-300 mb-2">
                    To enable cross-device sync, enter your account password to link this device to the server.
                  </p>
                  <div className="relative">
                    <input
                      type={showPwText ? 'text' : 'password'}
                      value={syncPassword}
                      onChange={(e) => setSyncPassword(e.target.value)}
                      placeholder="Your password"
                      className="input w-full bg-slate-900/80 text-white border-white/10 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwText(!showPwText)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-earth-400 hover:text-white"
                      tabIndex={-1}
                    >
                      {showPwText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <button
                  onClick={confirmSyncPin}
                  disabled={!syncPassword || syncPasswordBusy}
                  className="btn-primary w-full"
                >
                  {syncPasswordBusy ? 'Linking…' : 'Link account & generate PIN'}
                </button>
                <button
                  onClick={() => { setShowSyncPasswordPrompt(false); setSyncPassword('') }}
                  className="btn-ghost w-full text-sm"
                >
                  Cancel
                </button>
              </div>
            ) : !showSyncPin ? (
              <button
                onClick={generateSyncPin}
                className="btn-primary w-full"
              >
                Generate {isMobile ? 'laptop' : 'mobile'} sync PIN
              </button>
            ) : (
              <div className="space-y-3">
                <div className="p-4 bg-slate-900/80 rounded-xl border border-white/10">
                  <div className="text-xs text-earth-400 mb-1">Your sync PIN</div>
                  <div className="text-2xl font-mono font-bold text-white tracking-wider">{displaySyncPin}</div>
                </div>
                {showQR ? (
                  <div className="flex justify-center p-4 bg-white rounded-xl">
                    <canvas ref={qrCanvasRef} />
                  </div>
                ) : (
                  <button onClick={() => setShowQR(true)} className="btn-secondary w-full">
                    <QrCode className="w-4 h-4 mr-2" /> Show QR code
                  </button>
                )}
                <button onClick={copySyncPin} className="btn-secondary w-full">
                  <Copy className="w-4 h-4 mr-2" /> Copy PIN
                </button>
                <button onClick={generateSyncPin} className="btn-ghost w-full text-sm">
                  Generate new PIN
                </button>
              </div>
            )}
          </Card>
        </CollapsibleSection>

        <CollapsibleSection icon={School} label="School" defaultOpen={true}>
          {user?.role !== 'school' && user?.role !== 'admin' && (
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <School className="w-4 h-4 text-brand-600" />
                <h3 className="font-display font-semibold">Join school</h3>
              </div>
              {user.schoolId ? (
                <div className="space-y-3">
                  {schoolInfo && (
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
                      <p className="font-medium">{schoolInfo.name}</p>
                      <p className="text-earth-400">Code: <span className="font-mono">{schoolInfo.pin}</span></p>
                    </div>
                  )}
                  <p className="text-sm text-earth-500 dark:text-earth-400">Upload verification PDFs for approval.</p>
                  <Link to="/school/dashboard" className="btn-secondary w-full flex items-center justify-center">
                    <Upload className="w-4 h-4 mr-2" /> Upload & view PDFs
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-earth-500 dark:text-earth-400">Enter your school code to link your account.</p>
                  <input
                    type="text"
                    value={schoolCode}
                    onChange={(e) => setSchoolCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    placeholder="cisd-12345"
                    className="input w-full"
                  />
                  <button
                    onClick={async () => {
                      if (!schoolCode) return
                      setSchoolBusy(true)
                      try {
                        const token = localStorage.getItem('voluntrack:auth_token')
                        const apiUrl = import.meta.env.VITE_API_URL || '/api'
                        const res = await fetch(`${apiUrl}/school/join`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                          body: JSON.stringify({ pin: schoolCode }),
                        })
                        const data = await res.json()
                        if (!res.ok) throw new Error(data.error || 'Failed to join')
                        setToastMessage('School linked!')
                        setToast(true)
                        setSchoolCode('')
                        window.location.reload()
                      } catch (e) {
                        setToastMessage(e.message)
                        setToast(true)
                      } finally {
                        setSchoolBusy(false)
                      }
                    }}
                    disabled={!schoolCode || schoolBusy}
                    className="btn-primary w-full"
                  >
                    {schoolBusy ? 'Joining…' : 'Join school'}
                  </button>
                </div>
              )}
            </Card>
          )}

          {user?.role === 'school' && (
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <School className="w-4 h-4 text-brand-600" />
                <h3 className="font-display font-semibold">School dashboard</h3>
              </div>
              <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">View students, review uploaded PDFs, and manage approvals.</p>
              <Link to="/school/dashboard" className="btn-primary w-full flex items-center justify-center">
                Open school dashboard
              </Link>
            </Card>
          )}
        </CollapsibleSection>

        {(user?.role === 'student' || user?.role === 'parent') && (
          <CollapsibleSection icon={Users} label="Family" defaultOpen={false}>
            {user?.role === 'student' && (
              <Card>
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-4 h-4 text-brand-600" />
                  <h3 className="font-display font-semibold">Share with a parent</h3>
                </div>
                <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
                  Generate a code and share it with a parent so they can follow your logged hours and verification status. Only hours logged from now on will be visible to them.
                </p>
                {childLinkCode ? (
                  <div className="space-y-3">
                    <div className="p-4 bg-slate-900/80 rounded-xl border border-white/10">
                      <div className="text-xs text-earth-400 mb-1">Your link code</div>
                      <div className="text-2xl font-mono font-bold text-white tracking-wider">{childLinkCode}</div>
                    </div>
                    <button onClick={generateChildLinkCode} disabled={childLinkBusy} className="btn-ghost w-full text-sm">
                      {childLinkBusy ? 'Generating…' : 'Generate new code'}
                    </button>
                  </div>
                ) : (
                  <button onClick={generateChildLinkCode} disabled={childLinkBusy} className="btn-primary w-full">
                    {childLinkBusy ? 'Generating…' : 'Generate link code'}
                  </button>
                )}
              </Card>
            )}

            {user?.role === 'parent' && (
              <Card>
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-4 h-4 text-brand-600" />
                  <h3 className="font-display font-semibold">Link your child</h3>
                </div>
                <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
                  Enter the code your child generated in their Settings to follow their logged hours.
                </p>
                <input
                  type="text"
                  value={linkChildInput}
                  onChange={(e) => setLinkChildInput(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                  placeholder="K7XQ-2M9P"
                  className="input w-full font-mono"
                />
                {linkChildErr && <div className="text-sm text-red-600 dark:text-red-300 mt-2">{linkChildErr}</div>}
                <button onClick={linkChild} disabled={!linkChildInput.trim() || linkChildBusy} className="btn-primary w-full mt-3 disabled:opacity-50 disabled:cursor-not-allowed">
                  {linkChildBusy ? 'Linking…' : 'Link child'}
                </button>

                {linkedChildren.length > 0 && (
                  <div className="mt-5 space-y-2">
                    <div className="text-xs text-earth-400 uppercase tracking-wide">Linked children</div>
                    {linkedChildren.map((c) => (
                      <div key={c.id} className="flex items-center justify-between rounded-xl border border-earth-200/60 dark:border-white/[0.06] px-3 py-2">
                        <div>
                          <div className="text-sm font-medium">{c.name}</div>
                          <div className="text-xs text-earth-400">{c.email}</div>
                        </div>
                        <button onClick={() => unlinkChild(c.id)} className="btn-ghost p-1.5" title="Unlink">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}
          </CollapsibleSection>
        )}

        <CollapsibleSection icon={Bell} label="Reminders & Notifications" defaultOpen={false}>
          <Card>
            <h3 className="font-display font-semibold mb-3 flex items-center gap-2"><Bell className="w-4 h-4 text-brand-600" /> Reminders</h3>
            <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
              Set up weekly or one-time reminders so you never forget to log your volunteer hours.
            </p>
            <Link to="/reminders" className="btn-primary inline-flex items-center gap-2">
              <Bell className="w-4 h-4" /> Manage reminders
            </Link>
          </Card>

          <Card>
            <h3 className="font-display font-semibold mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-brand-600" /> Privacy</h3>
            <p className="text-sm text-earth-500 dark:text-earth-400">
              Your logged hours are stored on this device. If you've created an account, some features above (Family sharing, school linking, cross-device sync, two-factor authentication) also store data on our server. Sign out below to clear your session.
            </p>
            <div className="text-xs text-earth-500 dark:text-earth-400 mt-3 space-y-1">
              <div>Signed in as <span className="font-medium text-earth-800 dark:text-earth-100">{user?.email}</span></div>
              <div>Role: <span className="font-medium text-earth-800 dark:text-earth-100 capitalize">{user?.role}</span></div>
            </div>
          </Card>

          {user?.role === 'admin' && (
            <Card>
              <Link to="/admin" className="block p-4 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition">
                <div className="flex items-center gap-2 mb-1">
                  <ShieldCheck className="w-4 h-4 text-brand-600" />
                  <span className="font-semibold text-earth-900 dark:text-earth-100">Admin inbox</span>
                </div>
                <p className="text-sm text-earth-500 dark:text-earth-400">Review contact form submissions.</p>
              </Link>
            </Card>
          )}
        </CollapsibleSection>

        <CollapsibleSection icon={Info} label="About & Account" defaultOpen={false}>
          <Card>
            <h3 className="font-display font-semibold mb-3 flex items-center gap-2"><Info className="w-4 h-4 text-brand-600" /> About</h3>
            <p className="text-sm text-earth-500 dark:text-earth-400">
              VolunTrack co. Visit the <Link to="/about" className="text-brand-700 dark:text-brand-300 hover:underline">About page</Link> or <Link to="/contact" className="text-brand-700 dark:text-brand-300 hover:underline">get in touch</Link>.
            </p>
          </Card>

          <Card>
            <button
              onClick={() => { logout(); nav('/login') }}
              className="btn-danger w-full"
            >
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          </Card>

          <Card className="border-red-500/30 bg-red-950/10">
            <div className="inline-flex items-center gap-3 rounded-3xl border border-red-500/40 bg-red-600/10 px-4 py-3 text-sm font-semibold text-red-100 shadow-sm shadow-red-500/10 mb-4">
              <span className="inline-flex h-3 w-3 rounded-full bg-red-400 shadow-red-500/30 shadow-md" />
              <span className="uppercase tracking-[0.22em] text-red-100/90">Warning</span>
              <span className="text-red-100 max-w-xl">Deleting your account will remove all local VolunTrack data and cannot be undone.</span>
            </div>
            <h3 className="font-display font-semibold mb-3 text-red-300">Delete account</h3>
            <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
              Remove your local account and all VolunTrack data stored on this device. This action cannot be undone.
            </p>
            {confirmDelete ? (
              <div className="space-y-4">
                <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-4 text-red-100">
                  <p className="font-semibold">Confirm account deletion</p>
                  <p className="text-sm text-red-100/80">This is permanent. Your volunteer logs, goals, achievements, and reminder data will be erased.</p>
                </div>
                <div className="space-y-3">
                  <div className="text-sm text-earth-200">Type <span className="font-semibold text-black">delete</span> to confirm.</div>
                  <input
                    value={deleteConfirmationText}
                    onChange={(e) => setDeleteConfirmationText(e.target.value)}
                    placeholder="Type delete to confirm"
                    className="input w-full bg-slate-900/80 text-white border-white/10"
                  />
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleteConfirmationText.trim().toLowerCase() !== 'delete'}
                    className="btn-danger w-full disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Yes, delete everything
                  </button>
                  <button onClick={() => { setConfirmDelete(false); setDeleteConfirmationText('') }} className="btn-secondary w-full">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="btn-danger w-full">
                <Trash2 className="w-4 h-4 mr-2" /> Delete account
              </button>
            )}
          </Card>
        </CollapsibleSection>

      </div>

      <Toast open={toast} onClose={() => setToast(false)}>{toastMessage}</Toast>
    </AppLayout>
  )
}
