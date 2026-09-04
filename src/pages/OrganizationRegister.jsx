import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Mail, Lock, ArrowRight, Building2 } from 'lucide-react'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import Turnstile from '@/components/Turnstile.jsx'
import { turnstileEnabled } from '@/lib/turnstile.js'
import { useSeo } from '@/hooks/useSeo.js'
import { useAuth } from '@/hooks/useAuth.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

export default function OrganizationRegister() {
  useSeo({
    title: 'Register Your Organization',
    description: 'VolunTrack organization accounts, for managing multiple schools under one login, are set up by invitation — contact us to get started.',
    path: '/organization/register',
  })

  const nav = useNavigate()
  const { refreshUser } = useAuth()
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('token')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState(false)
  const [inviteLoaded, setInviteLoaded] = useState(!inviteToken)
  const [agreed, setAgreed] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaKey, setCaptchaKey] = useState(0)

  useEffect(() => {
    if (!inviteToken) return
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/organization/invite/${inviteToken}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Invite link is invalid.')
        setForm((f) => ({ ...f, name: data.name, email: data.email }))
      } catch (e) {
        setErr(e.message)
      } finally {
        setInviteLoaded(true)
      }
    })()
  }, [inviteToken])

  const onChange = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const onSubmit = async (e) => {
    e.preventDefault()
    setErr('')
    if (form.password.length < 8) { setErr('Password must be at least 8 characters.'); return }
    if (!agreed) { setErr('Please agree to the Terms of Service and Privacy Policy.'); return }
    if (turnstileEnabled && !captchaToken) { setErr('Please complete the CAPTCHA below.'); return }
    setBusy(true)
    try {
      const res = await fetch(`${apiUrl}/organization/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, inviteToken: inviteToken || undefined, turnstileToken: captchaToken }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Registration failed')
      localStorage.setItem('voluntrack:auth_token', data.token)
      await refreshUser()
      setToast(true)
      setTimeout(() => nav('/organization/dashboard', { replace: true }), 600)
    } catch (e) {
      setErr(e.message)
      setCaptchaToken('')
      setCaptchaKey((k) => k + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4 py-8 page-shell">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2.5 justify-center mb-6">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="VolunTrack" className="w-10 h-10 object-contain" />
          <span className="font-display font-bold text-2xl">VolunTrack</span>
        </Link>

        <Card padded={false} className="p-7">
          {!inviteToken ? (
            <>
              <h1 className="text-2xl font-bold mb-1">Organization accounts are by invitation</h1>
              <p className="text-sm text-earth-500 dark:text-earth-400 mb-6">
                To add and manage multiple schools under one account, reach out and we&apos;ll get you set up with an invite link.
              </p>
              <Link to="/contact" className="btn-primary w-full justify-center">
                Contact us <ArrowRight className="w-4 h-4" />
              </Link>
            </>
          ) : (
          <>
          <h1 className="text-2xl font-bold mb-1">Finish setting up your organization</h1>
          <p className="text-sm text-earth-500 dark:text-earth-400 mb-6">
            You were invited by a VolunTrack admin — just set your password.
          </p>

          {!inviteLoaded ? (
            <p className="text-sm text-earth-500 py-4">Loading invite…</p>
          ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="label">Organization name</label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400" />
                <input type="text" className="input pl-9 disabled:opacity-60" placeholder="Lincoln School District" value={form.name} onChange={onChange('name')} disabled={!!inviteToken} required />
              </div>
            </div>
            <div>
              <label className="label">Contact email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400" />
                <input type="email" className="input pl-9 disabled:opacity-60" placeholder="admin@district.edu" value={form.email} onChange={onChange('email')} autoComplete="email" disabled={!!inviteToken} required />
              </div>
            </div>
            <div>
              <label className="label">Password (8+ characters)</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400" />
                <input type="password" className="input pl-9" placeholder="Min 8 characters" value={form.password} onChange={onChange('password')} autoComplete="new-password" required />
              </div>
            </div>

            <label className="flex items-start gap-2.5 text-sm text-earth-600 dark:text-earth-300">
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

            {err && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg">{err}</div>}

            <Turnstile key={captchaKey} onVerify={setCaptchaToken} action="organization-register" />

            <button type="submit" className="btn-primary w-full" disabled={busy || !agreed || (turnstileEnabled && !captchaToken)}>
              {busy ? 'Registering…' : <>Register organization <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>
          )}
          </>
          )}

          <div className="text-center text-sm text-earth-500 dark:text-earth-400 mt-6">
            Already have an organization account?{' '}
            <Link to="/login" className="text-brand-700 dark:text-brand-300 font-medium hover:underline">Sign in</Link>
          </div>
        </Card>
      </div>

      <Toast open={toast} onClose={() => setToast(false)}>Organization registered!</Toast>
    </div>
  )
}
