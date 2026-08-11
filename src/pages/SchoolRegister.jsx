import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Mail, Lock, User as UserIcon, ArrowRight, School, Hash } from 'lucide-react'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import { useSeo } from '@/hooks/useSeo.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

export default function SchoolRegister() {
  useSeo({
    title: 'Register Your School',
    description: 'Create a free school account on VolunTrack to review, verify, and manage your students’ volunteer hours.',
    path: '/school/register',
  })

  const nav = useNavigate()
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('token')
  const [form, setForm] = useState({ name: '', email: '', password: '', pin: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState(false)
  const [inviteLoaded, setInviteLoaded] = useState(!inviteToken)

  useEffect(() => {
    if (!inviteToken) return
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/school/invite/${inviteToken}`)
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
    if (!form.pin || !/^[a-zA-Z]+-?\d{3,5}$/.test(form.pin)) { setErr('School code must be letters followed by digits (e.g. cisd-12345).'); return }
    setBusy(true)
    try {
      const res = await fetch(`${apiUrl}/school/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, pin: form.pin.toLowerCase(), inviteToken: inviteToken || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Registration failed')
      localStorage.setItem('voluntrack:auth_token', data.token)
      setToast(true)
      setTimeout(() => nav('/school/dashboard', { replace: true }), 600)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4 py-8 bg-gradient-to-br from-brand-50 via-earth-50 to-earth-100 dark:from-[#0f1813] dark:via-[#0f1813] dark:to-[#14201a]">
      <div className="w-full max-w-md">
        <Link to="/about" className="flex items-center gap-2.5 justify-center mb-6">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="VolunTrack" className="w-10 h-10 object-contain" />
          <span className="font-display font-bold text-2xl">VolunTrack</span>
        </Link>

        <Card padded={false} className="p-7">
          <h1 className="text-2xl font-bold mb-1">{inviteToken ? 'Finish setting up your school' : 'Register your school'}</h1>
          <p className="text-sm text-earth-500 dark:text-earth-400 mb-6">
            {inviteToken ? 'You were invited by a VolunTrack admin — just set your password and school code.' : 'Create a school account to review student hours.'}
          </p>

          {!inviteLoaded ? (
            <p className="text-sm text-earth-500 py-4">Loading invite…</p>
          ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="label">School name</label>
              <div className="relative">
                <School className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400" />
                <input type="text" className="input pl-9 disabled:opacity-60" placeholder="Lincoln High School" value={form.name} onChange={onChange('name')} disabled={!!inviteToken} required />
              </div>
            </div>
            <div>
              <label className="label">Admin email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400" />
                <input type="email" className="input pl-9 disabled:opacity-60" placeholder="admin@school.edu" value={form.email} onChange={onChange('email')} autoComplete="email" disabled={!!inviteToken} required />
              </div>
            </div>
            <div>
              <label className="label">Password (8+ characters)</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400" />
                <input type="password" className="input pl-9" placeholder="Min 8 characters" value={form.password} onChange={onChange('password')} autoComplete="new-password" required />
              </div>
            </div>
            <div>
              <label className="label">School code</label>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400" />
                <input type="text" className="input pl-9" placeholder="cisd-12345" value={form.pin} onChange={onChange('pin')} required />
              </div>
              <p className="text-xs text-earth-400 mt-1">Students will use this code to link their accounts.</p>
            </div>

            {err && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg">{err}</div>}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? 'Registering…' : <>Register school <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>
          )}

          <div className="text-center text-sm text-earth-500 dark:text-earth-400 mt-6">
            Already have a school account?{' '}
            <Link to="/login" className="text-brand-700 dark:text-brand-300 font-medium hover:underline">Sign in</Link>
          </div>
        </Card>
      </div>

      <Toast open={toast} onClose={() => setToast(false)}>School registered!</Toast>
    </div>
  )
}
