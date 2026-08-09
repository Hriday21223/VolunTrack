import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { Mail, Lock, ArrowRight, ShieldCheck, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth.jsx'

import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import { useSeo } from '@/hooks/useSeo.js'

export default function Login() {
  useSeo({
    title: 'Sign In',
    description: 'Sign in to your VolunTrack account to log volunteer hours and track your progress.',
    path: '/login',
  })

  const { login, verifyTotp, verifyBackupCode, loginWithPin, user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const nav = useNavigate()
  const loc = useLocation()
  const [mode, setMode] = useState('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [showCredential, setShowCredential] = useState(false)
  const [toast, setToast] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  // 2FA challenge state
  const [totpPending, setTotpPending] = useState(false)
  const [tempToken, setTempToken] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [backupMode, setBackupMode] = useState(false)
  const [backupCode, setBackupCode] = useState('')
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    setIsMobile(mq.matches)
    const handler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const onSubmit = async (e) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      if (mode === 'pin') {
        await loginWithPin(email, pin)
        setToast(true)
        setTimeout(() => nav(loc.state?.from?.pathname || '/', { replace: true }), 600)
      } else {
        const result = await login(email, password)
        if (result?.requiresTotp) {
          setTempToken(result.tempToken)
          setTotpPending(true)
          setBusy(false)
          return
        }
        setToast(true)
        setTimeout(() => nav(loc.state?.from?.pathname || '/', { replace: true }), 600)
      }
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const onTotpSubmit = async (e) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await verifyTotp(tempToken, totpCode)
      setToast(true)
      setTimeout(() => nav(loc.state?.from?.pathname || '/', { replace: true }), 600)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const onBackupSubmit = async (e) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await verifyBackupCode(email, backupCode)
      setToast(true)
      setTimeout(() => nav(loc.state?.from?.pathname || '/', { replace: true }), 600)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(168,85,247,0.18),transparent_24%),radial-gradient(circle_at_top_right,rgba(34,197,94,0.18),transparent_18%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.16),transparent_18%),linear-gradient(180deg,#08161b_0%,#0b1c24_45%,#0f1e16_100%)] text-white px-4 py-8">
      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1.2fr_0.8fr] items-center">
        <div className="space-y-8 animate-fade-in-up">
          <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-slate-900/60 px-4 py-2 text-sm text-brand-100 shadow-soft backdrop-blur">
            <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="VolunTrack" className="w-5 h-5 object-contain" />
            VolunTrack login
          </div>

          <div className="space-y-4">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl text-white animate-fade-in-up" style={{ animationDelay: '100ms' }}>Welcome back to the volunteer dashboard.</h1>
            <p className="max-w-2xl text-lg text-slate-300 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
              Sign in and pick up where you left off—track hours, keep goals moving, and export your service record with confidence.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 animate-fade-in-up" style={{ animationDelay: '300ms' }}>
            <FeatureCard title="Fast logging" description="Jump straight to the hours form and save every session with proof and supervisor details." />
            <FeatureCard title="Progress tracking" description="See goal completion, weekly activity, and earned badges in one clean view." />
          </div>

          <Link to="/help" className="block rounded-3xl border border-white/10 bg-slate-900/60 p-6 shadow-soft backdrop-blur text-sm text-slate-300 hover:bg-slate-800/60 transition animate-fade-in-up" style={{ animationDelay: '400ms' }}>
            <div className="font-semibold text-white">Need help getting started?</div>
            <p className="mt-2 leading-6">Create an account, set your first goal, and log your first volunteer hours to earn a badge.</p>
          </Link>
        </div>

        <div className="relative animate-scale-in">
          <Card padded={false} className="overflow-hidden border border-white/10 bg-slate-950/80 shadow-soft">
            <div className="bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_25%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.14),transparent_25%)] p-8">
              <div className="flex items-center justify-between mb-6 animate-fade-in-up">
                <div>
                  <p className="text-sm text-brand-200 uppercase tracking-[0.3em]">Secure sign in</p>
                  <h2 className="text-3xl font-bold text-white">Welcome back</h2>
                </div>
                <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="VolunTrack" className="w-12 h-12 object-contain" />
              </div>

              <div className="mb-4 inline-flex rounded-full bg-white/10 p-1 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
                <button
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${mode === 'password' ? 'bg-slate-900 text-white' : 'text-slate-300 hover:text-white'}`}
                  onClick={() => setMode('password')}
                >
                  Password
                </button>
                <button
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${mode === 'pin' ? 'bg-slate-900 text-white' : 'text-slate-300 hover:text-white'}`}
                  onClick={() => setMode('pin')}
                >
                  PIN
                </button>
              </div>

              {totpPending ? (
                backupMode ? (
                  <form onSubmit={onBackupSubmit} className="space-y-5">
                    <div className="text-center mb-2">
                      <ShieldCheck className="w-10 h-10 text-sky-400 mx-auto mb-2" />
                      <p className="text-sm text-slate-300">Enter one of your backup codes</p>
                    </div>
                    <div>
                      <label className="label text-slate-300" htmlFor="backup-code">Backup code</label>
                      <input
                        id="backup-code"
                        type="text"
                        required
                        className="input bg-slate-900/80 text-white border-white/10 font-mono"
                        placeholder="e.g. a1b2c3d4"
                        value={backupCode}
                        onChange={(e) => setBackupCode(e.target.value)}
                      />
                    </div>
                    {err && <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100 animate-shake">{err}</div>}
                    <button type="submit" className="btn-primary w-full py-3 text-sm font-semibold" disabled={busy}>
                      {busy ? 'Verifying…' : <>Verify backup code <ArrowRight className="w-4 h-4" /></>}
                    </button>
                    <button type="button" className="w-full text-center text-sm text-sky-200 hover:text-white" onClick={() => { setBackupMode(false); setErr('') }}>
                      Use authenticator code instead
                    </button>
                  </form>
                ) : (
                  <form onSubmit={onTotpSubmit} className="space-y-5">
                    <div className="text-center mb-2">
                      <ShieldCheck className="w-10 h-10 text-sky-400 mx-auto mb-2" />
                      <p className="text-sm text-slate-300">Enter the 6-digit code from your authenticator app</p>
                    </div>
                    <div>
                      <label className="label text-slate-300" htmlFor="totp-code">Authenticator code</label>
                      <input
                        id="totp-code"
                        type="text"
                        required
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        className="input bg-slate-900/80 text-white border-white/10 text-center text-2xl tracking-[0.5em] font-mono"
                        placeholder="000000"
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        autoFocus
                      />
                    </div>
                    {err && <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100 animate-shake">{err}</div>}
                    <button type="submit" className="btn-primary w-full py-3 text-sm font-semibold" disabled={busy || totpCode.length !== 6}>
                      {busy ? 'Verifying…' : <>Verify <ArrowRight className="w-4 h-4" /></>}
                    </button>
                    <button type="button" className="w-full text-center text-sm text-sky-200 hover:text-white" onClick={() => { setBackupMode(true); setErr('') }}>
                      Use a backup code instead
                    </button>
                  </form>
                )
              ) : (
              <form onSubmit={onSubmit} className="space-y-5">
                <div className="animate-fade-in-up" style={{ animationDelay: '200ms' }}>
                  <label className="label text-slate-300" htmlFor="email">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      id="email" type="email" required autoComplete="email"
                      className="input pl-9 bg-slate-900/80 text-white border-white/10"
                      placeholder="you@school.edu"
                      value={email} onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>
                {isAdmin && mode === 'password' ? (
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100 animate-fade-in-up" style={{ animationDelay: '300ms' }}>
                    Admin — click Sign in to continue (no password needed).
                  </div>
                ) : (
                  <div className="animate-fade-in-up" style={{ animationDelay: '300ms' }}>
                    <div className="flex items-center justify-between gap-4">
                      <label className="label text-slate-300" htmlFor="credential">{mode === 'pin' ? '4-digit PIN' : 'Password'}</label>
                      <Link to={mode === 'pin' ? '/reset-pin' : '/forgot-password'} className="text-xs text-sky-200 hover:text-white">
                        {mode === 'pin' ? 'Forgot PIN?' : 'Forgot?'}
                      </Link>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        id="credential"
                        type={showCredential ? 'text' : 'password'}
                        required
                        autoComplete={mode === 'pin' ? 'one-time-code' : 'current-password'}
                        inputMode={mode === 'pin' ? 'numeric' : 'text'}
                        pattern={mode === 'pin' ? '[0-9]*' : undefined}
                        className="input pl-9 pr-10 bg-slate-900/80 text-white border-white/10"
                        placeholder={mode === 'pin' ? '••••' : '••••••••'}
                        value={mode === 'pin' ? pin : password}
                        onChange={(e) => (mode === 'pin' ? setPin(e.target.value) : setPassword(e.target.value))}
                      />
                      <button
                        type="button"
                        onClick={() => setShowCredential((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                        tabIndex={-1}
                        title={showCredential ? 'Hide' : 'Show'}
                      >
                        {showCredential ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}

                {err && <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100 animate-shake">{err}</div>}

                <button type="submit" className="btn-primary w-full py-3 text-sm font-semibold animate-fade-in-up" style={{ animationDelay: '400ms' }} disabled={busy}>
                  {busy ? (mode === 'pin' ? 'Unlocking…' : 'Signing in…') : (mode === 'pin' ? <>Unlock <ArrowRight className="w-4 h-4" /></> : <>Sign in <ArrowRight className="w-4 h-4" /></>)}
                </button>
              </form>
              )}

              <div className="mt-6 text-center text-sm text-slate-400">
                New to VolunTrack?{' '}
                <Link to="/register" className="text-sky-200 font-semibold hover:text-white">Create an account</Link>
              </div>

              <div className="mt-4 text-center text-sm text-slate-400">
                {isMobile ? 'Syncing from laptop?' : 'Syncing from mobile?'}{' '}
                <Link to="/sync-login" className="text-sky-200 font-semibold hover:text-white">Use sync PIN</Link>
              </div>

            </div>
          </Card>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/40 to-transparent" />
        </div>
      </div>

      <Toast open={toast} onClose={() => setToast(false)}>Welcome back!</Toast>
    </div>
  )
}

function FeatureCard({ title, description }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-soft backdrop-blur">
      <div className="text-base font-semibold text-white">{title}</div>
      <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>
    </div>
  )
}
