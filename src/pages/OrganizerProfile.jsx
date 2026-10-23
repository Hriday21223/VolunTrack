import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Bell, BellRing, Share2, Globe, Calendar as CalIcon, Users, Clock, Star, ArrowLeft } from 'lucide-react'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import { categoryColor } from '@/lib/categories.js'
import { isNativeApp } from '@/lib/platform.js'
import { fmtDate } from '@/utils/date.js'
import { tr } from '@/lib/i18n.js'
import { useAuth } from '@/hooks/useAuth.jsx'
import { fetchOrganizer, setFollowOrganizer, organizerShareUrl } from '@/lib/organizerProfile.js'

// Shared links point at the website, as on Opportunities.
const SITE = (isNativeApp && import.meta.env.VITE_SITE_URL) || window.location.origin

// /organizers/:id — an organizer's profile for signed-in students: About,
// website, causes, upcoming tasks, rating (3+ ratings) and the volunteer
// hours given at their tasks. Suspended or blocked organizers are a 404.
export default function OrganizerProfile() {
  const { id } = useParams()
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [state, setState] = useState('loading') // loading | ok | missing | error
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    let cancelled = false
    setState('loading')
    fetchOrganizer(id)
      .then((d) => {
        if (cancelled) return
        if (!d) { setState('error'); return }
        setData(d)
        setState('ok')
      })
      .catch((e) => { if (!cancelled) setState(e.status === 404 ? 'missing' : 'error') })
    return () => { cancelled = true }
  }, [id])

  const org = data?.organizer
  const canFollow = user?.role === 'student' && org && !org.isMe

  const toggleFollow = async () => {
    setBusy(true)
    const follow = !org.iFollow
    try {
      await setFollowOrganizer(org.id, follow)
      setData((d) => ({ ...d, organizer: { ...d.organizer, iFollow: follow } }))
      setToast(follow ? tr("Following — we'll email you when they post a new task.") : tr('Unfollowed.'))
    } catch (e) {
      setToast(e.message || tr('Something went wrong. Try again.'))
    } finally { setBusy(false) }
  }

  // The phone's share sheet where there is one, else copy the link.
  const share = async () => {
    const url = organizerShareUrl(org.id, SITE)
    if (navigator.share) {
      try {
        await navigator.share({ title: org.name, text: tr('Volunteer with {name}', { name: org.name }), url })
        return
      } catch (e) {
        if (e?.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setToast(tr('Link copied'))
    } catch {
      setToast(tr('Could not copy. Here is the link: {url}', { url }))
    }
  }

  return (
    <AppLayout title={org?.name || tr('Organizer')} subtitle={tr('Organizer profile')}>
      <div className="max-w-3xl mx-auto space-y-4">
        <Link to="/opportunities" className="inline-flex items-center gap-1 text-sm text-earth-500 hover:text-brand-400">
          <ArrowLeft className="w-4 h-4" /> {tr('Back to Opportunities')}
        </Link>

        {state === 'loading' && <Card><p className="text-sm text-earth-500">{tr('Loading…')}</p></Card>}
        {state === 'missing' && (
          <Card><p className="text-sm text-earth-500">{tr("This organizer's page isn't available.")}</p></Card>
        )}
        {state === 'error' && (
          <Card><p role="alert" className="text-sm text-red-500">{tr('Could not load this organizer.')}</p></Card>
        )}

        {state === 'ok' && org && (
          <>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="font-display text-xl font-semibold break-words min-w-0">{org.name}</h2>
                <div className="flex flex-wrap gap-2">
                  {canFollow && (
                    <button
                      type="button"
                      onClick={toggleFollow}
                      disabled={busy}
                      aria-pressed={Boolean(org.iFollow)}
                      className={`btn-sm inline-flex items-center gap-1 ${org.iFollow ? 'btn-primary' : 'btn-ghost border border-earth-200 dark:border-white/10'} disabled:opacity-50`}
                    >
                      {org.iFollow ? <BellRing className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                      {org.iFollow ? tr('Following') : tr('Follow')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={share}
                    className="btn-sm btn-ghost border border-earth-200 dark:border-white/10 inline-flex items-center gap-1"
                  >
                    <Share2 className="w-4 h-4" /> {tr('Share')}
                  </button>
                </div>
              </div>

              {org.about
                ? <p className="mt-3 text-sm whitespace-pre-line break-words">{org.about}</p>
                : <p className="mt-3 text-sm text-earth-500">{tr("This organizer hasn't written an About yet.")}</p>}

              {org.website && (
                <a
                  href={org.website}
                  target="_blank"
                  rel="noopener noreferrer nofollow ugc"
                  className="mt-3 inline-flex items-center gap-1 text-sm text-brand-500 hover:underline break-all"
                >
                  <Globe className="w-4 h-4 shrink-0" /> {org.website.replace(/^https:\/\//i, '')}
                </a>
              )}

              {org.causes.length > 0 && (
                <div className="mt-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-earth-500 mb-1">{tr('Causes')}</h3>
                  <div className="flex flex-wrap gap-2">
                    {org.causes.map((c) => (
                      <span key={c} className={`text-xs px-2 py-0.5 rounded-full ${categoryColor(c)}`}>{tr(c)}</span>
                    ))}
                  </div>
                </div>
              )}

              <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-earth-200 dark:border-white/10 p-3">
                  <dt className="text-xs text-earth-500 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {tr('Volunteer hours given')}</dt>
                  <dd className="font-display text-lg font-semibold">{tr('{n} hours', { n: org.hoursGiven })}</dd>
                </div>
                <div className="rounded-xl border border-earth-200 dark:border-white/10 p-3">
                  <dt className="text-xs text-earth-500 flex items-center gap-1"><Star className="w-3.5 h-3.5" /> {tr('Rating')}</dt>
                  <dd className="font-display text-lg font-semibold">
                    {org.rating
                      ? <span className="text-amber-400">★ {Number(org.rating.average).toFixed(1)} <span className="text-sm text-earth-500 font-normal">({org.rating.count})</span></span>
                      : <span className="text-sm text-earth-500 font-normal">{tr('Not enough ratings yet')}</span>}
                  </dd>
                </div>
              </dl>
            </Card>

            <Card>
              <h3 className="font-display font-semibold mb-2">{tr('Upcoming tasks')}</h3>
              {data.tasks.length === 0
                ? <p className="text-sm text-earth-500">{tr('No upcoming tasks right now.')}</p>
                : (
                  <ul className="space-y-2">
                    {data.tasks.map((t) => (
                      <li key={t.id}>
                        <Link
                          to={`/opportunities?task=${encodeURIComponent(t.id)}`}
                          className="block rounded-xl border border-earth-200 dark:border-white/10 p-3 hover:border-brand-400"
                        >
                          <span className="font-medium break-words">{t.title}</span>
                          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-earth-500">
                            <span className="inline-flex items-center gap-1"><CalIcon className="w-3 h-3" /> {fmtDate(t.date)}{t.time ? ` · ${t.time}` : ''}</span>
                            <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> {t.slots_filled}/{t.slots_total}{' '}{tr('slots')}</span>
                            {t.category && <span className={`px-2 rounded-full ${categoryColor(t.category)}`}>{tr(t.category)}</span>}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
            </Card>
          </>
        )}
      </div>
      <Toast open={Boolean(toast)} onClose={() => setToast('')}>{toast}</Toast>
    </AppLayout>
  )
}
