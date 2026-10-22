import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MapPin, Calendar as CalIcon, Users, Flag, X, Bell, BellRing, ChevronDown, Bookmark, BookmarkCheck, Search, Share2 } from 'lucide-react'
import { addDays, format, nextSaturday, isSaturday, isSunday } from 'date-fns'
import { ACTIVITY_CATEGORIES, categoryColor } from '@/lib/categories.js'
import AddToCalendar from '@/components/AddToCalendar.jsx'
import ScanCheckinButton from '@/components/ScanCheckinButton.jsx'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import { isNativeApp } from '@/lib/platform.js'
import { fmtDate } from '@/utils/date.js'
import ReportTaskDialog from '@/components/ReportTaskDialog.jsx'
import CancelSignup from '@/components/CancelSignup.jsx'
import InviteFriends from '@/components/InviteFriends.jsx'
import { tr } from '@/lib/i18n.js'
import { useAuth } from '@/hooks/useAuth.jsx'
import { MAX_SEARCH_LENGTH, cleanSearch, taskMatchesSearch, taskShareUrl } from '@/lib/taskSearch.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// Shared links point at the website. In the apps the page's own origin is
// capacitor://localhost (or https://localhost), so use the site's address.
const SITE = (isNativeApp && import.meta.env.VITE_SITE_URL) || window.location.origin

const fmtDist = (km) => {
  if (km === null || km === undefined) return null
  const n = Number(km)
  if (n < 1) return `${Math.round(n * 1000)}m`
  return `${n.toFixed(1)}km`
}

// The "When" filter: each choice is a range of calendar days, inclusive, in
// the viewer's own time zone (task dates are plain days).
const WHEN_OPTIONS = [
  { value: '', label: tr('Any date') },
  { value: 'today', label: tr('Today') },
  { value: 'week', label: tr('Next 7 days') },
  { value: 'weekend', label: tr('This weekend') },
  { value: 'month', label: tr('Next 30 days') },
]
function whenRange(when) {
  const now = new Date()
  const day = (d) => format(d, 'yyyy-MM-dd')
  if (when === 'today') return [day(now), day(now)]
  if (when === 'week') return [day(now), day(addDays(now, 6))]
  if (when === 'month') return [day(now), day(addDays(now, 29))]
  if (when === 'weekend') {
    if (isSunday(now)) return [day(now), day(now)]
    const sat = isSaturday(now) ? now : nextSaturday(now)
    return [day(sat), day(addDays(sat, 1))]
  }
  return null
}

export default function Opportunities() {
  const [nearbyTasks, setNearbyTasks] = useState([])
  // Until the first answer, "no opportunities" would be a guess — and on a
  // server waking up it's a guess people believe.
  const [loaded, setLoaded] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [userLoc, setUserLoc] = useState(null)
  const [nearbyRadius, setNearbyRadius] = useState(25)
  const [toast, setToast] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const [reporting, setReporting] = useState(null)
  // Following an organizer (students only): an email when they post a new task.
  const { user } = useAuth()
  const canFollow = user?.role === 'student' && Boolean(localStorage.getItem('voluntrack:auth_token'))
  const [following, setFollowing] = useState(null)
  const [followOpen, setFollowOpen] = useState(false)
  const [followBusy, setFollowBusy] = useState(null)
  const loadFollowing = useCallback(async () => {
    const token = localStorage.getItem('voluntrack:auth_token')
    if (!token) return
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/organizers/following`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setFollowing((await res.json()).following || [])
    } catch { /* the list just stays hidden */ }
  }, [])
  useEffect(() => { if (canFollow) loadFollowing() }, [canFollow, loadFollowing])
  const setFollow = async (organizerId, follow) => {
    setFollowBusy(organizerId)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/public-tasks/organizers/${encodeURIComponent(organizerId)}/follow`, {
        method: follow ? 'POST' : 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || tr('Something went wrong. Try again.'))
      setNearbyTasks((list) => list.map((t) => (t.organizer_id === organizerId ? { ...t, i_follow_organizer: follow } : t)))
      loadFollowing()
      setToastMsg(follow ? tr("Following — we'll email you when they post a new task.") : tr('Unfollowed.'))
      setToast(true)
    } catch (e) { setToastMsg(e.message); setToast(true) } finally { setFollowBusy(null) }
  }
  // Saving a task for later (students only). The saved list is its own fetch,
  // not a filter on the loaded one: a saved task may be outside the radius.
  const [savedTasks, setSavedTasks] = useState(null)
  const [showSaved, setShowSaved] = useState(false)
  const [saveBusy, setSaveBusy] = useState(null)
  const loadSaved = useCallback(async () => {
    const token = localStorage.getItem('voluntrack:auth_token')
    if (!token) return
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/saved`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setSavedTasks((await res.json()).tasks || [])
    } catch { /* the toggle just stays hidden */ }
  }, [])
  useEffect(() => { if (canFollow) loadSaved() }, [canFollow, loadSaved])
  const setSaved = async (taskId, save) => {
    setSaveBusy(taskId)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/public-tasks/${encodeURIComponent(taskId)}/save`, {
        method: save ? 'PUT' : 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || tr('Something went wrong. Try again.'))
      setNearbyTasks((list) => list.map((t) => (t.id === taskId ? { ...t, i_saved: save } : t)))
      loadSaved()
      setToastMsg(save ? tr("Saved. Find it under Saved at the top — we'll remind you if it's coming up or filling up.") : tr('Removed from Saved.'))
      setToast(true)
    } catch (e) { setToastMsg(e.message); setToast(true) } finally { setSaveBusy(null) }
  }
  // A friend's invite link: /opportunities?task=<id>&from=<inviterId>. The
  // task is scrolled to and highlighted, and signing up from that card passes
  // invitedBy so the organizer sees who they came with (the server checks it).
  const [searchParams, setSearchParams] = useSearchParams()
  const linkedTask = searchParams.get('task')
  const invitedFrom = searchParams.get('from')
  // Search: what's typed shows at once; the list (and ?q= in the address, so
  // it survives a reload) follows 250 ms after the last keystroke.
  const [searchInput, setSearchInput] = useState(() => cleanSearch(searchParams.get('q')))
  const search = cleanSearch(searchParams.get('q'))
  // A link opened while already here (the bell, Back) can change ?q= itself;
  // the box follows it rather than writing the old text back.
  const wroteQ = useRef(search)
  useEffect(() => {
    if (search === wroteQ.current) return
    wroteQ.current = search
    setSearchInput(search)
  }, [search])
  useEffect(() => {
    const next = cleanSearch(searchInput)
    if (next === search) return
    const timer = setTimeout(() => {
      wroteQ.current = next
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev)
        if (next) p.set('q', next)
        else p.delete('q')
        return p
      }, { replace: true })
    }, 250)
    return () => clearTimeout(timer)
  }, [searchInput, search, setSearchParams])
  const clearSearch = () => {
    setSearchInput('')
    wroteQ.current = ''
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.delete('q')
      return p
    }, { replace: true })
  }
  // Share: the phone's share sheet where there is one, else copy the link.
  const shareTask = async (t) => {
    const url = taskShareUrl(t.id, SITE)
    if (navigator.share) {
      try {
        await navigator.share({ title: t.title, text: tr('Volunteer with me: {title}', { title: t.title }), url })
        return
      } catch (e) {
        if (e?.name === 'AbortError') return
        // Share sheet unavailable here after all: fall through to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setToastMsg(tr('Link copied'))
    } catch {
      setToastMsg(tr('Could not copy. Here is the link: {url}', { url }))
    }
    setToast(true)
  }
  const scrolledTo = useRef(false)
  const canInvite = user?.role === 'student' && Boolean(localStorage.getItem('voluntrack:auth_token'))
  const reload = () => { loadNearbyTasks(userLoc?.lat ?? null, userLoc?.lng ?? null, nearbyRadius); if (canFollow) loadSaved() }
  // A full task offers the waitlist instead: no slot is held, and the first
  // person waiting moves up (and is emailed) when someone cancels.
  const signUp = async (t, full) => {
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/public-tasks/${t.id}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...(full ? { waitlist: true } : {}),
          ...(invitedFrom && t.id === linkedTask ? { invitedBy: invitedFrom } : {}),
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Failed')
      // Under 13: a parent says yes first (server/routes/school.js,
      // requestParentOk). parentAsked says who was asked.
      setToastMsg(d.parentPending
        ? (d.parentAsked === 'none'
          ? tr('Signed up. A parent needs to OK this first: ask them to make a VolunTrack parent account and link to you with the code from Settings → Family.')
          : tr("Signed up. We asked your parent to OK it — the organizer sees it once they do."))
        : d.waitlisted
          ? `You're #${d.position} on the waitlist. We'll email you if a spot opens up.`
          : tr('Signed up — awaiting organizer approval'))
      setToast(true)
      reload()
    } catch (e) { setToastMsg(e.message); setToast(true) }
  }
  // Filters run on the list already loaded; distance is the server's radius.
  const [category, setCategory] = useState('')
  const [when, setWhen] = useState('')
  const range = whenRange(when)
  const baseTasks = showSaved ? (savedTasks || []) : nearbyTasks
  const shownTasks = baseTasks.filter((t) =>
    (!category || t.category === category)
    && (!range || (String(t.date).slice(0, 10) >= range[0] && String(t.date).slice(0, 10) <= range[1]))
    && taskMatchesSearch(t, search, t.category ? [tr(t.category)] : []))
  const filtering = Boolean(category || when)

  const loadNearbyTasks = useCallback(async (lat, lng, radius) => {
    try {
      let url = `${apiUrl}/school/public-tasks?maxDistance=${radius}`
      if (lat != null && lng != null) url += `&lat=${lat}&lng=${lng}`
      // Signed in, so the server knows whose list this is: your sign-up status,
      // the organizer's phone once you're approved, and organizers you blocked
      // left out. It used to load anonymously, so none of those worked here.
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
      if (!res.ok) throw new Error(tr('unavailable'))
      const d = await res.json()
      setNearbyTasks(d.tasks || [])
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
    } finally { setLoaded(true) }
  }, [])

  useEffect(() => {
    // In the apps, location is asked for only from the Enable button below —
    // never as the page opens.
    if (navigator.geolocation && !isNativeApp) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
          setUserLoc(loc)
          loadNearbyTasks(loc.lat, loc.lng, nearbyRadius)
        },
        () => { loadNearbyTasks(null, null, nearbyRadius) },
        { enableHighAccuracy: true, timeout: 10000 },
      )
    } else {
      loadNearbyTasks(null, null, nearbyRadius)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A saved-task reminder links here; if that task is outside the radius,
  // it's only on the Saved list, so open that instead.
  useEffect(() => {
    if (!linkedTask || !loaded || !savedTasks || scrolledTo.current) return
    if (!nearbyTasks.some((t) => t.id === linkedTask) && savedTasks.some((t) => t.id === linkedTask)) setShowSaved(true)
  }, [linkedTask, loaded, savedTasks, nearbyTasks])

  useEffect(() => {
    if (!linkedTask || !loaded || scrolledTo.current) return
    const el = document.getElementById(`task-${linkedTask}`)
    if (!el) return
    scrolledTo.current = true
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [linkedTask, loaded, shownTasks.length])

  useEffect(() => {
    if (userLoc) loadNearbyTasks(userLoc.lat, userLoc.lng, nearbyRadius)
  }, [nearbyRadius, userLoc, loadNearbyTasks])

  // The apps' tab bar calls this page Events; its title should match.
  return (
    <AppLayout title={isNativeApp ? tr('Events') : tr('Opportunities')} subtitle={tr('Volunteer tasks near you')}>
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-xl font-bold">{tr('Opportunities near you')}</h2>
            <p className="text-sm text-earth-400 mt-1">
              {userLoc ? tr('Showing tasks within {km} km of your location', { km: nearbyRadius }) : tr('Enable location to see nearby tasks')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-earth-400">{tr('Radius:')}</label>
            <select
              value={nearbyRadius}
              onChange={(e) => setNearbyRadius(Number(e.target.value))}
              className="input py-1 px-2 text-sm w-24"
            >
              <option value={5}>{tr('5 km')}</option>
              <option value={10}>{tr('10 km')}</option>
              <option value={25}>{tr('25 km')}</option>
              <option value={50}>{tr('50 km')}</option>
              <option value={100}>{tr('100 km')}</option>
            </select>
          </div>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-earth-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && searchInput) clearSearch() }}
            maxLength={MAX_SEARCH_LENGTH}
            placeholder={tr('Search tasks, places or organizers')}
            aria-label={tr('Search tasks')}
            className="input w-full pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
          />
          {searchInput && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label={tr('Clear search')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-earth-500 hover:text-earth-200"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="input py-1 px-2 text-sm w-auto" aria-label={tr('Category')}>
            <option value="">{tr('All categories')}</option>
            {ACTIVITY_CATEGORIES.map((c) => <option key={c} value={c}>{tr(c)}</option>)}
          </select>
          <select value={when} onChange={(e) => setWhen(e.target.value)} className="input py-1 px-2 text-sm w-auto" aria-label={tr('When')}>
            {WHEN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {canFollow && (savedTasks?.length > 0 || showSaved) && (
            <button
              type="button"
              onClick={() => setShowSaved((v) => !v)}
              aria-pressed={showSaved}
              className={`btn-sm inline-flex items-center gap-1 ${showSaved ? 'btn-primary' : 'btn-ghost'}`}
            >
              {showSaved ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
              {tr('Saved ({n})', { n: savedTasks?.length || 0 })}
            </button>
          )}
          {filtering && (
            <button type="button" onClick={() => { setCategory(''); setWhen('') }} className="btn-ghost btn-sm">
              <X className="w-3.5 h-3.5 mr-1" />{' '}{tr('Clear')}
            </button>
          )}
          {(filtering || search) && loaded && (
            <span className="text-xs text-earth-500" aria-live="polite">{shownTasks.length}{' '}{tr('of')}{' '}{baseTasks.length}{' '}{tr('tasks')}</span>
          )}
        </div>

        {canFollow && following?.length > 0 && (
          <Card padded={false} className="p-3">
            <button
              type="button"
              onClick={() => setFollowOpen((o) => !o)}
              aria-expanded={followOpen}
              className="w-full flex items-center justify-between gap-2 text-sm font-medium"
            >
              <span className="flex items-center gap-2"><Bell className="w-4 h-4 text-brand-400" />{tr('Following ({n})', { n: following.length })}</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${followOpen ? 'rotate-180' : ''}`} />
            </button>
            {followOpen && (
              <>
                <p className="text-xs text-earth-500 mt-2">{tr('We email you when these organizers post a new task.')}</p>
                <ul className="mt-2 space-y-2">
                  {following.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-2">
                      <span className="text-sm truncate">{o.name}</span>
                      <button type="button" onClick={() => setFollow(o.id, false)} disabled={followBusy === o.id} className="btn-ghost btn-sm shrink-0">
                        {tr('Unfollow')}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        )}

        {!userLoc && (
          <Card className="border border-dashed border-brand-700/40 bg-brand-900/10">
            <div className="flex items-center gap-3">
              <MapPin className="w-5 h-5 text-brand-400 shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-sm text-white">{tr('Location access needed')}</p>
                <p className="text-xs text-earth-400 mt-0.5">{tr('Allow location access to see volunteer opportunities near you.')}</p>
              </div>
              <button onClick={() => {
                navigator.geolocation.getCurrentPosition(
                  (pos) => {
                    const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
                    setUserLoc(loc)
                    loadNearbyTasks(loc.lat, loc.lng, nearbyRadius)
                  },
                  () => {},
                  { enableHighAccuracy: true, timeout: 10000 },
                )
              }} className="btn-primary text-xs">{tr('Enable')}</button>
            </div>
          </Card>
        )}

        {!loaded ? (
          <Card>
            <p className="text-center py-8 text-earth-400">{tr('Loading opportunities…')}</p>
          </Card>
        ) : loadFailed && nearbyTasks.length === 0 ? (
          <Card>
            <div className="text-center py-8">
              <p className="text-earth-400">{tr("Couldn't reach VolunTrack to load opportunities.")}</p>
              <button onClick={() => { setLoaded(false); loadNearbyTasks(userLoc?.lat ?? null, userLoc?.lng ?? null, nearbyRadius) }} className="btn-secondary mt-3">{tr('Try again')}</button>
            </div>
          </Card>
        ) : showSaved && baseTasks.length === 0 ? (
          <Card>
            <div className="text-center py-8">
              <Bookmark className="w-10 h-10 text-earth-600 mx-auto mb-3" />
              <p className="text-earth-400">{tr('No saved tasks.')}</p>
              <p className="text-xs text-earth-500 mt-1">{tr('Tap Save on a task to keep it here. Tasks drop off once they’re over or cancelled.')}</p>
              <button type="button" onClick={() => setShowSaved(false)} className="btn-secondary mt-3">{tr('Show all tasks')}</button>
            </div>
          </Card>
        ) : !showSaved && nearbyTasks.length === 0 ? (
          <Card>
            <div className="text-center py-8">
              <MapPin className="w-10 h-10 text-earth-600 mx-auto mb-3" />
              <p className="text-earth-400">{tr('No volunteer opportunities within')}{' '}{nearbyRadius}{tr('km.')}</p>
              <p className="text-xs text-earth-500 mt-1">{tr('Try increasing the radius or check back later.')}</p>
            </div>
          </Card>
        ) : shownTasks.length === 0 && search ? (
          <Card>
            <div className="text-center py-8">
              <Search className="w-10 h-10 text-earth-600 mx-auto mb-3" />
              <p className="text-earth-400 break-words">{tr('No tasks match “{q}”', { q: search })}</p>
              {filtering && <p className="text-xs text-earth-500 mt-1">{tr('The category and date filters apply too.')}</p>}
              <div className="flex flex-wrap justify-center gap-2 mt-3">
                <button type="button" onClick={clearSearch} className="btn-secondary">{tr('Clear search')}</button>
                {filtering && <button type="button" onClick={() => { setCategory(''); setWhen('') }} className="btn-ghost">{tr('Clear filters')}</button>}
              </div>
            </div>
          </Card>
        ) : shownTasks.length === 0 ? (
          <Card>
            <div className="text-center py-8">
              <p className="text-earth-400">{tr('No tasks match these filters.')}</p>
              <button type="button" onClick={() => { setCategory(''); setWhen('') }} className="btn-secondary mt-3">{tr('Clear filters')}</button>
            </div>
          </Card>
        ) : shownTasks.map((t) => {
          const filled = Number(t.slots_filled)
          const total = Number(t.slots_total)
          const full = filled >= total
          const approved = t.my_signup_status === 'approved'
          return (
            <Card key={t.id} id={`task-${t.id}`} padded={false} className={`p-4 ${t.id === linkedTask ? 'ring-2 ring-brand-400' : ''}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{t.title}</p>
                    {t.distance != null && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-400 font-medium shrink-0">
                        {fmtDist(t.distance)}{' '}{tr('away')}
                      </span>
                    )}
                  </div>
                  {t.id === linkedTask && invitedFrom && !t.my_signup_status && (
                    <p className="text-xs text-brand-400 mt-1">{tr('A friend invited you to this one.')}</p>
                  )}
                  {t.category && <span className={`chip mt-1 ${categoryColor(t.category)}`}>{tr(t.category)}</span>}
                  <p className="text-sm text-earth-400 mt-1">{t.description}</p>
                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-earth-500">
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${t.latitude != null && t.longitude != null ? `${t.latitude},${t.longitude}` : encodeURIComponent(t.location)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 hover:text-brand-400 hover:underline"
                    >
                      <MapPin className="w-3 h-3" /> {t.location}
                    </a>
                    <span className="flex items-center gap-1"><CalIcon className="w-3 h-3" /> {fmtDate(t.date)}{t.time ? ` · ${t.time}` : ''}</span>
                    <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {filled}/{total}{' '}{tr('slots')}</span>
                  </div>
                  <p className="text-xs text-earth-600 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>{tr('Posted by')}{' '}{t.creator_name}</span>
                    {t.organizer_rating_count > 0 && (
                      <span
                        className="inline-flex items-center gap-0.5 text-amber-400"
                        title={tr('Average of {n} ratings from volunteers across this organizer\'s tasks', { n: t.organizer_rating_count })}
                      >
                        ★ {Number(t.organizer_rating_avg).toFixed(1)} <span className="text-earth-500">({t.organizer_rating_count})</span>
                      </span>
                    )}
                    {canFollow && t.organizer_id && t.organizer_id !== user?.id && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setFollow(t.organizer_id, !t.i_follow_organizer) }}
                        disabled={followBusy === t.organizer_id}
                        aria-pressed={Boolean(t.i_follow_organizer)}
                        className={`inline-flex items-center gap-1 ${t.i_follow_organizer ? 'text-brand-400' : 'text-earth-500 hover:text-brand-400'}`}
                      >
                        {t.i_follow_organizer ? <BellRing className="w-3 h-3" /> : <Bell className="w-3 h-3" />}{' '}{t.i_follow_organizer ? tr('Following') : tr('Follow')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); shareTask(t) }}
                      className="inline-flex items-center gap-1 text-earth-500 hover:text-brand-400"
                    >
                      <Share2 className="w-3 h-3" />{' '}{tr('Share')}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setReporting(t) }}
                      className="inline-flex items-center gap-1 text-earth-500 hover:text-red-400"
                    >
                      <Flag className="w-3 h-3" />{' '}{tr('Report')}
                    </button>
                  </p>
                  {approved && t.phone && (
                    <p className="text-xs text-emerald-400 mt-1 font-medium">{tr('Contact:')}{' '}{t.phone}</p>
                  )}
                  {approved && t.important_info && (
                    <div className="mt-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                      <p className="text-xs font-semibold text-emerald-300 mb-0.5">{tr('Important info')}</p>
                      <p className="text-xs text-emerald-200/80">{t.important_info}</p>
                    </div>
                  )}
                  {t.my_signup_status === 'pending' && (
                    <p className="text-xs text-amber-400 mt-1">{tr('Awaiting organizer approval')}</p>
                  )}
                  {t.my_signup_status === 'rejected' && (
                    <p className="text-xs text-red-400 mt-1">{tr('Signup rejected')}</p>
                  )}
                  {t.my_signup_status === 'parent_pending' && (
                    <p className="text-xs text-amber-400 mt-1">{tr("Waiting for a parent's OK. The organizer sees your sign-up once a parent approves it.")}</p>
                  )}
                  {t.my_signup_status === 'parent_declined' && (
                    <p className="text-xs text-red-400 mt-1">{tr('Your parent said no to this one. Talk with them, then you can ask again.')}</p>
                  )}
                  {(approved || t.my_signup_status === 'pending') && <AddToCalendar task={t} className="mt-2" />}
                  {canInvite && (approved || t.my_signup_status === 'pending') && <InviteFriends task={t} className="mt-2" />}
                  {approved && String(t.date).slice(0, 10) === format(new Date(), 'yyyy-MM-dd') && (
                    <div className="mt-2"><ScanCheckinButton className="btn-secondary text-sm" /></div>
                  )}
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1.5">
                  {t.my_signup_status === 'approved' ? (
                    <span className="text-xs text-emerald-400 font-medium">{tr('Approved')}</span>
                  ) : t.my_signup_status === 'pending' ? (
                    <span className="text-xs text-amber-400 font-medium">{tr('Pending')}</span>
                  ) : t.my_signup_status === 'rejected' ? (
                    <span className="text-xs text-red-400 font-medium">{tr('Rejected')}</span>
                  ) : t.my_signup_status === 'waitlisted' ? (
                    <span className="text-xs text-sky-300 font-medium">{tr('Waitlist #')}{t.my_waitlist_position || 1}</span>
                  ) : t.my_signup_status === 'parent_pending' ? (
                    <span className="text-xs text-amber-400 font-medium">{tr("Waiting for a parent's OK")}</span>
                  ) : t.my_signup_status === 'parent_declined' ? (
                    <button onClick={() => signUp(t, full)} className="btn-secondary text-sm">{tr('Ask again')}</button>
                  ) : (
                    <button onClick={() => signUp(t, full)} className={full ? 'btn-secondary text-sm' : 'btn-primary text-sm'}>
                      {full ? tr('Join waitlist') : tr('Sign up')}
                    </button>
                  )}
                  {full && !t.my_signup_status && (
                    <span className="text-xs text-earth-500">{tr('Full')}{Number(t.waitlist_count) > 0 ? ` · ${tr('{n} waiting', { n: t.waitlist_count })}` : ''}</span>
                  )}
                  {['pending', 'approved', 'waitlisted', 'parent_pending'].includes(t.my_signup_status) && (
                    <CancelSignup task={t} onDone={(msg) => { setToastMsg(msg); setToast(true); reload() }} onError={(msg) => { setToastMsg(msg); setToast(true) }} />
                  )}
                  {canFollow && t.organizer_id !== user?.id && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setSaved(t.id, !t.i_saved) }}
                      disabled={saveBusy === t.id}
                      aria-pressed={Boolean(t.i_saved)}
                      title={t.i_saved ? tr('Remove from Saved') : tr('Save for later')}
                      className={`inline-flex items-center gap-1 text-xs ${t.i_saved ? 'text-brand-400' : 'text-earth-500 hover:text-brand-400'}`}
                    >
                      {t.i_saved ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}{' '}{t.i_saved ? tr('Saved') : tr('Save')}
                    </button>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      <Toast open={toast} onClose={() => setToast(false)}>{toastMsg}</Toast>
      {reporting && (
        <ReportTaskDialog
          task={reporting}
          onClose={() => setReporting(null)}
          onDone={({ blocked }) => {
            setReporting(null)
            setToastMsg(blocked ? tr("Thanks — reported, and you won't see this organizer's tasks.") : tr('Thanks — we review reports within 24 hours.'))
            setToast(true)
            // A blocked organizer's tasks drop out of the list.
            if (blocked) loadNearbyTasks(userLoc?.lat ?? null, userLoc?.lng ?? null, nearbyRadius)
          }}
        />
      )}
    </AppLayout>
  )
}
