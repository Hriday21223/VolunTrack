import GradePicker from '@/components/GradePicker.jsx'
import { useEffect, useState } from 'react'
import { Link, useParams, useLocation, useNavigate } from 'react-router-dom'
import { School, Loader2, CheckCircle2, ArrowRight, Clock } from 'lucide-react'
import Card from '@/components/Card.jsx'
import Footer from '@/components/Footer.jsx'
import PublicHeader from '@/components/PublicHeader.jsx'
import { useAuth } from '@/hooks/useAuth.jsx'
import { useSeo } from '@/hooks/useSeo.js'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// /join/:code (#491): where a school's join link and flyer QR code land.
// Signed out → create an account with the code filled in (Welcome then links
// it), or sign in and come back here. A signed-in student joins in one tap.
export default function JoinSchool() {
  const { code: rawCode = '' } = useParams()
  const code = rawCode.trim().toLowerCase()
  const { user, refreshUser } = useAuth()
  const loc = useLocation()
  const nav = useNavigate()
  const [school, setSchool] = useState(null) // { id, name }
  const [lookup, setLookup] = useState('loading') // loading | found | missing | error
  // idle | busy | linked | transfer | error
  const [join, setJoin] = useState({ status: 'idle', message: '' })

  useSeo({
    title: school ? tr('Join {school} on VolunTrack', { school: school.name }) : tr('Join your school on VolunTrack'),
    description: tr('Track your volunteer hours free and send them to your school for approval.'),
    path: `/join/${code}`,
  })

  useEffect(() => {
    let cancelled = false
    setLookup('loading')
    fetch(`${apiUrl}/school/info?pin=${encodeURIComponent(code)}`)
      .then(async (res) => {
        if (cancelled) return
        if (res.status === 404 || res.status === 400) { setLookup('missing'); return }
        if (!res.ok) { setLookup('error'); return }
        const data = await res.json()
        if (!data.school?.id) { setLookup('missing'); return }
        setSchool({ id: data.school.id, name: data.school.name })
        setLookup('found')
      })
      .catch(() => !cancelled && setLookup('error'))
    return () => { cancelled = true }
  }, [code])

  const alreadyHere = Boolean(user && school && user.schoolId === school.id)

  // A school that set its grades asks for one (#581).
  const [gradeAsk, setGradeAsk] = useState(null)
  const doJoin = async (grade = null) => {
    setJoin({ status: 'busy', message: '' })
    try {
      const res = await fetch(`${apiUrl}/school/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` },
        body: JSON.stringify({ pin: code, ...(grade ? { grade } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.needsGrade) { setGradeAsk({ grades: data.grades || [], schoolName: data.schoolName }); setJoin({ status: 'idle', message: '' }); return }
      setGradeAsk(null)
      if (res.status === 409) { setJoin({ status: 'linked', message: '' }); return }
      if (!res.ok) throw new Error(data.error || tr('Could not join that school.'))
      if (data.pending) { setJoin({ status: 'transfer', message: data.message || '' }); return }
      setJoin({ status: 'linked', message: '' })
      refreshUser?.()
    } catch (e) {
      setJoin({ status: 'error', message: e.message })
    }
  }

  let body
  if (lookup === 'loading') {
    body = <p className="flex items-center justify-center gap-2 text-earth-500"><Loader2 className="w-4 h-4 animate-spin" /> {tr('Loading…')}</p>
  } else if (lookup === 'missing') {
    body = (
      <>
        <h1 className="text-2xl font-bold">{tr('We could not find that school')}</h1>
        <p className="mt-2 text-earth-500 dark:text-earth-400">
          {tr('The link may be out of date. Ask your adviser for the current link or school code.')}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to={user ? '/settings' : '/register'} className="btn-primary">{user ? tr('Enter a school code') : tr('Create a free account')}</Link>
        </div>
      </>
    )
  } else if (lookup === 'error') {
    body = (
      <>
        <h1 className="text-2xl font-bold">{tr('Something went wrong')}</h1>
        <p className="mt-2 text-earth-500 dark:text-earth-400">{tr('We could not look up this school just now. Try again in a minute.')}</p>
      </>
    )
  } else {
    const heading = <h1 className="text-2xl md:text-3xl font-bold">{tr('Join {school} on VolunTrack', { school: school.name })}</h1>
    if (!user) {
      body = (
        <>
          {heading}
          <p className="mt-3 text-earth-500 dark:text-earth-400">
            {tr('Log your volunteer hours and send them to {school} for approval. Free for students.', { school: school.name })}
          </p>
          <div className="mt-6 flex flex-col sm:flex-row justify-center gap-3">
            <Link to={`/register?school=${encodeURIComponent(code)}`} className="btn-primary">
              {tr('Create my free account')} <ArrowRight className="w-4 h-4" />
            </Link>
            <Link to="/login" state={{ from: loc }} className="btn-secondary">{tr('I already have an account')}</Link>
          </div>
          <p className="mt-4 text-xs text-earth-500 dark:text-earth-400">{tr('School code: {code}', { code })}</p>
        </>
      )
    } else if (user.role !== 'student') {
      body = (
        <>
          {heading}
          <p className="mt-3 text-earth-500 dark:text-earth-400">
            {tr('Only student accounts join a school. You are signed in with a different kind of account.')}
          </p>
          <div className="mt-6"><Link to="/" className="btn-secondary">{tr('Go to my dashboard')}</Link></div>
        </>
      )
    } else if (alreadyHere || join.status === 'linked') {
      body = (
        <>
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
          <h1 className="mt-3 text-2xl font-bold">{tr("You're in {school}", { school: school.name })}</h1>
          <p className="mt-2 text-earth-500 dark:text-earth-400">{tr('Hours you log now go to {school} for approval.', { school: school.name })}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button type="button" className="btn-primary" onClick={() => nav('/log')}>{tr('Log hours')}</button>
            <Link to="/" className="btn-ghost">{tr('Go to my dashboard')}</Link>
          </div>
        </>
      )
    } else if (join.status === 'transfer') {
      body = (
        <>
          <Clock className="w-10 h-10 text-amber-500 mx-auto" />
          <h1 className="mt-3 text-2xl font-bold">{tr('Transfer requested')}</h1>
          <p className="mt-2 text-earth-500 dark:text-earth-400">
            {join.message || tr('{school} has been asked to accept your transfer.', { school: school.name })}
          </p>
          <div className="mt-6"><Link to="/" className="btn-secondary">{tr('Go to my dashboard')}</Link></div>
        </>
      )
    } else {
      body = (
        <>
          {heading}
          <p className="mt-3 text-earth-500 dark:text-earth-400">
            {user.schoolId
              ? tr('You are already linked to another school. Joining asks {school} to accept your transfer, and your hours move with you.', { school: school.name })
              : tr('Your hours will go to {school} for approval.', { school: school.name })}
          </p>
          {join.status === 'error' && <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">{join.message}</p>}
          <div className="mt-6">
            {gradeAsk ? (
              <GradePicker grades={gradeAsk.grades} schoolName={gradeAsk.schoolName} busy={join.status === 'busy'} onPick={(g) => doJoin(g)} />
            ) : (
            <button type="button" className="btn-primary" onClick={() => doJoin()} disabled={join.status === 'busy'}>
              {join.status === 'busy' ? <><Loader2 className="w-4 h-4 animate-spin" /> {tr('Joining…')}</> : tr('Join {school}', { school: school.name })}
            </button>
            )}
          </div>
        </>
      )
    }
  }

  return (
    <div className="min-h-screen page-shell flex flex-col">
      <PublicHeader />
      <main className="flex-1 max-w-xl w-full mx-auto px-4 pb-16">
        <Card className="text-center py-10">
          {lookup === 'found' && !(alreadyHere || join.status === 'linked' || join.status === 'transfer') && (
            <div className="mx-auto mb-4 w-12 h-12 rounded-2xl bg-brand-500/15 grid place-items-center">
              <School className="w-6 h-6 text-brand-500" />
            </div>
          )}
          {body}
        </Card>
      </main>
      <Footer />
    </div>
  )
}
