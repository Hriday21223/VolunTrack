import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Calendar, Globe, MapPin, Accessibility, Users, X, MailCheck } from 'lucide-react'
import Card from '@/components/Card.jsx'
import Footer from '@/components/Footer.jsx'
import PublicHeader from '@/components/PublicHeader.jsx'
import { useSeo } from '@/hooks/useSeo.js'
import { useAuth } from '@/hooks/useAuth.jsx'
import { ACTIVITY_CATEGORIES } from '@/lib/categories.js'
import { fmtDate } from '@/utils/date.js'
import { tr } from '@/lib/i18n.js'
import Turnstile from '@/components/Turnstile.jsx'
import { turnstileEnabled } from '@/lib/turnstile.js'

// /volunteer-opportunities (the owner's request, Nov 27): anyone can browse
// the open volunteer opportunities near them without an account; signing up
// for one needs a free account. It reads the same list as the app's
// Opportunities page (GET /api/school/public-tasks), which for a visitor with
// no sign-in leaves out the organizer's phone, meeting point and day-of
// contact, and every volunteer. Location is asked for only on a tap.
// Signed out, Sign up offers a sign-up without an account (name and email,
// 13 and older; server/routes/emailSignups.js) where the event allows it,
// or signing in / making an account.
// Prerendered and in the sitemap (scripts/seo-pages.mjs).

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const RADIUS_KM = 40

const fmtDist = (km) => {
  if (km === null || km === undefined) return null
  const n = Number(km)
  return n < 1 ? `${Math.round(n * 1000)}m` : `${n.toFixed(1)}km`
}

export default function PublicOpportunities() {
  useSeo({
    title: tr('Volunteer Opportunities Near You'),
    description: tr('Find volunteer opportunities near you, from food banks to tutoring, and sign up with just your name and email.'),
    path: '/volunteer-opportunities',
  })
  const { user } = useAuth()
  const nav = useNavigate()
  const [tasks, setTasks] = useState(null)
  const [failed, setFailed] = useState(false)
  const [near, setNear] = useState(null) // { lat, lng } once the visitor shares it
  const [locating, setLocating] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [onlineOnly, setOnlineOnly] = useState(false)

  useEffect(() => {
    let cancelled = false
    const q = near ? `?lat=${near.lat}&lng=${near.lng}&maxDistance=${RADIUS_KM}` : ''
    setFailed(false)
    fetch(`${apiUrl}/school/public-tasks${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (!cancelled) setTasks(d.tasks || []) })
      .catch(() => { if (!cancelled) { setFailed(true); setTasks([]) } })
    return () => { cancelled = true }
  }, [near])

  const shareLocation = () => {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => { setNear({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocating(false) },
      () => setLocating(false),
      { timeout: 10000 },
    )
  }

  const shown = useMemo(() => {
    const words = search.trim().toLowerCase()
    return (tasks || []).filter((t) => {
      if (category && t.category !== category) return false
      if (onlineOnly && !t.is_online) return false
      if (words && !`${t.title} ${t.description || ''} ${t.location || ''} ${t.creator_name || ''}`.toLowerCase().includes(words)) return false
      return true
    })
  }, [tasks, search, category, onlineOnly])

  // Signed in: open it in the app. Signed out: the sign-up dialog.
  const [signingUp, setSigningUp] = useState(null)
  const signUp = (t) => {
    if (user) nav(`/opportunities?task=${encodeURIComponent(t.id)}`)
    else setSigningUp(t)
  }

  return (
    <div className="min-h-screen page-shell">
      <PublicHeader>
        <Link to="/login" className="btn-ghost">{tr('Sign in')}</Link>
        <Link to="/register/student" className="btn-primary hidden sm:inline-flex">{tr('Get started free')}</Link>
      </PublicHeader>
      <main className="max-w-4xl mx-auto px-4 md:px-8 pb-20">
        <h1 className="mt-4 text-3xl md:text-4xl font-bold leading-tight">{tr('Volunteer Opportunities Near You')}</h1>
        <p className="mt-3 text-lg text-earth-700 dark:text-earth-200">{tr('Find volunteer opportunities near you, from food banks to tutoring, and sign up with just your name and email.')}</p>

        <Card className="mt-6 grid gap-3 sm:grid-cols-[1fr,auto,auto] items-center">
          <input className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr('Search')} aria-label={tr('Search')} />
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label={tr('All categories')}>
            <option value="">{tr('All categories')}</option>
            {ACTIVITY_CATEGORIES.map((c) => <option key={c} value={c}>{tr(c)}</option>)}
          </select>
          <button type="button" className="btn-secondary" onClick={shareLocation} disabled={locating || Boolean(near)}>
            <MapPin className="w-4 h-4" aria-hidden="true" />{' '}{near ? tr('Near you') : locating ? tr('Loading…') : tr('Use my location')}
          </button>
          <label className="sm:col-span-3 flex items-center gap-2 text-sm">
            <input type="checkbox" className="w-4 h-4" checked={onlineOnly} onChange={(e) => setOnlineOnly(e.target.checked)} />
            {tr('Online only')}
          </label>
        </Card>

        {tasks === null ? (
          <p className="mt-8 text-center text-earth-500">{tr('Loading opportunities…')}</p>
        ) : failed ? (
          <p className="mt-8 text-center text-earth-500">{tr('Couldn’t load opportunities. Try again in a moment.')}</p>
        ) : shown.length === 0 ? (
          <p className="mt-8 text-center text-earth-500">{tr('No volunteer opportunities available right now.')}</p>
        ) : (
          <ul className="mt-6 space-y-3">
            {shown.map((t) => {
              const left = t.slots_total ? Math.max(0, Number(t.slots_total) - Number(t.slots_filled || 0)) : null
              return (
                <li key={t.id}>
                  <Card className="flex flex-col sm:flex-row sm:items-start gap-4">
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <h2 className="text-lg font-semibold">{t.title}</h2>
                      <p className="text-sm text-earth-500 dark:text-earth-400 flex flex-wrap gap-x-4 gap-y-1">
                        <span className="inline-flex items-center gap-1"><Calendar className="w-4 h-4" aria-hidden="true" />{fmtDate(t.date)}{t.time ? ` · ${t.time}` : ''}</span>
                        <span className="inline-flex items-center gap-1">
                          {t.is_online ? <Globe className="w-4 h-4" aria-hidden="true" /> : <MapPin className="w-4 h-4" aria-hidden="true" />}
                          {t.is_online ? tr('Online') : (t.location || '')}
                          {t.distance != null && ` · ${fmtDist(t.distance)} ${tr('away')}`}
                        </span>
                        {left != null && <span className="inline-flex items-center gap-1"><Users className="w-4 h-4" aria-hidden="true" />{left > 0 ? tr('{n} spots left', { n: left }) : tr('Full')}</span>}
                        {t.wheelchair_accessible === 'yes' && <span className="inline-flex items-center gap-1"><Accessibility className="w-4 h-4" aria-hidden="true" />{tr('Wheelchair accessible')}</span>}
                      </p>
                      {t.creator_name && <p className="text-sm">{t.creator_name}{t.category ? ` · ${tr(t.category)}` : ''}</p>}
                      {t.description && <p className="text-sm text-earth-700 dark:text-earth-200 line-clamp-3">{t.description}</p>}
                    </div>
                    <button type="button" className="btn-primary shrink-0" onClick={() => signUp(t)}>
                      {tr('Sign up')} <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </Card>
                </li>
              )
            })}
          </ul>
        )}

        {!user && (
          <Card className="mt-10 text-center">
            <h2 className="text-xl font-bold">{tr('Track your hours with VolunTrack')}</h2>
            <p className="mt-2 text-sm text-earth-500 dark:text-earth-400">{tr('With a free account, your hours are logged and signed for you, and signing up takes one tap.')}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <Link to="/register/student" className="btn-primary">{tr('Create a free account')} <ArrowRight className="w-4 h-4" /></Link>
              <Link to="/login" className="btn-ghost">{tr('Sign in')}</Link>
            </div>
          </Card>
        )}
      </main>
      {signingUp && <EmailSignupDialog task={signingUp} onClose={() => setSigningUp(null)} />}
      <Footer />
    </div>
  )
}

// Events with shifts, a waiver, an age limit over 13 or a parent's OK need an
// account (the same rule as emailSignupProblem() on the server).
const needsAccount = (t) => (t.shifts?.length > 0) || Boolean(t.waiver_text) || (t.min_age != null && Number(t.min_age) > 13) || Boolean(t.young_need_parent)

function EmailSignupDialog({ task, onClose }) {
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [over13, setOver13] = useState(false)
  const [captcha, setCaptcha] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const account = () => nav('/login', { state: { from: { pathname: '/opportunities', search: `?task=${encodeURIComponent(task.id)}` } } })

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!over13) { setError(tr('Under 13? Ask a parent to help you make a free account instead.')); return }
    if (turnstileEnabled && !captcha) { setError(tr('Please complete the CAPTCHA below.')); return }
    setBusy(true)
    try {
      const res = await fetch(`${apiUrl}/email-signups/${encodeURIComponent(task.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, over13, turnstileToken: captcha }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || tr('Could not sign you up. Try again.'))
      setSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={task.title} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <Card className="w-full max-w-md relative">
        <button type="button" onClick={onClose} className="absolute right-3 top-3 p-1 text-earth-400 hover:text-earth-700 dark:hover:text-white" aria-label={tr('Close')}><X className="w-5 h-5" /></button>
        <h2 className="text-lg font-semibold pr-8">{task.title}</h2>
        <p className="text-sm text-earth-500 dark:text-earth-400">{fmtDate(task.date)}{task.time ? ` · ${task.time}` : ''}</p>
        {sent ? (
          <div className="mt-4 space-y-2 text-center">
            <MailCheck className="w-10 h-10 mx-auto text-brand-500" aria-hidden="true" />
            <p className="font-semibold">{tr('Check your email')}</p>
            <p className="text-sm text-earth-600 dark:text-earth-300">{tr('We sent a link to {email}. Open it and press Confirm to hold your spot. Your volunteer badge is there too.', { email })}</p>
          </div>
        ) : needsAccount(task) ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm">{tr('This opportunity needs a free account to sign up.')}</p>
            <button type="button" className="btn-primary w-full" onClick={account}>{tr('Sign in or create a free account')}</button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-3">
            <p className="text-sm text-earth-600 dark:text-earth-300">{tr('Sign up with just your name and email. We’ll email you a link to confirm your spot and get your volunteer badge.')}</p>
            <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('Your name')} aria-label={tr('Your name')} autoComplete="name" required maxLength={80} />
            <input className="input w-full" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={tr('Email')} aria-label={tr('Email')} autoComplete="email" required maxLength={254} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="w-4 h-4" checked={over13} onChange={(e) => setOver13(e.target.checked)} />
              {tr('I’m 13 or older')}
            </label>
            {turnstileEnabled && <Turnstile onVerify={setCaptcha} action="email_signup" />}
            {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? tr('Sending…') : tr('Email me the link')}</button>
            <p className="text-xs text-earth-500 dark:text-earth-400 text-center">
              {tr('Want your hours tracked and signed?')}{' '}
              <button type="button" className="underline" onClick={account}>{tr('Sign in or create a free account')}</button>
            </p>
          </form>
        )}
      </Card>
    </div>
  )
}
