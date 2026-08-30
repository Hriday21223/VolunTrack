import { Link, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { Mail, Lock, User as UserIcon, ArrowRight, School, GraduationCap, Hash, Hand, Check, Users } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth.jsx'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import Turnstile from '@/components/Turnstile.jsx'
import { turnstileEnabled } from '@/lib/turnstile.js'
import { useSeo } from '@/hooks/useSeo.js'

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

  const { register } = useAuth()
  const nav = useNavigate()
  const apiUrl = import.meta.env.VITE_API_URL || '/api'
  const [role, setRole] = useState('student')
  const [form, setForm] = useState({ name: '', email: '', password: '', pin: '', school: '', grade: '', studentIdNumber: '', schoolCode: '' })
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

  const onChange = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const onSubmit = async (e) => {
    e.preventDefault()
    setErr('')
    if (form.password.length < 6) { setErr('Password must be at least 6 characters.'); return }
    if (form.pin && !/^[0-9]{4}$/.test(form.pin)) { setErr('PIN must be exactly 4 digits.'); return }
    if (!agreed) { setErr('Please agree to the Terms of Service and Privacy Policy.'); return }
    if (turnstileEnabled && !captchaToken) { setErr('Please complete the CAPTCHA below.'); return }
    setBusy(true)
    try {
      const user = await register({ ...form, role, turnstileToken: captchaToken })
      if (role === 'student' && form.schoolCode && user) {
        const token = localStorage.getItem('voluntrack:auth_token')
        if (token) {
          await fetch(`${apiUrl}/school/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ pin: form.schoolCode }),
          })
        }
      }
      setToast(true)
      setTimeout(() => nav('/', { replace: true }), 600)
    } catch (e) {
      setErr(e.message)
      setCaptchaToken('')
      setCaptchaKey((k) => k + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4 py-8 bg-gradient-to-br from-brand-50 via-earth-50 to-earth-100 dark:from-[#0f1813] dark:via-[#0f1813] dark:to-[#14201a]">
      <div className="w-full max-w-lg">
        <Link to="/about" className="flex items-center gap-2.5 justify-center mb-6 animate-fade-in-up">
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
              <Field icon={Lock}      label="Password" type="password" value={form.password} onChange={onChange('password')} placeholder="6+ characters" autoComplete="new-password" required />
            </div>
            <div className="animate-fade-in-up" style={{ animationDelay: '600ms' }}>
              <Field icon={Lock}      label="Optional PIN" type="password" value={form.pin} onChange={onChange('pin')} placeholder="4-digit PIN" autoComplete="one-time-code" />
            </div>

            {role === 'student' && (
              <>
                <div className="animate-fade-in-up" style={{ animationDelay: '650ms' }}>
                  <Field icon={School}        label="School / Organization" value={form.school} onChange={onChange('school')} placeholder="Lincoln High School" />
                </div>
                <div className="animate-fade-in-up" style={{ animationDelay: '700ms' }}>
                  <Field icon={Hash}          label="School code (optional)" value={form.schoolCode} onChange={onChange('schoolCode')} placeholder="cisd-12345" />
                </div>
                <div className="animate-fade-in-up" style={{ animationDelay: '750ms' }}>
                  <Field icon={GraduationCap} label="Grade or Role" value={form.grade} onChange={onChange('grade')} placeholder="11th grade / Volunteer lead" />
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
              {busy ? 'Creating account…' : <>Create account <ArrowRight className="w-4 h-4" /></>}
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
