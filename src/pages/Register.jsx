import { Link, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { Mail, Lock, User as UserIcon, ArrowRight, School, GraduationCap, Hash, Hand, Check, Users, Cake } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth.jsx'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import Turnstile from '@/components/Turnstile.jsx'
import { turnstileEnabled } from '@/lib/turnstile.js'
import { SCHOOL_GRADES, gradeOptionLabel } from '@policy'
import { checkSignupAge } from '@ageRules'
import { markWelcomePending, clearWelcomePending } from '@/lib/welcome.js'
import { useSeo } from '@/hooks/useSeo.js'

// Remembers, on this device only, that a too-young date of birth was entered
// for a role, so going back and picking an older year doesn't get around the
// age rules (FTC COPPA guidance on neutral age screens). Never sent to the
// server. Expires after a day so a family sharing one device isn't locked
// out for good — e.g. a parent signing up after their child tried.
const AGE_GATE_KEY = 'voluntrack:age_gate'
const AGE_GATE_TTL_MS = 24 * 60 * 60 * 1000

function readAgeGate(role) {
  try {
    const at = JSON.parse(localStorage.getItem(AGE_GATE_KEY) || '{}')[role]
    return typeof at === 'number' && Date.now() - at < AGE_GATE_TTL_MS
  } catch {
    return false
  }
}

function recordAgeGate(role) {
  try {
    const gate = JSON.parse(localStorage.getItem(AGE_GATE_KEY) || '{}')
    localStorage.setItem(AGE_GATE_KEY, JSON.stringify({ ...gate, [role]: Date.now() }))
  } catch {
    // Storage unavailable (private mode): the server-side rules still apply.
  }
}

const AGE_GATED_MESSAGE = 'A younger date of birth was entered for this account type on this device, so it can\'t be created here right now. Ask a parent or guardian for help.'

// Matches SIGNUP_CODE_RESEND_SECONDS in server/routes/auth.js.
const RESEND_WAIT_MS = 60 * 1000

function todayIso() {
  const t = new Date()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

const ROLES = [
  {
    id: 'student',
    label: "I'm a Student",
    description: 'Track volunteer hours, join a school, earn badges, and submit reports.',
    icon: GraduationCap,
  },
  {
    id: 'volunteer',
    label: "I'm a Volunteer Task Maker",
    description: 'Post volunteer opportunities, manage signups, and log hours for your team.',
    icon: Hand,
  },
  {
    id: 'parent',
    label: "I'm a Parent",
    description: "Follow your child's logged volunteer hours and verification status — read only. Ask your child for their link code in Settings → Family to get started.",
    icon: Users,
  },
]

export default function Register() {
  useSeo({
    title: 'Create an Account',
    description: 'Create a free VolunTrack account to start tracking volunteer hours, setting goals, and earning badges.',
    path: '/register',
  })

  const { sendSignupCode, register } = useAuth()
  const nav = useNavigate()
  const [role, setRole] = useState('student')
  const [form, setForm] = useState({ name: '', email: '', password: '', school: '', grade: '', studentIdNumber: '', schoolCode: '', dateOfBirth: '', parentEmail: '' })
  // Set once an under-13 sign-up is waiting on its parent's emailed approval.
  const [awaitingParent, setAwaitingParent] = useState('')
  // The checked form, kept while the person enters the emailed code (#310).
  const [pendingSignup, setPendingSignup] = useState(null)
  const [emailCode, setEmailCode] = useState('')
  const [resendAt, setResendAt] = useState(0)
  const [resent, setResent] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  // Turnstile tokens are single-use — bump this to remount the widget for a
  // fresh token after a failed attempt.
  const [captchaKey, setCaptchaKey] = useState(0)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    setIsMobile(mq.matches)
    const handler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Ticks the "Resend in Ns" countdown while it runs.
  useEffect(() => {
    if (!pendingSignup || now >= resendAt) return undefined
    const t = setTimeout(() => setNow(Date.now()), 1000)
    return () => clearTimeout(t)
  }, [pendingSignup, now, resendAt])
  useEffect(() => { if (pendingSignup) setNow(Date.now()) }, [pendingSignup, resendAt])

  const onChange = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  // Age rules (server/ageRules.js). The date of birth is sent with the sign-up
  // so the server can apply them too, and is never stored.
  const ageCheck = checkSignupAge(role, form.dateOfBirth)
  // Bumped after recordAgeGate() so the form re-reads the device lock.
  const [, setAgeGateTick] = useState(0)
  const ageGated = readAgeGate(role)
  // An under-13 date entered earlier on this device still counts for students.
  const under13 = role === 'student' && Boolean(form.dateOfBirth) && (ageCheck.under13 || ageGated)

  // Recorded as soon as a too-young date is entered (on leaving the field),
  // not on submit: the parent-email field appearing would otherwise show a
  // child which date to change before anything was remembered.
  const onDobBlur = () => {
    if (ageCheck.tooYoung) recordAgeGate(role)
    else if (role === 'student' && ageCheck.under13) recordAgeGate('student')
    else return
    setAgeGateTick((n) => n + 1)
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    setErr('')
    if (form.password.length < 8) { setErr('Password must be at least 8 characters.'); return }
    if (ageCheck.error) {
      if (ageCheck.tooYoung) recordAgeGate(role)
      setErr(ageCheck.error)
      return
    }
    if (ageGated && role !== 'student') { setErr(AGE_GATED_MESSAGE); return }
    if (under13) recordAgeGate('student')
    if (under13 && !form.parentEmail.trim()) { setErr("Enter your parent or guardian's email address."); return }
    if (!agreed) { setErr('Please agree to the Terms of Service and Privacy Policy.'); return }
    if (turnstileEnabled && !captchaToken) { setErr('Please complete the CAPTCHA below.'); return }
    const signup = { ...form, role, under13, parentEmail: under13 ? form.parentEmail.trim() : '' }
    setBusy(true)
    try {
      const sent = await sendSignupCode({ ...signup, turnstileToken: captchaToken })
      // No backend: register() makes a local demo account, which needs no code.
      if (sent.offline) { await createAccount(signup, ''); return }
      setPendingSignup(signup)
      setEmailCode('')
      setResendAt(Date.now() + RESEND_WAIT_MS)
    } catch (e) {
      setErr(e.message)
    } finally {
      // The CAPTCHA token is spent either way; the code step needs a fresh one to resend.
      setCaptchaToken('')
      setCaptchaKey((k) => k + 1)
      setBusy(false)
    }
  }

  const createAccount = async (signup, code) => {
    // Set before register() rather than after: the new session makes
    // PublicOnly redirect straight to "/", and Home() reads this note to send
    // a new student or volunteer on to /welcome — which also joins the school
    // code and shows whether it worked. Withdrawn below if no session results.
    const wantsWelcome = signup.role === 'student' || signup.role === 'volunteer'
    if (wantsWelcome) markWelcomePending({ schoolCode: signup.role === 'student' ? signup.schoolCode : '' })
    try {
      const user = await register({ ...signup, emailCode: code })
      if (user?.pendingParentalConsent) {
        clearWelcomePending()
        setAwaitingParent(signup.parentEmail)
        return
      }
      setToast(true)
      // The welcome step is already on screen by now; a late nav('/') would
      // pull the student off it onto the dashboard.
      if (!wantsWelcome) setTimeout(() => nav('/', { replace: true }), 600)
    } catch (e) {
      clearWelcomePending()
      setErr(e.message)
    }
  }

  const onVerify = async (e) => {
    e.preventDefault()
    setErr('')
    if (!/^\d{6}$/.test(emailCode)) { setErr('Enter the 6-digit code from the email.'); return }
    setBusy(true)
    try {
      await createAccount(pendingSignup, emailCode)
    } finally {
      setBusy(false)
    }
  }

  const onResend = async () => {
    setErr('')
    if (turnstileEnabled && !captchaToken) { setErr('Please complete the CAPTCHA below.'); return }
    setBusy(true)
    try {
      await sendSignupCode({ ...pendingSignup, turnstileToken: captchaToken })
      setEmailCode('')
      setResendAt(Date.now() + RESEND_WAIT_MS)
      setResent(true)
    } catch (e) {
      setErr(e.message)
    } finally {
      setCaptchaToken('')
      setCaptchaKey((k) => k + 1)
      setBusy(false)
    }
  }

  const backToForm = () => {
    setPendingSignup(null)
    setEmailCode('')
    setResent(false)
    setErr('')
  }

  if (awaitingParent) {
    return (
      <div className="min-h-screen grid place-items-center px-4 py-8 page-shell">
        <div className="w-full max-w-lg">
          <Card padded={false} className="p-7 text-center">
            <Mail className="w-10 h-10 mx-auto mb-3 text-brand-600" />
            <h1 className="text-2xl font-bold mb-2">Ask your parent to check their email</h1>
            <p className="text-sm text-earth-500 dark:text-earth-400 mb-2">
              We sent a message to <strong>{awaitingParent}</strong>. Your account is ready as soon as they approve it — then sign in with the email and password you just chose.
            </p>
            <p className="text-sm text-earth-500 dark:text-earth-400 mb-6">
              If they don&apos;t answer within 14 days, the account is deleted and you can sign up again.
            </p>
            <Link to="/login" className="btn-primary inline-flex justify-center">Go to sign in</Link>
          </Card>
        </div>
      </div>
    )
  }

  if (pendingSignup) {
    const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000))
    return (
      <div className="min-h-screen grid place-items-center px-4 py-8 page-shell">
        <div className="w-full max-w-lg">
          <Card padded={false} className="p-7">
            <Mail className="w-10 h-10 mx-auto mb-3 text-brand-600" />
            <h1 className="text-2xl font-bold mb-2 text-center">Check your email</h1>
            <p className="text-sm text-earth-500 dark:text-earth-400 mb-6 text-center">
              We sent a 6-digit code to <strong>{pendingSignup.email.trim()}</strong>. Enter it below to create your account. It expires in 10 minutes.
            </p>
            <form onSubmit={onVerify} className="space-y-4">
              <div>
                <label className="label" htmlFor="register-email-code">Verification code</label>
                <input
                  id="register-email-code"
                  className="input text-center text-2xl tracking-[0.4em] font-semibold"
                  value={emailCode}
                  onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  maxLength={6}
                  autoFocus
                  required
                />
              </div>

              {err && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg animate-shake">{err}</div>}
              {resent && !err && <div className="text-sm text-brand-700 dark:text-brand-300">We sent a new code. Only the newest one works.</div>}

              <button type="submit" className="btn-primary w-full" disabled={busy || emailCode.length !== 6}>
                {busy ? 'Creating account…' : <>Verify and create account <ArrowRight className="w-4 h-4" /></>}
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-earth-200 dark:border-earth-800 space-y-3 text-center text-sm text-earth-500 dark:text-earth-400">
              <p>Didn&apos;t get it? Check your spam folder, or send a new one.</p>
              {resendIn === 0 && <Turnstile key={captchaKey} onVerify={setCaptchaToken} action="register" />}
              <button
                type="button"
                className="btn-secondary w-full"
                onClick={onResend}
                disabled={busy || resendIn > 0 || (turnstileEnabled && !captchaToken)}
              >
                {resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}
              </button>
              <button type="button" onClick={backToForm} className="text-brand-700 dark:text-brand-300 font-medium hover:underline">
                Use a different email
              </button>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen grid place-items-center px-4 py-8 page-shell">
      <div className="w-full max-w-lg">
        <Link to="/" className="flex items-center gap-2.5 justify-center mb-6 animate-fade-in-up">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="VolunTrack" className="w-10 h-10 object-contain" />
          <span className="font-display font-bold text-2xl">VolunTrack</span>
        </Link>

        <Card padded={false} className="p-7 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          <h1 className="text-2xl font-bold mb-1 animate-fade-in-up" style={{ animationDelay: '150ms' }}>Create your account</h1>
          <p className="text-sm text-earth-500 dark:text-earth-400 mb-6 animate-fade-in-up" style={{ animationDelay: '200ms' }}>Choose your account type to get started.</p>

          <div className="grid gap-3 mb-6">
            {ROLES.map((r, i) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRole(r.id)}
                className={`flex items-start gap-3 p-4 rounded-2xl border-2 text-left transition animate-fade-in-up ${
                  role === r.id
                    ? 'border-brand-500 bg-brand-500/10'
                    : 'border-earth-200 dark:border-earth-800 hover:border-earth-300 dark:hover:border-earth-700'
                }`}
                style={{ animationDelay: `${250 + i * 100}ms` }}
              >
                <div className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${
                  role === r.id ? 'bg-brand-500 text-white' : 'bg-earth-100 dark:bg-earth-800 text-earth-500'
                }`}>
                  <r.icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm flex items-center gap-2">
                    {r.label}
                    {role === r.id && <Check className="w-4 h-4 text-brand-500" />}
                  </div>
                  <p className="text-xs text-earth-500 dark:text-earth-400 mt-0.5">{r.description}</p>
                </div>
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="animate-fade-in-up" style={{ animationDelay: '450ms' }}>
              <Field icon={UserIcon}  label="Full name" value={form.name} onChange={onChange('name')} placeholder="Jane Doe" required />
            </div>
            <div className="animate-fade-in-up" style={{ animationDelay: '500ms' }}>
              <Field icon={Mail}      label="Email" type="email" value={form.email} onChange={onChange('email')} placeholder="you@email.com" autoComplete="email" required />
            </div>
            <div className="animate-fade-in-up" style={{ animationDelay: '550ms' }}>
              <Field icon={Lock}      label="Password" type="password" value={form.password} onChange={onChange('password')} placeholder="8+ characters" autoComplete="new-password" required />
            </div>

            <div className="animate-fade-in-up" style={{ animationDelay: '625ms' }}>
              <Field icon={Cake} label="Date of birth" type="date" value={form.dateOfBirth} onChange={onChange('dateOfBirth')} onBlur={onDobBlur} max={todayIso()} autoComplete="bday" required />
              <p className="text-xs text-earth-500 dark:text-earth-400 mt-1">
                Only used to check our age rules — we don&apos;t keep it.
              </p>
            </div>

            {role === 'student' && (
              <>
                {under13 && (
                  <div className="animate-fade-in-up">
                    <Field icon={Mail} label="Parent or guardian's email" type="email" value={form.parentEmail} onChange={onChange('parentEmail')} placeholder="parent@example.com" autoComplete="off" required />
                    <p className="text-xs text-earth-500 dark:text-earth-400 mt-1">
                      We&apos;ll email them to ask for permission. You can sign in once they approve. If your school gave you a VolunTrack account, use that instead.
                    </p>
                    {!ageCheck.under13 && (
                      <p className="text-xs text-earth-500 dark:text-earth-400 mt-1">
                        An under-13 date of birth was entered on this device earlier, so a parent or guardian still needs to approve.
                      </p>
                    )}
                  </div>
                )}
                <div className="animate-fade-in-up" style={{ animationDelay: '650ms' }}>
                  <Field icon={School}        label="School / Organization" value={form.school} onChange={onChange('school')} placeholder="Lincoln High School" />
                </div>
                <div className="animate-fade-in-up" style={{ animationDelay: '700ms' }}>
                  <Field icon={Hash}          label="School code (optional)" value={form.schoolCode} onChange={onChange('schoolCode')} placeholder="cisd-12345" />
                </div>
                <div className="animate-fade-in-up" style={{ animationDelay: '750ms' }}>
                  <label className="label" htmlFor="register-grade">Grade (optional)</label>
                  <div className="relative">
                    <GraduationCap className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400" />
                    <select id="register-grade" className="input pl-9" value={form.grade} onChange={onChange('grade')}>
                      <option value="">Select your grade</option>
                      {SCHOOL_GRADES.map((g) => (
                        <option key={g} value={g}>{gradeOptionLabel(g)}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="animate-fade-in-up" style={{ animationDelay: '800ms' }}>
                  <Field icon={Hash} label="Student ID number (optional)" value={form.studentIdNumber} onChange={onChange('studentIdNumber')} placeholder="For school verification forms" />
                </div>
              </>
            )}

            <label className="flex items-start gap-2.5 text-sm text-earth-600 dark:text-earth-300 animate-fade-in-up" style={{ animationDelay: '800ms' }}>
              <input
                type="checkbox"
                className="mt-0.5 w-4 h-4 rounded border-earth-300 dark:border-earth-700 text-brand-600 focus:ring-brand-500"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>
                I agree to the{' '}
                <Link to="/terms" target="_blank" className="text-brand-700 dark:text-brand-300 font-medium hover:underline">Terms of Service</Link>
                {' '}and{' '}
                <Link to="/privacy" target="_blank" className="text-brand-700 dark:text-brand-300 font-medium hover:underline">Privacy Policy</Link>.
              </span>
            </label>

            {err && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg animate-shake">{err}</div>}

            <Turnstile key={captchaKey} onVerify={setCaptchaToken} action="register" className="animate-fade-in-up" />

            <button type="submit" className="btn-primary w-full animate-fade-in-up" style={{ animationDelay: '800ms' }} disabled={busy || !agreed || (turnstileEnabled && !captchaToken)}>
              {busy ? 'Sending code…' : <>Create account <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>

          <div className="text-center text-sm text-earth-500 dark:text-earth-400 mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-brand-700 dark:text-brand-300 font-medium hover:underline">Sign in</Link>
          </div>

          <div className="text-center text-sm text-earth-500 dark:text-earth-400 mt-2">
            {isMobile ? 'Syncing from laptop?' : 'Syncing from mobile?'}{' '}
            <Link to="/sync-login" className="text-brand-700 dark:text-brand-300 font-medium hover:underline">Use sync PIN</Link>
          </div>
        </Card>
      </div>

      <Toast open={toast} onClose={() => setToast(false)}>Welcome to VolunTrack!</Toast>
    </div>
  )
}

function Field({ icon: Icon, label, type = 'text', ...rest }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400" />
        <input type={type} className="input pl-9" {...rest} />
      </div>
    </div>
  )
}
