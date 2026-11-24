import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Loader2, Heart, MapPin, Flame, CalendarDays, BadgeCheck } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { useSeo } from '@/hooks/useSeo.js'
import { getPublicYearShare } from '@/lib/yearShare.js'
import { tr, language } from '@/lib/i18n.js'

// The public page behind a Year in review share link (/y/<slug>, #1005).
// Totals only, worked out by the server; see server/routes/yearShare.js.

const monthName = (m, style = 'long') =>
  new Date(2000, m, 1).toLocaleString(language || undefined, { month: style })

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10
const hoursText = (n) => (round1(n) === 1 ? tr('1 hour') : tr('{n} hours', { n: round1(n) }))

export default function YearShare() {
  const { slug } = useParams()
  const [state, setState] = useState({ status: 'loading' })
  const data = state.data

  useSeo({
    title: data
      ? (data.name ? tr("{name}'s {year} in volunteering", { name: data.name, year: data.year }) : tr('A {year} in volunteering', { year: data.year }))
      : tr('Year in review'),
    description: tr('A year of volunteering, tracked with VolunTrack.'),
    path: `/y/${slug}`,
  })

  useEffect(() => {
    const tag = document.createElement('meta')
    tag.name = 'robots'
    tag.content = 'noindex, nofollow'
    document.head.appendChild(tag)
    return () => tag.remove()
  }, [])

  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    getPublicYearShare(slug)
      .then((d) => { if (live) setState({ status: 'ready', data: d }) })
      .catch((e) => { if (live) setState({ status: e.status === 404 ? 'missing' : 'error', message: e.message }) })
    return () => { live = false }
  }, [slug])

  return (
    <div className="min-h-screen px-4 py-8 page-shell text-earth-900 dark:text-earth-100">
      <div className="w-full max-w-2xl mx-auto space-y-4">
        <Link to="/" className="flex items-center gap-2.5 justify-center mb-2">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="" className="w-9 h-9 object-contain" />
          <span className="font-display font-bold text-xl">VolunTrack</span>
        </Link>

        {state.status === 'loading' && (
          <Card className="grid place-items-center py-16"><Loader2 className="w-6 h-6 text-brand-600 animate-spin" aria-label={tr('Loading…')} /></Card>
        )}
        {state.status === 'missing' && (
          <Card className="text-center">
            <h1 className="text-xl font-bold">{tr('This link isn’t working anymore')}</h1>
            <p className="text-sm text-earth-500 dark:text-earth-400 mt-2">
              {tr('It may be mistyped, turned off by the student, or more than 30 days old.')}
            </p>
          </Card>
        )}
        {state.status === 'error' && (
          <Card className="text-center"><p className="text-sm text-amber-600 dark:text-amber-300">{state.message}</p></Card>
        )}
        {state.status === 'ready' && <Body d={data} />}

        <Card className="text-center">
          <p className="font-display font-semibold">{tr('Track your own volunteer hours')}</p>
          <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">{tr('Free for students. Log hours in a minute and get them signed.')}</p>
          <Link to="/register" className="btn-primary btn-sm mt-3 inline-flex">{tr('Get started')}</Link>
        </Card>
      </div>
    </div>
  )
}

function Body({ d }) {
  const maxMonth = Math.max(...d.months, 0.0001)
  return (
    <>
      <Card padded={false} className="overflow-hidden">
        <div className="bg-gradient-to-br from-brand-800 via-slate-950 to-slate-900 p-5 sm:p-7 text-white">
          <h1 className="text-xs uppercase tracking-[0.3em] text-brand-300">
            {d.name ? tr("{name}'s {year} in volunteering", { name: d.name, year: d.year }) : tr('A {year} in volunteering', { year: d.year })}
          </h1>
          <div className="mt-3 flex items-end gap-2 flex-wrap">
            <span className="font-display text-5xl sm:text-6xl font-extrabold leading-none text-brand-200">{round1(d.totalHours)}</span>
            <span className="text-xl font-semibold text-slate-200 pb-1">{round1(d.totalHours) === 1 ? tr('hour') : tr('hours')}</span>
          </div>
          <p className="mt-2 text-slate-300">{tr('{n} sessions of volunteering', { n: d.sessions })}</p>
          {d.approvedHours > 0 && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-emerald-300">
              <BadgeCheck className="w-4 h-4 shrink-0" /> {tr('{hours} approved by a supervisor or organizer', { hours: hoursText(d.approvedHours) })}
            </p>
          )}
        </div>
      </Card>

      {d.categories.length > 0 && (
        <Stat icon={Heart} label={tr('Top cause')}>
          <div className="font-display text-2xl font-bold">{tr(d.categories[0].category)}</div>
          <ul className="mt-3 space-y-2">
            {d.categories.map((c) => (
              <li key={c.category}>
                <div className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{tr(c.category)}</span>
                  <span className="shrink-0 text-earth-500 dark:text-earth-400">{round1(c.hours)}h</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-earth-100 dark:bg-[#1b2a22] overflow-hidden" aria-hidden="true">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(4, (c.hours / (d.totalHours || 1)) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
          {d.moreCategories > 0 && (
            <p className="mt-2 text-xs text-earth-500 dark:text-earth-400">{tr('+{n} more causes', { n: d.moreCategories })}</p>
          )}
        </Stat>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Stat icon={MapPin} label={tr('Places helped')}>
          <div className="font-display text-3xl font-bold">{d.places}</div>
          <p className="text-sm text-earth-500 dark:text-earth-400">{tr('different organizations and places')}</p>
        </Stat>
        <Stat icon={Flame} label={tr('Longest streak')}>
          <div className="font-display text-3xl font-bold">
            {d.longestWeekStreak === 1 ? tr('1 week') : tr('{n} weeks', { n: d.longestWeekStreak })}
          </div>
          <p className="text-sm text-earth-500 dark:text-earth-400">{tr('in a row with at least one session')}</p>
        </Stat>
      </div>

      <Stat icon={CalendarDays} label={tr('Busiest month')}>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-display text-2xl font-bold capitalize">{monthName(d.busiestMonth.month)}</span>
          <span className="text-sm text-earth-500 dark:text-earth-400">{hoursText(d.busiestMonth.hours)}</span>
        </div>
        <div className="mt-3 grid grid-cols-12 gap-1 items-end h-20" role="img"
          aria-label={d.months.map((h, m) => `${monthName(m)}: ${hoursText(h)}`).join(', ')}>
          {d.months.map((h, m) => (
            <div key={m} className="flex flex-col items-center gap-1 h-full justify-end min-w-0">
              <div className={`w-full rounded-t ${m === d.busiestMonth.month ? 'bg-brand-500' : 'bg-brand-200 dark:bg-brand-900/60'}`}
                style={{ height: `${h > 0 ? Math.max(6, (h / maxMonth) * 100) : 0}%` }} />
            </div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-12 gap-1 text-[0.625rem] text-center text-earth-500 dark:text-earth-400" aria-hidden="true">
          {d.months.map((_, m) => <span key={m} className="truncate">{monthName(m, 'narrow')}</span>)}
        </div>
      </Stat>
    </>
  )
}

function Stat({ icon: Icon, label, children }) {
  return (
    <Card className="min-w-0">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-earth-500 dark:text-earth-400">
        <Icon className="w-4 h-4 text-brand-500" aria-hidden="true" /> {label}
      </div>
      <div className="mt-2">{children}</div>
    </Card>
  )
}
