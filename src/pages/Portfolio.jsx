import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Sprout, Flame, Award, Medal, Trophy, Crown, Compass, Sparkles, CalendarCheck, Sun, TrendingUp,
  BadgeCheck, Printer, Loader2,
} from 'lucide-react'
import Card from '@/components/Card.jsx'
import { useSeo } from '@/hooks/useSeo.js'
import { BADGES } from '@/lib/achievements.js'
import { getPublicPortfolio } from '@/lib/portfolio.js'
import { tr } from '@/lib/i18n.js'
import { fmtDate } from '@/utils/date.js'

// Public volunteer portfolio (/p/:slug): what a student chose to share from
// their APPROVED hours, for a college application. No sign-in; the slug is the
// key. Kept out of search engines with a robots noindex tag (and the API
// sends X-Robots-Tag), and laid out to print cleanly.

const ICONS = { Sprout, Flame, Award, Medal, Trophy, Crown, Compass, Sparkles, CalendarCheck, Sun, TrendingUp }

function hours(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100
  return tr('{n} h', { n: v.toLocaleString() })
}

export default function Portfolio() {
  const { slug } = useParams()
  const [state, setState] = useState({ status: 'loading' })

  useSeo({
    title: state.data ? tr('{name} · Volunteer portfolio', { name: state.data.name }) : tr('Volunteer portfolio'),
    description: tr('Volunteer hours verified by organizers on VolunTrack.'),
    path: `/p/${slug}`,
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
    getPublicPortfolio(slug)
      .then((data) => { if (live) setState({ status: 'ready', data }) })
      .catch((e) => { if (live) setState({ status: e.status === 404 ? 'missing' : 'error', message: e.message }) })
    return () => { live = false }
  }, [slug])

  return (
    <div className="min-h-screen px-4 py-8 page-shell text-earth-900 dark:text-earth-100 print:bg-white print:text-black print:py-0">
      <div className="w-full max-w-2xl mx-auto">
        <Link to="/" className="flex items-center gap-2.5 justify-center mb-6 print:mb-3">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="" className="w-9 h-9 object-contain" />
          <span className="font-display font-bold text-xl">VolunTrack</span>
        </Link>

        {state.status === 'loading' && (
          <Card className="grid place-items-center py-16"><Loader2 className="w-6 h-6 text-brand-600 animate-spin" aria-label={tr('Loading…')} /></Card>
        )}
        {state.status === 'missing' && (
          <Card className="text-center">
            <h1 className="text-xl font-bold">{tr('This portfolio isn\'t available')}</h1>
            <p className="text-sm text-earth-500 dark:text-earth-400 mt-2">
              {tr('The link may be mistyped, or the student may have turned their page off or made a new link.')}
            </p>
          </Card>
        )}
        {state.status === 'error' && (
          <Card className="text-center">
            <p className="text-sm text-amber-600 dark:text-amber-300">{state.message}</p>
          </Card>
        )}
        {state.status === 'ready' && <PortfolioBody data={state.data} />}
      </div>
    </div>
  )
}

function PortfolioBody({ data }) {
  const badges = (data.badges || []).map((id) => BADGES.find((b) => b.id === id)).filter(Boolean)
  return (
    <Card padded={false} className="p-6 sm:p-8 print:shadow-none print:border-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">{tr('Volunteer portfolio')}</p>
      <h1 className="text-2xl sm:text-3xl font-display font-bold mt-1 break-words">{data.name}</h1>
      {data.school && <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">{data.school}</p>}

      <div className="mt-6 flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <div className="text-4xl font-display font-bold text-brand-700 dark:text-brand-300">{hours(data.totalHours)}</div>
          <div className="text-sm text-earth-500 dark:text-earth-400">
            {data.entryCount === 1 ? tr('1 approved entry') : tr('{n} approved entries', { n: data.entryCount })}
          </div>
        </div>
      </div>
      {data.entryCount > 0 ? (
        <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
          <BadgeCheck className="w-4 h-4 shrink-0" /> {tr('Hours verified by organizers on VolunTrack')}
        </p>
      ) : (
        <p className="mt-3 text-sm text-earth-500 dark:text-earth-400">{tr('No approved hours yet.')}</p>
      )}

      {data.categories?.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display font-semibold mb-3">{tr('Hours by category')}</h2>
          <ul className="space-y-2">
            {data.categories.map((c) => (
              <li key={c.category}>
                <div className="flex justify-between gap-3 text-sm">
                  <span>{tr(c.category)}</span>
                  <span className="font-medium tabular-nums">{hours(c.hours)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-earth-100 dark:bg-[#1f2e25] mt-1 overflow-hidden print:border print:border-earth-200">
                  <div className="h-full bg-brand-500" style={{ width: `${data.totalHours ? Math.max(2, (c.hours / data.totalHours) * 100) : 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {badges.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display font-semibold mb-3">{tr('Badges')}</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {badges.map((b) => {
              const Icon = ICONS[b.icon] || Trophy
              return (
                <li key={b.id} className="flex items-center gap-2.5 rounded-xl border border-earth-100 dark:border-[#1f2e25] px-3 py-2 text-sm">
                  <Icon className="w-4 h-4 text-brand-600 shrink-0" /> {b.title}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {data.activities?.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display font-semibold mb-3">{tr('Activities')}</h2>
          <ul className="divide-y divide-earth-100 dark:divide-[#1f2e25]">
            {data.activities.map((a, i) => (
              <li key={`${a.date}-${i}`} className="flex items-baseline justify-between gap-3 py-2 text-sm break-inside-avoid">
                <div className="min-w-0">
                  <div className="font-medium break-words">{a.title}</div>
                  <div className="text-xs text-earth-500 dark:text-earth-400">{fmtDate(a.date)}</div>
                </div>
                <span className="font-medium tabular-nums shrink-0">{hours(a.hours)}</span>
              </li>
            ))}
          </ul>
          {data.activitiesTruncated && (
            <p className="text-xs text-earth-500 dark:text-earth-400 mt-2">{tr('Showing the most recent {n} activities.', { n: data.activities.length })}</p>
          )}
        </section>
      )}

      <div className="mt-8 pt-4 border-t border-earth-100 dark:border-[#1f2e25] flex flex-wrap items-center justify-between gap-3 text-xs text-earth-500 dark:text-earth-400">
        <span>{tr('Shared by the student from VolunTrack. Only hours an organizer or supervisor approved are counted.')}</span>
        <button onClick={() => window.print()} className="btn-secondary inline-flex items-center gap-1.5 text-sm print:hidden">
          <Printer className="w-4 h-4" /> {tr('Print')}
        </button>
      </div>
    </Card>
  )
}
