import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarDays, Clock, MapPin, Video, ArrowRight, Info, Ticket, Mail, CheckCircle2, Gift } from 'lucide-react'
import Footer from '@/components/Footer.jsx'
import PublicHeader from '@/components/PublicHeader.jsx'
import { useSeo } from '@/hooks/useSeo.js'
import { upcomingEvent, eventById, eventWhen, agendaLines, isUnderWay, isUpcoming } from '@/lib/schoolEvents.js'

// /events (#995): the next session VolunTrack runs for school staff, districts
// and nonprofits, added in Admin → Invites → Events for schools. Shown only
// while one is coming up; otherwise a short note. /events?id=… links to one
// event, and says so once it has ended. English only, like
// /for-schools, since it's for US school staff.

const CONTACT_EMAIL = 'volunteertrackinfo@gmail.com'

function Row({ icon: Icon, children }) {
  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      <Icon className="w-4 h-4 shrink-0 text-amber-500 dark:text-amber-300" aria-hidden="true" />
      <span className="min-w-0 break-words">{children}</span>
    </span>
  )
}

function CopyEmail() {
  const [label, setLabel] = useState('Copy email')
  const copy = async () => {
    try { await navigator.clipboard.writeText(CONTACT_EMAIL); setLabel('Copied') } catch { setLabel('Select and copy it') }
    setTimeout(() => setLabel('Copy email'), 2500)
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-sm px-3 py-2 rounded-lg border border-earth-200 dark:border-white/10 bg-white dark:bg-white/5 select-all break-all">{CONTACT_EMAIL}</span>
      <button type="button" onClick={copy} className="btn-ghost btn-sm">{label}</button>
    </div>
  )
}

export default function SchoolEvent() {
  const [params] = useSearchParams()
  const id = params.get('id')
  const [ev, setEv] = useState(undefined) // undefined = loading, null = none
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    window.scrollTo(0, 0)
    let alive = true
    setEv(undefined); setMissing(false)
    if (id) eventById(id).then((r) => { if (alive) { setEv(r.event); setMissing(r.missing) } })
    else upcomingEvent().then((e) => { if (alive) setEv(e) })
    return () => { alive = false }
  }, [id])
  const ended = Boolean(ev) && !isUpcoming(ev)

  useSeo({
    title: ev?.title || 'VolunTrack events for schools and organizations',
    description: 'Sessions for school advisers, counselors, district leaders and nonprofits to see how VolunTrack handles student volunteer hours.',
    path: '/events',
  })

  const when = ev ? eventWhen(ev) : null
  const agenda = ev ? agendaLines(ev.agenda) : []
  const online = ev?.mode === 'online'

  return (
    <div className="min-h-screen page-shell">
      <PublicHeader>
        <Link to="/for-schools" className="btn-ghost">For schools</Link>
        <Link to="/login" className="btn-ghost">Sign in</Link>
      </PublicHeader>

      <main className="max-w-4xl mx-auto px-4 md:px-8 pb-20">
        {ev === undefined ? (
          <p className="text-center text-earth-500 py-24">Loading…</p>
        ) : (missing || ended) ? (
          <section className="text-center max-w-xl mx-auto py-20">
            <CalendarDays className="w-10 h-10 mx-auto text-brand-600 dark:text-brand-400" aria-hidden="true" />
            <h1 className="mt-4 text-3xl font-bold">{ended ? 'This event has ended' : 'We couldn’t find that event'}</h1>
            <p className="mt-3 text-earth-600 dark:text-earth-300">{ended ? `${ev.title} took place on ${when.day}. Thanks to everyone who came.` : 'The link may be old, or the event was removed.'}</p>
            <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
              <Link to="/events" className="btn-primary inline-flex items-center justify-center gap-2">See the next event <ArrowRight className="w-4 h-4" aria-hidden="true" /></Link>
              <Link to="/for-schools" className="btn-secondary">VolunTrack for schools</Link>
            </div>
          </section>
        ) : !ev ? (
          <section className="text-center max-w-xl mx-auto py-20">
            <CalendarDays className="w-10 h-10 mx-auto text-brand-600 dark:text-brand-400" aria-hidden="true" />
            <h1 className="mt-4 text-3xl font-bold">No events coming up right now</h1>
            <p className="mt-3 text-earth-600 dark:text-earth-300">We run short sessions for schools, districts and organizations a few times a year. In the meantime, see what VolunTrack does for schools, or ask us for a walkthrough.</p>
            <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
              <Link to="/for-schools" className="btn-primary inline-flex items-center justify-center gap-2">VolunTrack for schools <ArrowRight className="w-4 h-4" aria-hidden="true" /></Link>
              <Link to="/contact?topic=school" className="btn-secondary">Ask for a walkthrough</Link>
            </div>
          </section>
        ) : (
          <>
            <section className="rounded-3xl bg-[#10241A] text-[#EEF3EC] px-6 py-10 md:px-12 md:py-14 shadow-xl">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">{isUnderWay(ev) ? 'Happening now' : 'For schools, districts & organizations'}</p>
              <h1 className="mt-3 text-3xl md:text-5xl font-bold leading-tight text-balance">{ev.title}</h1>
              <div className="mt-6 flex flex-col sm:flex-row sm:flex-wrap gap-x-6 gap-y-2 text-[#EEF3EC]">
                <Row icon={CalendarDays}>{when.day}</Row>
                <Row icon={Clock}>{when.time} · {ev.durationMinutes} minutes</Row>
                <Row icon={online ? Video : MapPin}>{online ? 'Online' : ev.place}</Row>
              </div>
              <div className="mt-8 flex flex-col sm:flex-row gap-3 sm:items-center">
                {ev.rsvpUrl ? (
                  <a href={ev.rsvpUrl} target="_blank" rel="noopener noreferrer" className="btn-primary inline-flex items-center justify-center gap-2 px-6 py-3 text-base">Save my spot <ArrowRight className="w-4 h-4" aria-hidden="true" /></a>
                ) : (
                  <span className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-white/10 text-[#A9C2B4] font-semibold">RSVP opens soon</span>
                )}
                <p className="text-sm text-[#A9C2B4]">Free. {online ? 'You’ll get the join link by email.' : 'You’ll get a confirmation email with your QR ticket.'}</p>
              </div>
            </section>

            {agenda.length > 0 && (
              <section className="mt-14">
                <p className="text-sm font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">Agenda</p>
                <h2 className="mt-2 text-2xl md:text-3xl font-bold">What we’ll cover</h2>
                <ol className="mt-6 rounded-2xl border border-earth-200 dark:border-white/10 bg-white dark:bg-white/5 divide-y divide-earth-200 dark:divide-white/10">
                  {agenda.map((a, i) => (
                    <li key={i} className="grid grid-cols-[4.5rem_1fr] gap-4 px-5 py-4">
                      <span className="font-mono text-sm text-brand-600 dark:text-brand-400 tabular-nums pt-0.5">{a.time || '·'}</span>
                      <span className="min-w-0">{a.text}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <section className="mt-14">
              <p className="text-sm font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">Who it’s for</p>
              <h2 className="mt-2 text-2xl md:text-3xl font-bold">The people who sign off on service hours</h2>
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                {[
                  ['Advisers & counselors', 'NHS, Key Club, service-learning and graduation requirements.'],
                  ['School & district leaders', 'One view of every school’s hours, progress and reports.'],
                  ['Nonprofits & organizers', 'Post events, check volunteers in and sign their hours.'],
                ].map(([h, p]) => (
                  <div key={h} className="card p-5 min-w-0">
                    <h3 className="font-semibold">{h}</h3>
                    <p className="mt-1 text-sm text-earth-600 dark:text-earth-300">{p}</p>
                  </div>
                ))}
              </div>
              <p className="mt-4 flex items-start gap-3 rounded-xl px-4 py-3 bg-amber-50 text-amber-900 dark:bg-amber-300/10 dark:text-amber-100">
                <Info className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
                <span>This session is for school and organization staff. Students can start using VolunTrack free any time, on their own.</span>
              </p>
            </section>

            {(ev.hasOfferCode || ev.offerText) && (
              <section className="mt-14">
                <p className="text-sm font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">For everyone who attends</p>
                <h2 className="mt-2 text-2xl md:text-3xl font-bold">An event code for your school</h2>
                <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl border border-dashed border-brand-500 bg-white dark:bg-white/5 p-6">
                  {ev.hasOfferCode && (
                    <span className="inline-flex shrink-0 whitespace-nowrap items-center gap-2 font-semibold px-4 py-3 rounded-xl border border-earth-200 dark:border-white/10 self-start">
                      <Gift className="w-5 h-5 text-brand-500" aria-hidden="true" /> Shared live at the event
                    </span>
                  )}
                  <p className="text-earth-700 dark:text-earth-200 min-w-0">
                    {ev.offerText || 'A code to use when you sign up your school or organization.'}
                    {ev.hasOfferCode && ' We give the code out during the session, so be there to get it.'} Clubs of up to 50 students are always free.
                  </p>
                </div>
              </section>
            )}

            <section className="mt-14">
              <p className="text-sm font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">How to join</p>
              <h2 className="mt-2 text-2xl md:text-3xl font-bold">Three steps</h2>
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                {[
                  [Ticket, 'Save your spot', 'Press Save my spot and fill in your name, school or organization, and role.'],
                  [Mail, 'Check your email', online ? 'You’ll get the link to join the session.' : 'You’ll get a QR ticket for the door.'],
                  [CheckCircle2, online ? 'Join a few minutes early' : 'Check in', online ? 'Open the link from your email just before it starts.' : 'Show your QR code when you arrive.'],
                ].map(([Icon, h, p]) => (
                  <div key={h} className="card p-5 min-w-0">
                    <Icon className="w-6 h-6 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                    <h3 className="mt-3 font-semibold">{h}</h3>
                    <p className="mt-1 text-sm text-earth-600 dark:text-earth-300">{p}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-14">
              <p className="text-sm font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">Questions</p>
              <h2 className="mt-2 text-2xl md:text-3xl font-bold">Talk to us</h2>
              <p className="mt-2 text-earth-600 dark:text-earth-300">Email us any time before the session.</p>
              <div className="mt-4"><CopyEmail /></div>
              <p className="mt-4 text-sm text-earth-600 dark:text-earth-300">More about VolunTrack for schools: <Link to="/for-schools" className="text-brand-700 dark:text-brand-300 underline">For schools</Link></p>
            </section>
          </>
        )}
      </main>
      <Footer />
    </div>
  )
}
