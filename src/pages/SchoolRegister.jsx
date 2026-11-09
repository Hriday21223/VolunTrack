import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Mail, Lock, User as UserIcon, ArrowRight, School, Hash, Tag } from 'lucide-react'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import Turnstile from '@/components/Turnstile.jsx'
import { turnstileEnabled } from '@/lib/turnstile.js'
import { useSeo } from '@/hooks/useSeo.js'
import { useAuth } from '@/hooks/useAuth.jsx'
import RegistrationCodeField from '@/components/RegistrationCodeField.jsx'
import { isCompleteRegistrationCode } from '@/lib/registrationCode.js'

import LegalSummary from '@/components/LegalSummary.jsx'
import LanguagePicker from '@/components/LanguagePicker.jsx'
import { tr } from '@/lib/i18n.js'
import PasswordInput from '@/components/PasswordInput.jsx'
const apiUrl = import.meta.env.VITE_API_URL || '/api'

export default function SchoolRegister() {
  useSeo({
    title: 'Register Your School',
    description: 'Start a free VolunTrack club for up to 50 students, or set up your whole school with the registration code we sent you, then review and approve your students’ volunteer hours.',
    path: '/school/register',
  })

  const nav = useNavigate()
  const { refreshUser } = useAuth()
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('token')
  // Free club (#506) unless they came with an invite or asked for the school plan.
  const [plan, setPlan] = useState(() => (inviteToken || searchParams.get('plan') === 'school' ? 'school' : 'club'))
  const isClub = !inviteToken && plan === 'club'
  const [form, setForm] = useState({ name: '', email: '', password: '', pin: '', referralCode: '', registrationCode: '' })
  // Typed twice so a typo doesn't lock them out (#831). Never sent.
  const [confirmPw, setConfirmPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState(false)
  const [inviteLoaded, setInviteLoaded] = useState(!inviteToken)
  const [agreed, setAgreed] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaKey, setCaptchaKey] = useState(0)
  // A free club proves its email with a 6-digit code first (#817).
  const [codeSent, setCodeSent] = useState(false)
  const [emailCode, setEmailCode] = useState('')

  useEffect(() => {
    if (!inviteToken) return
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/school/invite/${inviteToken}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || tr('Invite link is invalid.'))
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
    if (form.password.length < 8) { setErr(tr('Password must be at least 8 characters.')); return }
    if (form.password !== confirmPw) { setErr(tr("Passwords don't match.")); return }
    if (!form.pin || !/^[a-zA-Z]+-?\d{3,5}$/.test(form.pin)) { setErr(tr('School code must be letters followed by digits (e.g. cisd-12345).')); return }
    if (!inviteToken && !isClub && !isCompleteRegistrationCode(form.registrationCode)) { setErr(tr('Enter the 16-character registration code we gave you.')); return }
    if (!agreed) { setErr(tr('Please agree to the Terms of Service and Privacy Policy.')); return }
    if (turnstileEnabled && !captchaToken) { setErr(tr('Please complete the CAPTCHA below.')); return }
    setBusy(true)
    try {
      if (isClub) {
        await sendClubCode()
        return
      }
      await createAccount()
    } catch (e) {
      setErr(e.message)
      setCaptchaToken('')
      setCaptchaKey((k) => k + 1)
    } finally {
      setBusy(false)
    }
  }

  const body = () => ({ ...form, referralCode: isClub ? undefined : form.referralCode, pin: form.pin.toLowerCase(), plan: isClub ? 'club' : 'school', inviteToken: inviteToken || undefined, registrationCode: inviteToken || isClub ? undefined : form.registrationCode, turnstileToken: captchaToken })

  const sendClubCode = async () => {
    const res = await fetch(`${apiUrl}/school/register/send-code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || tr('Could not send the verification code.'))
    setCodeSent(true); setEmailCode('')
  }

  const onConfirmCode = async (e) => {
    e.preventDefault()
    setErr('')
    if (!/^\d{6}$/.test(emailCode.trim())) { setErr(tr('Enter the 6-digit code we emailed you.')); return }
    setBusy(true)
    try { await createAccount(emailCode.trim()) } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  const createAccount = async (code) => {
    const res = await fetch(`${apiUrl}/school/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body(), emailCode: code }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || tr('Registration failed'))
    localStorage.setItem('voluntrack:auth_token', data.token)
    await refreshUser()
    setToast(true)
    setTimeout(() => nav('/school/dashboard', { replace: true }), 600)
  }

  return (
    <div className="min-h-screen grid place-items-center px-4 py-8 page-shell">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2.5 justify-center mb-6">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="" className="w-10 h-10 object-contain" />
          <span className="font-display font-bold text-2xl">VolunTrack</span>
        </Link>

        <Card padded={false} className="p-7">
          <h1 className="text-2xl font-bold mb-1">{inviteToken ? tr('Finish setting up your school') : isClub ? tr('Start a free club') : tr('Register your school')}</h1>
          <p className="text-sm text-earth-500 dark:text-earth-400 mb-5">
            {inviteToken
              ? tr('You were invited to VolunTrack. Just set your password and school code.')
              : isClub
                ? tr('Free for one club or class, up to 50 students, with every school feature. No code needed.')
                : tr('Create a school account to review student hours, using the registration code we sent you.')}
          </p>

          {!inviteToken && (
            <div role="radiogroup" aria-label={tr('Plan')} className="grid grid-cols-2 gap-2 mb-6">
              {[
                { id: 'club', title: tr('Free club'), text: tr('Up to 50 students') },
                { id: 'school', title: tr('Whole school'), text: tr('I have a code from VolunTrack') },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={plan === p.id}
                  onClick={() => { setPlan(p.id); setErr('') }}
                  className={`text-left rounded-xl border px-3 py-2.5 transition ${plan === p.id ? 'border-brand-500 bg-brand-500/10 ring-1 ring-brand-500' : 'border-earth-200 dark:border-earth-700 hover:border-earth-300 dark:hover:border-earth-600'}`}
                >
                  <span className="block text-sm font-semibold">{p.title}</span>
                  <span className="block text-xs text-earth-500 dark:text-earth-400">{p.text}</span>
                </button>
              ))}
            </div>
          )}

          {!inviteLoaded ? (
            <p className="text-sm text-earth-500 py-4">{tr('Loading invite…')}</p>
          ) : codeSent ? (
            <form onSubmit={onConfirmCode} className="space-y-4">
              <div className="rounded-xl bg-brand-500/10 px-4 py-3 text-sm">
                <p className="font-medium">{tr('Check your email')}</p>
                <p className="text-earth-500 dark:text-earth-400 mt-0.5">{tr('We sent a 6-digit code to {email}. It works for 10 minutes.', { email: form.email })}</p>
              </div>
              <div>
                <label className="label" htmlFor="club-email-code">{tr('Code')}</label>
                <input id="club-email-code" className="input tracking-[0.3em] text-lg" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={emailCode} onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ''))} autoFocus required />
              </div>
              {err && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg">{err}</div>}
              <button type="submit" className="btn-primary w-full" disabled={busy || emailCode.length !== 6}>
                {busy ? tr('Registering…') : <>{tr('Start free club')} <ArrowRight className="w-4 h-4" /></>}
              </button>
              <button type="button" className="btn-ghost w-full" onClick={() => { setCodeSent(false); setErr(''); setCaptchaToken(''); setCaptchaKey((k) => k + 1) }}>
                {tr('Wrong email or no code? Go back')}
              </button>
            </form>
          ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            {!inviteToken && !isClub && (
              <RegistrationCodeField value={form.registrationCode} onChange={(v) => setForm((f) => ({ ...f, registrationCode: v }))} />
            )}
            <div>
              <label className="label">{isClub ? tr('Club or school name') : tr('School name')}</label>
              <div className="relative">
                <School className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400" />
                <input type="text" className="input pl-9 disabled:opacity-60" placeholder={isClub ? 'Lincoln High NHS' : 'Lincoln High School'} value={form.name} onChange={onChange('name')} disabled={!!inviteToken} required />
              </div>
            </div>
            <div>
              <label className="label">{isClub ? tr('Your email') : tr('Admin email')}</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400" />
                <input type="email" className="input pl-9 disabled:opacity-60" placeholder="admin@school.edu" value={form.email} onChange={onChange('email')} autoComplete="email" disabled={!!inviteToken} required />
              </div>
            </div>
            <div>
              <label className="label">{tr('Password (8+ characters)')}</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400 z-10" />
                <PasswordInput className="input pl-9" placeholder={tr('Min 8 characters')} value={form.password} onChange={onChange('password')} autoComplete="new-password" required />
              </div>
            </div>
            <div>
              <label className="label">{tr('Confirm password')}</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400 z-10" />
                <PasswordInput className="input pl-9" placeholder={tr('Type it again')} value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" required />
              </div>
            </div>
            <div>
              <label className="label">{isClub ? tr('Club code') : tr('School code')}</label>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400" />
                <input type="text" className="input pl-9" placeholder="cisd-12345" value={form.pin} onChange={onChange('pin')} required />
              </div>
              <p className="text-xs text-earth-400 mt-1">{tr('Students will use this code to link their accounts.')}</p>
            </div>
            {!isClub && (
            <div>
              <label className="label">{tr('Referral code')} <span className="text-earth-400 font-normal">{tr('(optional)')}</span></label>
              <div className="relative">
                <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400" />
                <input
                  type="text"
                  className="input pl-9 font-mono uppercase tracking-wider"
                  placeholder="LINCOLN-R7K2"
                  value={form.referralCode}
                  onChange={onChange('referralCode')}
                />
              </div>
              <p className="text-xs text-earth-400 mt-1">{tr('Were you invited by another school? Enter their code and you both get a discount.')}</p>
            </div>
            )}

            <LegalSummary role="school" />


            <label className="flex items-start gap-2.5 text-sm text-earth-600 dark:text-earth-300">
              <input
                type="checkbox"
                className="mt-0.5 w-4 h-4 rounded border-earth-300 dark:border-earth-700 text-brand-600 focus:ring-brand-500"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>
                {tr("I've read the short version and agree to the")}{' '}
                <Link to="/terms" target="_blank" className="text-brand-700 dark:text-brand-300 font-medium hover:underline">{tr('Terms of Service')}</Link>
                {' '}{tr('and')}{' '}
                <Link to="/privacy" target="_blank" className="text-brand-700 dark:text-brand-300 font-medium hover:underline">{tr('Privacy Policy')}</Link>.
              </span>
            </label>

            {err && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg">{err}</div>}

            <Turnstile key={captchaKey} onVerify={setCaptchaToken} action="school-register" />

            <button type="submit" className="btn-primary w-full" disabled={busy || !agreed || (turnstileEnabled && !captchaToken)}>
              {busy ? (isClub ? tr('Sending code…') : tr('Registering…')) : <>{isClub ? tr('Email me a code') : tr('Register school')} <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>
          )}

          <div className="text-center text-sm text-earth-500 dark:text-earth-400 mt-6">
            {tr('Already have a school account?')}{' '}
            <Link to="/login" className="text-brand-700 dark:text-brand-300 font-medium hover:underline">{tr('Sign in')}</Link>
          </div>
          <div className="mt-6 flex justify-center">
            <LanguagePicker compact />
          </div>
        </Card>
      </div>

      <Toast open={toast} onClose={() => setToast(false)}>{isClub ? tr('Club created!') : tr('School registered!')}</Toast>
    </div>
  )
}
