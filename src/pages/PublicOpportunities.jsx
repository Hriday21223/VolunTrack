import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Calendar, Globe, MapPin, Accessibility, Users } from 'lucide-react'
import Card from '@/components/Card.jsx'
import Footer from '@/components/Footer.jsx'
import PublicHeader from '@/components/PublicHeader.jsx'
import { useSeo } from '@/hooks/useSeo.js'
import { useAuth } from '@/hooks/useAuth.jsx'
import { ACTIVITY_CATEGORIES } from '@/lib/categories.js'
import { fmtDate } from '@/utils/date.js'
import { tr } from '@/lib/i18n.js'

// /volunteer-opportunities (the owner's request, Nov 27): anyone can browse
// the open volunteer opportunities near them without an account; signing up
// for one needs a free account. It reads the same list as the app's
// Opportunities page (GET /api/school/public-tasks), which for a visitor with
// no sign-in leaves out the organizer's phone, meeting point and day-of
// contact, and every volunteer. Location is asked for only on a tap.
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
    description: tr('Find volunteer opportunities near you, from food banks to tutoring. Browse for free, then create a free account to sign up and track your hours.'),
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

  // Signed in: open it in the app. Signed out: sign in (or create an
  // account) first, then land on that opportunity in the app.
  const signUp = (t) => {
    const target = { pathname: '/opportunities', search: `?task=${encodeURIComponent(t.id)}` }
    if (user) nav(`${target.pathname}${target.search}`)
    else nav('/login', { state: { from: target } })
  }

  return (
    <div className="min-h-screen page-shell">
      <PublicHeader>
        <Link to="/login" className="btn-ghost">{tr('Sign in')}</Link>
        <Link to="/register/student" className="btn-primary hidden sm:inline-flex">{tr('Get started free')}</Link>
      </PublicHeader>
      <main className="max-w-4xl mx-auto px-4 md:px-8 pb-20">
        <h1 className="mt-4 text-3xl md:text-4xl font-bold leading-tight">{tr('Volunteer Opportunities Near You')}</h1>
        <p className="mt-3 text-lg text-earth-700 dark:text-earth-200">{tr('Find volunteer opportunities near you, from food banks to tutoring. Browse for free, then create a free account to sign up and track your hours.')}</p>

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
            <p className="mt-2 text-sm text-earth-500 dark:text-earth-400">{tr('Signing up for an opportunity needs a free account, so the organizer knows who’s coming and your hours are logged for you.')}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <Link to="/register/student" className="btn-primary">{tr('Create a free account')} <ArrowRight className="w-4 h-4" /></Link>
              <Link to="/login" className="btn-ghost">{tr('Sign in')}</Link>
            </div>
          </Card>
        )}
      </main>
      <Footer />
    </div>
  )
}
