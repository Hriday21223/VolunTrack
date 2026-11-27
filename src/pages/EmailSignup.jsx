import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { Calendar, MapPin, Globe, CheckCircle2 } from 'lucide-react'
import Card from '@/components/Card.jsx'
import Footer from '@/components/Footer.jsx'
import PublicHeader from '@/components/PublicHeader.jsx'
import { useSeo } from '@/hooks/useSeo.js'
import { fmtDate } from '@/utils/date.js'
import { tr } from '@/lib/i18n.js'

// /signup/:token — the link emailed to someone who signed up for an
// opportunity without an account (server/routes/emailSignups.js). Opening it
// changes nothing; Confirm holds the spot. Then their volunteer badge shows
// here: a QR code staff scan at check-in (/badge/<code>), with a live clock
// and a moving shine like the app's badge, so a screenshot is easy to spot.
// Robots-disallowed (scripts/seo-pages.mjs).

const apiUrl = import.meta.env.VITE_API_URL || '/api'

export default function EmailSignup() {
  useSeo({ title: tr('Your volunteer sign-up'), path: '/signup' })
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch(`${apiUrl}/email-signups/t/${encodeURIComponent(token)}`)
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || tr('Could not load your sign-up.')); return d })
      .then(setData)
      .catch((e) => setError(e.message))
  }, [token])

  const act = async (what) => {
    setBusy(true)
    setError('')
    try {
      const r = await fetch(`${apiUrl}/email-signups/t/${encodeURIComponent(token)}/${what}`, { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || tr('Something went wrong. Try again.'))
      setData(d)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const ev = data?.event
  return (
    <div className="min-h-screen page-shell">
      <PublicHeader />
      <main className="max-w-md mx-auto px-4 pb-20 space-y-4">
        {!data && !error && <p className="mt-10 text-center text-earth-500">{tr('Loading…')}</p>}
        {error && !data && <Card className="mt-6 text-center"><p>{error}</p><Link to="/volunteer-opportunities" className="btn-primary mt-4 inline-flex">{tr('Volunteer opportunities')}</Link></Card>}
        {data && (
          <>
            <Card className="mt-6">
              <h1 className="text-xl font-bold">{ev.title}</h1>
              <p className="mt-1 text-sm text-earth-500 dark:text-earth-400 flex flex-wrap gap-x-4 gap-y-1">
                <span className="inline-flex items-center gap-1"><Calendar className="w-4 h-4" aria-hidden="true" />{fmtDate(ev.date)}{ev.time ? ` · ${ev.time}` : ''}</span>
                <span className="inline-flex items-center gap-1">{ev.online ? <Globe className="w-4 h-4" aria-hidden="true" /> : <MapPin className="w-4 h-4" aria-hidden="true" />}{ev.online ? tr('Online') : ev.location}</span>
              </p>
              {ev.organizer && <p className="mt-1 text-sm">{ev.organizer}</p>}
            </Card>

            {ev.cancelled ? (
              <Card><p>{tr('This event was cancelled.')}</p></Card>
            ) : ev.over ? (
              <Card><p>{tr('This event is over.')}</p></Card>
            ) : data.confirmed && data.badge ? (
              <>
                <Badge name={data.name} title={ev.title} badge={data.badge} />
                <button type="button" className="btn-ghost w-full text-sm" onClick={() => { if (window.confirm(tr('Give up your spot?'))) act('cancel') }} disabled={busy}>{tr('Cancel my spot')}</button>
              </>
            ) : (
              <Card className="space-y-3">
                <p>{data.cancelled ? tr('You gave up your spot. Changed your mind?') : tr('Hi {name}, press Confirm to hold your spot.', { name: data.name })}</p>
                <button type="button" className="btn-primary w-full" onClick={() => act('confirm')} disabled={busy}>{busy ? tr('Saving…') : tr('Confirm my spot')}</button>
              </Card>
            )}
            {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 text-center">{error}</p>}

            <Card className="text-center">
              <p className="text-sm text-earth-600 dark:text-earth-300">{tr('Want your hours tracked and signed? Create a free account with this email address.')}</p>
              <Link to="/register/student" className="btn-secondary mt-3 inline-flex">{tr('Create a free account')}</Link>
            </Card>
          </>
        )}
      </main>
      <Footer />
    </div>
  )
}

function Badge({ name, title, badge }) {
  const canvas = useRef(null)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => {
    if (canvas.current) QRCode.toCanvas(canvas.current, badge.url, { width: 200, margin: 1, color: { dark: '#0f2a1a', light: '#ffffff' } }).catch(() => {})
  }, [badge.url])
  return (
    <Card className="relative overflow-hidden text-center bg-brand-700 text-white">
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 badge-shine" />
      <p className="text-xs uppercase tracking-widest opacity-80">{tr('Volunteer badge')}</p>
      <p className="mt-1 text-2xl font-bold">{name}</p>
      <p className="text-sm opacity-90">{title}</p>
      <div className="mt-4 inline-block rounded-xl bg-white p-2"><canvas ref={canvas} aria-label={tr('Check-in QR code')} /></div>
      <p className="mt-3 inline-flex items-center gap-1 text-sm"><CheckCircle2 className="w-4 h-4" aria-hidden="true" />{tr('Your spot is held. Show this at check-in.')}</p>
      <p className="mt-1 font-mono text-lg tabular-nums">{now.toLocaleTimeString()}</p>
    </Card>
  )
}
