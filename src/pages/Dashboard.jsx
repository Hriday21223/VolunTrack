import { useMemo, useState, useEffect, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Clock, Calendar as CalIcon, TrendingUp, Plus, Trophy, ChevronRight, MapPin, X, School, Users, Hand, FileText, MessageSquare, Bell, Calendar } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth.jsx'
import { useData } from '@/hooks/useData.jsx'
import { useLocalStorage } from '@/hooks/useLocalStorage.js'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import ProgressRing from '@/components/ProgressRing.jsx'
import BarChart from '@/components/BarChart.jsx'
import Toast from '@/components/Toast.jsx'
import VerificationBadge from '@/components/VerificationBadge.jsx'
import { categoryColor } from '@/lib/categories.js'
import { fmtDate, fmtHours, fromNow } from '@/utils/date.js'
import { format, startOfWeek, startOfMonth, addDays, parseISO } from 'date-fns'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

const fmtDist = (km) => {
  if (km === null || km === undefined) return null
  const n = Number(km)
  if (n < 1) return `${Math.round(n * 1000)}m`
  return `${n.toFixed(1)}km`
}

export default function Dashboard() {
  const { user } = useAuth()
  const { logs, goals, earned } = useData()
  const [searchParams] = useSearchParams()
  const [hasSeenTour, setHasSeenTour] = useLocalStorage('voluntrack:dashboard-tour', false)
  const [showTour, setShowTour] = useState(!hasSeenTour)
  const [schoolInfo, setSchoolInfo] = useState(null)
  const [publicTasks, setPublicTasks] = useState([])
  const [nearbyTasks, setNearbyTasks] = useState([])
  const [dashTab, setDashTab] = useState('home')
  const [userLoc, setUserLoc] = useState(null)
  const [schoolMessages, setSchoolMessages] = useState([])
  const [adminNotifs, setAdminNotifs] = useState([])
  const [nearbyRadius, setNearbyRadius] = useState(25)
  const [toast, setToast] = useState(false)
  const [toastMsg, setToastMsg] = useState('')

  // Read ?view= param from URL to set dashTab
  useEffect(() => {
    const view = searchParams.get('view')
    if (view === 'nearby') setDashTab('nearby')
    else if (view === 'volunteer') setDashTab('volunteer')
  }, [searchParams])

  // Scroll to top when switching dashboard tabs
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [dashTab])

  const total = useMemo(() => logs.reduce((s, l) => s + (Number(l.hours) || 0), 0), [logs])

  // Recomputes when the calendar month changes; identity is stable across renders
  // within the same month so the memo below doesn't invalidate every keystroke.
  const monthStart = useMemo(() => startOfMonth(new Date()), [])
  const thisMonth = useMemo(
    () => logs.filter((l) => l.date && parseISO(l.date) >= monthStart)
              .reduce((s, l) => s + (Number(l.hours) || 0), 0),
    [logs, monthStart],
  )

  const primary = goals.find((g) => g.primary) || goals[0]
  const target = primary ? Number(primary.targetHours) || 0 : 0
  const percent = target > 0 ? Math.min(1, total / target) : 0
  const remaining = Math.max(0, target - total)

  // Weekly chart: last 7 days ending today
  const weekly = useMemo(() => {
    const start = startOfWeek(new Date(), { weekStartsOn: 1 })
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(start, i)
      const key = format(day, 'yyyy-MM-dd')
      const value = logs
        .filter((l) => l.date === key)
        .reduce((s, l) => s + (Number(l.hours) || 0), 0)
      return { label: format(day, 'EEE')[0], value }
    })
  }, [logs])

  useEffect(() => {
    if (!user?.schoolId) return
    ;    (async () => {
      try {
        const infoRes = await fetch(`${apiUrl}/school/info?id=${user.schoolId}`)
        if (infoRes.ok) { const d = await infoRes.json(); if (d.school) setSchoolInfo(d.school) }
        const token = localStorage.getItem('voluntrack:auth_token')
        const msgRes = await fetch(`${apiUrl}/school/messages`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (msgRes.ok) { const d = await msgRes.json(); setSchoolMessages(d.messages || []) }
        const notifRes = await fetch(`${apiUrl}/school/admin/notifications?schoolId=${user.schoolId}`, { headers })
        if (notifRes.ok) { const d = await notifRes.json(); setAdminNotifs(d.notifications || []) }
      } catch {}
    })()
  }, [user?.schoolId])

  const loadPublicTasks = useCallback(async (lat, lng) => {
    try {
      let url = `${apiUrl}/school/public-tasks`
      if (lat != null && lng != null) url += `?lat=${lat}&lng=${lng}`
      const res = await fetch(url)
      if (res.ok) { const d = await res.json(); setPublicTasks(d.tasks || []) }
    } catch {}
  }, [])

  const loadNearbyTasks = useCallback(async (lat, lng, radius) => {
    try {
      let url = `${apiUrl}/school/public-tasks?maxDistance=${radius}`
      if (lat != null && lng != null) url += `&lat=${lat}&lng=${lng}`
      const res = await fetch(url)
      if (res.ok) { const d = await res.json(); setNearbyTasks(d.tasks || []) }
    } catch {}
  }, [])

  useEffect(() => {
    // Get user location only for students
    if (user?.role === 'student' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
          setUserLoc(loc)
          loadPublicTasks(loc.lat, loc.lng)
          loadNearbyTasks(loc.lat, loc.lng, nearbyRadius)
        },
        () => { loadPublicTasks(); loadNearbyTasks(null, null, nearbyRadius) },
        { enableHighAccuracy: true, timeout: 10000 },
      )
    } else {
      loadPublicTasks()
      loadNearbyTasks(null, null, nearbyRadius)
    }
  }, [user?.role, loadPublicTasks, loadNearbyTasks, nearbyRadius])

  // Reload nearby tasks when radius changes
  useEffect(() => {
    if (userLoc) {
      loadNearbyTasks(userLoc.lat, userLoc.lng, nearbyRadius)
    }
  }, [nearbyRadius, userLoc, loadNearbyTasks])

  const recent = useMemo(() => logs.slice(0, 5), [logs])

  const closeTour = () => {
    setShowTour(false)
    setHasSeenTour(true)
  }

  return (
    <AppLayout
      title={`Hi, ${user?.name?.split(' ')[0] || 'there'} 👋`}
      subtitle={user?.school ? `${user.school} · ${user.grade || 'Volunteer'}` : 'Welcome back to VolunTrack.'}
      action={
        <div className="flex flex-wrap gap-2">
          {user?.role === 'student' && (
            <>
              <button onClick={() => setDashTab(dashTab === 'nearby' ? 'home' : 'nearby')} className={`btn-sm ${dashTab === 'nearby' ? 'btn-primary' : 'btn-ghost'}`}>
                <MapPin className="w-3.5 h-3.5 sm:mr-1" /> <span className="hidden sm:inline">Opportunities</span>
              </button>
              <button onClick={() => setDashTab(dashTab === 'volunteer' ? 'home' : 'volunteer')} className={`btn-sm ${dashTab === 'volunteer' ? 'btn-primary' : 'btn-ghost'}`}>
                <Hand className="w-3.5 h-3.5 sm:mr-1" /> <span className="hidden sm:inline">Volunteer</span>
              </button>
            </>
          )}
          {dashTab === 'home' && (
            <Link to="/log" className="btn-primary">
              <Plus className="w-4 h-4" /> Log hours
            </Link>
          )}
        </div>
      }
    >
      {showTour && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative w-full max-w-2xl overflow-hidden rounded-[2rem] border border-earth-900 bg-[#07131a] shadow-2xl">
            <div className="p-6 bg-gradient-to-r from-brand-600 via-brand-500 to-sky-500 text-white">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.35em] text-brand-100">Dashboard tour</div>
                  <h1 className="mt-3 text-3xl font-bold">Welcome to VolunTrack</h1>
                </div>
                <button
                  type="button"
                  onClick={closeTour}
                  className="rounded-full p-2 text-white/80 hover:bg-white/10"
                  aria-label="Close tour"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-4 text-sm text-slate-100/90">
                This tour highlights the core dashboard panels so new volunteers can start logging hours fast.
              </p>
            </div>
            <div className="p-6 space-y-4 text-sm text-earth-300">
              <div className="rounded-3xl border border-earth-900 bg-[#08141d] p-4">
                <strong className="block font-semibold">Progress at a glance</strong>
                Track total hours, goal progress, and what remains to reach your main volunteering goal.
              </div>
              <div className="rounded-3xl border border-earth-900 bg-[#08141d] p-4">
                <strong className="block font-semibold">Weekly chart</strong>
                See your hours for the current week and keep momentum with day-by-day activity.
              </div>
              <div className="rounded-3xl border border-earth-900 bg-[#08141d] p-4">
                <strong className="block font-semibold">Recent activity</strong>
                Quickly jump to log more hours or review the latest volunteer sessions.
              </div>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-center">
                <button onClick={closeTour} className="btn-primary w-full sm:w-auto">Got it</button>
                <Link to="/log" className="btn-secondary w-full sm:w-auto text-center">Log your first hours</Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {dashTab === 'nearby' && user?.role === 'student' ? (
        <div className="max-w-2xl mx-auto space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-xl font-bold">Opportunities near you</h2>
              <p className="text-sm text-earth-400 mt-1">
                {userLoc ? `Showing tasks within ${nearbyRadius}km of your location` : 'Enable location to see nearby tasks'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-earth-400">Radius:</label>
              <select
                value={nearbyRadius}
                onChange={(e) => setNearbyRadius(Number(e.target.value))}
                className="input py-1 px-2 text-sm w-24"
              >
                <option value={5}>5 km</option>
                <option value={10}>10 km</option>
                <option value={25}>25 km</option>
                <option value={50}>50 km</option>
                <option value={100}>100 km</option>
              </select>
            </div>
          </div>

          {!userLoc && (
            <Card className="border border-dashed border-brand-700/40 bg-brand-900/10">
              <div className="flex items-center gap-3">
                <MapPin className="w-5 h-5 text-brand-400 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium text-sm text-white">Location access needed</p>
                  <p className="text-xs text-earth-400 mt-0.5">Allow location access to see volunteer opportunities near you.</p>
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
                }} className="btn-primary text-xs">Enable</button>
              </div>
            </Card>
          )}

          {nearbyTasks.length === 0 ? (
            <Card>
              <div className="text-center py-8">
                <MapPin className="w-10 h-10 text-earth-600 mx-auto mb-3" />
                <p className="text-earth-400">No volunteer opportunities within {nearbyRadius}km.</p>
                <p className="text-xs text-earth-500 mt-1">Try increasing the radius or check back later.</p>
              </div>
            </Card>
          ) : nearbyTasks.map((t) => {
            const filled = Number(t.slots_filled)
            const total = Number(t.slots_total)
            const full = filled >= total
            const approved = t.my_signup_status === 'approved'
            return (
              <Card key={t.id} padded={false} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{t.title}</p>
                      {t.distance != null && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-400 font-medium shrink-0">
                          {fmtDist(t.distance)} away
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-earth-400 mt-1">{t.description}</p>
                    <div className="flex flex-wrap gap-3 mt-2 text-xs text-earth-500">
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {t.location}</span>
                      <span className="flex items-center gap-1"><CalIcon className="w-3 h-3" /> {new Date(t.date).toLocaleDateString()}{t.time ? ` · ${t.time}` : ''}</span>
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {filled}/{total} slots</span>
                    </div>
                    <p className="text-xs text-earth-600 mt-1">Posted by {t.creator_name}</p>
                    {approved && t.phone && (
                      <p className="text-xs text-emerald-400 mt-1 font-medium">Contact: {t.phone}</p>
                    )}
                    {approved && t.important_info && (
                      <div className="mt-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                        <p className="text-xs font-semibold text-emerald-300 mb-0.5">Important info</p>
                        <p className="text-xs text-emerald-200/80">{t.important_info}</p>
                      </div>
                    )}
                    {t.my_signup_status === 'pending' && (
                      <p className="text-xs text-amber-400 mt-1">Awaiting organizer approval</p>
                    )}
                    {t.my_signup_status === 'rejected' && (
                      <p className="text-xs text-red-400 mt-1">Signup rejected</p>
                    )}
                  </div>
                  <div className="shrink-0">
                    {t.my_signup_status === 'approved' ? (
                      <span className="text-xs text-emerald-400 font-medium">Approved</span>
                    ) : t.my_signup_status === 'pending' ? (
                      <span className="text-xs text-amber-400 font-medium">Pending</span>
                    ) : t.my_signup_status === 'rejected' ? (
                      <span className="text-xs text-red-400 font-medium">Rejected</span>
                    ) : full ? (
                      <span className="text-xs text-red-400 font-medium">Full</span>
                    ) : (
                      <button onClick={async () => {
                        try {
                          const token = localStorage.getItem('voluntrack:auth_token')
                          const res = await fetch(`${apiUrl}/school/public-tasks/${t.id}/signup`, {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${token}` },
                          })
                          if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
                          setToastMsg('Signed up — awaiting organizer approval'); setToast(true); loadNearbyTasks(userLoc?.lat, userLoc?.lng, nearbyRadius)
                        } catch (e) { setToastMsg(e.message); setToast(true) }
                      }} className="btn-primary text-sm">Sign up</button>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      ) : dashTab === 'volunteer' && user?.role === 'student' ? (
        <div className="max-w-2xl mx-auto space-y-4">
          <h2 className="text-xl font-bold">Needed volunteers</h2>

          {publicTasks.length === 0 ? (
            <Card><p className="text-center text-earth-500 py-8">No volunteer opportunities available right now.</p></Card>
          ) : publicTasks.map((t) => {
            const filled = Number(t.slots_filled)
            const total = Number(t.slots_total)
            const full = filled >= total
            const approved = t.my_signup_status === 'approved'
            return (
              <Card key={t.id} padded={false} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{t.title}</p>
                    <p className="text-sm text-earth-400 mt-1">{t.description}</p>
                    <div className="flex flex-wrap gap-3 mt-2 text-xs text-earth-500">
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {t.location}</span>
                      <span className="flex items-center gap-1"><CalIcon className="w-3 h-3" /> {new Date(t.date).toLocaleDateString()}{t.time ? ` · ${t.time}` : ''}</span>
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {filled}/{total} needed</span>
                      {t.distance != null && (
                        <span className="flex items-center gap-1 text-brand-400">{fmtDist(t.distance)} away</span>
                      )}
                    </div>
                    <p className="text-xs text-earth-600 mt-1">Posted by {t.creator_name}</p>
                    {approved && t.phone && (
                      <p className="text-xs text-emerald-400 mt-1 font-medium">Contact: {t.phone}</p>
                    )}
                    {approved && t.important_info && (
                      <div className="mt-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                        <p className="text-xs font-semibold text-emerald-300 mb-0.5">Important info</p>
                        <p className="text-xs text-emerald-200/80">{t.important_info}</p>
                      </div>
                    )}
                    {t.my_signup_status === 'pending' && (
                      <p className="text-xs text-amber-400 mt-1">Awaiting organizer approval</p>
                    )}
                    {t.my_signup_status === 'rejected' && (
                      <p className="text-xs text-red-400 mt-1">Signup rejected</p>
                    )}
                  </div>
                  <div className="shrink-0">
                    {t.my_signup_status === 'approved' ? (
                      <span className="text-xs text-emerald-400 font-medium">Approved</span>
                    ) : t.my_signup_status === 'pending' ? (
                      <span className="text-xs text-amber-400 font-medium">Pending</span>
                    ) : t.my_signup_status === 'rejected' ? (
                      <span className="text-xs text-red-400 font-medium">Rejected</span>
                    ) : full ? (
                      <span className="text-xs text-red-400 font-medium">Full</span>
                    ) : (
                      <button onClick={async () => {
                        try {
                          const token = localStorage.getItem('voluntrack:auth_token')
                          const res = await fetch(`${apiUrl}/school/public-tasks/${t.id}/signup`, {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${token}` },
                          })
                          if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
                          setToastMsg('Signed up — awaiting organizer approval'); setToast(true); loadPublicTasks()
                        } catch (e) { setToastMsg(e.message); setToast(true) }
                      }} className="btn-primary text-sm">Sign up</button>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      ) : (
      <>
          {!user?.schoolId && user?.role !== 'school' && user?.role !== 'admin' && (
            <Card className="mb-5 border border-dashed border-brand-700/40 bg-brand-900/10">
              <div className="flex items-center gap-3">
                <School className="w-5 h-5 text-brand-400" />
                <div className="flex-1">
                  <p className="font-medium text-sm text-white">Join a school or organization</p>
                  <p className="text-xs text-earth-400 mt-0.5">Link your account to unlock school features.</p>
                </div>
                <Link to="/settings" className="btn-sm btn-primary text-xs">Go to Settings</Link>
              </div>
            </Card>
          )}
          {schoolInfo && (
        <>
          <Card className="mb-5">
            <div className="flex items-center gap-3">
              <School className="w-5 h-5 text-brand-600" />
              <div>
                <p className="font-medium text-sm">{schoolInfo.name}</p>
                <p className="text-xs text-earth-400">Code: <span className="font-mono">{schoolInfo.pin}</span></p>
                {schoolInfo.paymentStatus && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    schoolInfo.paymentStatus === 'paid'
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'bg-amber-500/10 text-amber-400'
                  }`}>
                    {schoolInfo.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}
                  </span>
                )}
              </div>
              <Link to="/school/dashboard" className="btn-secondary ml-auto text-sm">Dashboard</Link>
            </div>
          </Card>

          {schoolInfo?.paymentDueDate && (() => {
            const daysLeft = Math.ceil((new Date(schoolInfo.paymentDueDate) - new Date()) / (1000 * 60 * 60 * 24))
            if (daysLeft <= 10 && daysLeft >= 0) {
              return (
                <Card className="mb-5">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-amber-500" />
                    <p className="text-sm text-amber-600 dark:text-amber-400">
                      Payment due in <strong>{daysLeft} day{daysLeft === 1 ? '' : 's'}</strong>
                    </p>
                  </div>
                </Card>
              )
            }
            return null
          })()}

          {adminNotifs.length > 0 && (
            <Card className="mb-5">
              <div className="flex items-center gap-2 mb-3">
                <Bell className="w-4 h-4 text-brand-600" />
                <h3 className="font-display font-semibold">Payment notices</h3>
              </div>
              <div className="space-y-2">
                {adminNotifs.map((n) => (
                  <div key={n.id} className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3">
                    <p className="text-sm">{n.message}</p>
                    <p className="text-xs text-earth-500 mt-1">{new Date(n.created_at).toLocaleDateString()}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {schoolMessages.length > 0 && (
            <Card className="mb-5">
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare className="w-4 h-4 text-brand-600" />
                <h3 className="font-display font-semibold">School announcements</h3>
              </div>
              <div className="space-y-3 max-h-60 overflow-y-auto">
                {schoolMessages.slice(0, 10).map((m) => (
                  <div key={m.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <p className="text-sm">{m.message}</p>
                    <p className="text-xs text-earth-500 mt-1">{m.sender_name} · {new Date(m.created_at).toLocaleDateString()}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {user?.role === 'student' && publicTasks.length > 0 && (
            <Card className="mb-5">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-brand-600" />
                <h3 className="font-display font-semibold">Volunteer opportunities</h3>
              </div>
              <div className="space-y-3">
                {publicTasks.slice(0, 5).map((t) => {
                  const filled = Number(t.slots_filled)
                  const total = Number(t.slots_total)
                  return (
                    <div key={t.id} className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{t.title}</p>
                        <p className="text-xs text-earth-400 mt-0.5">
                          <MapPin className="w-3 h-3 inline mr-1" />{t.location}
                          {' · '}<CalIcon className="w-3 h-3 inline mr-1" />{new Date(t.date).toLocaleDateString()}
                        </p>
                        <p className="text-xs text-earth-500 mt-0.5">{filled}/{total} filled{t.distance != null ? ` · ${fmtDist(t.distance)} away` : ''}</p>
                      </div>
                      <button onClick={() => setDashTab('volunteer')} className="btn-ghost text-xs shrink-0">View</button>
                    </div>
                  )
                })}
                {publicTasks.length > 5 && (
                  <button onClick={() => setDashTab('volunteer')} className="block text-xs text-brand-400 hover:underline">View all {publicTasks.length} tasks →</button>
                )}
              </div>
            </Card>
          )}
        </>
      )}

      {/* Mobile-first summary cards */}
      <div className="grid gap-2 grid-cols-2 md:hidden">
        <Card className="p-3">
          <div className="text-[10px] font-medium text-earth-500 uppercase tracking-wide">Total hours</div>
          <div className="mt-1 text-xl font-bold text-white">{fmtHours(total)}</div>
          <div className="text-[10px] text-earth-400">{logs.length} sessions</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] font-medium text-earth-500 uppercase tracking-wide">This month</div>
          <div className="mt-1 text-xl font-bold text-white">{fmtHours(thisMonth)}</div>
          <div className="text-[10px] text-earth-400">Monthly progress</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] font-medium text-earth-500 uppercase tracking-wide">Goal</div>
          <div className="mt-1 text-xl font-bold text-white">{Math.round(percent * 100)}%</div>
          <div className="text-[10px] text-earth-400">{primary?.title || 'No goal set'}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] font-medium text-earth-500 uppercase tracking-wide">Badges</div>
          <div className="mt-1 text-xl font-bold text-white">{earned.length}/12</div>
          <div className="text-[10px] text-earth-400">Achievements</div>
        </Card>
      </div>

      <div className="grid gap-5">
        <Card className="overflow-hidden lg:col-span-3">
          <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr] bg-gradient-to-r from-brand-800 via-slate-950 to-slate-900 p-5">
            <div className="space-y-3 text-white">
              <span className="text-xs uppercase tracking-[0.35em] text-brand-300">Volunteer snapshot</span>
              <h2 className="text-xl font-bold leading-tight">A cleaner way to track hours, goals, and progress.</h2>
              <p className="max-w-xl text-sm text-slate-300 leading-6">
                Log sessions fast, keep your goals moving, and export polished records for school, club, or scholarship review.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link to="/log" className="btn-primary btn-sm">Log hours</Link>
                <Link to="/calendar" className="btn-secondary btn-sm">View calendar</Link>
              </div>
            </div>
            <div className="rounded-[1.5rem] bg-slate-950/95 p-4 ring-1 ring-white/10 shadow-soft">
              <div className="text-xs text-earth-400">Total this year</div>
              <div className="mt-2 text-3xl font-bold text-white">{fmtHours(total)}</div>
              <div className="mt-1 text-xs text-earth-400">{logs.length} volunteer sessions logged</div>
              <div className="mt-3 grid gap-2">
                <StatCard icon={Clock} label="This month" value={fmtHours(thisMonth)} accent="brand" compact />
                <StatCard icon={CalIcon} label="Sessions" value={logs.length} accent="earth" compact />
              </div>
            </div>
          </div>
        </Card>

        <div className="grid lg:grid-cols-3 gap-3">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-xs text-earth-400">Goal progress</div>
                <div className="text-lg font-bold text-white">{Math.round(percent * 100)}%</div>
              </div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-brand-400">Primary goal</div>
            </div>
            <ProgressRing
              percent={percent}
              size={120} stroke={12}
              label={`${Math.round(percent * 100)}%`}
              sublabel={target ? `${fmtHours(remaining)} to goal` : 'No goal set yet'}
            />
            {primary && (
              <div className="mt-2 text-xs text-earth-400">
                Goal: {fmtHours(target)} · {primary.title}
              </div>
            )}
            {!primary && (
              <Link to="/settings" className="mt-2 block text-xs text-brand-400 hover:underline">Set a goal →</Link>
            )}
          </Card>

          <Card className="p-4">
            <div className="text-xs text-earth-400">This month</div>
            <div className="mt-2 text-2xl font-bold text-earth-100">{fmtHours(thisMonth)}</div>
            <div className="mt-2 text-xs text-earth-400">Hours recorded since the start of this month.</div>
          </Card>

          <Card className="p-4">
            <div className="text-xs text-earth-400">Badges earned</div>
            <div className="mt-2 text-2xl font-bold text-earth-100">{earned.length}/12</div>
            <div className="mt-2 text-xs text-earth-400">Earned badges appear as you log more hours.</div>
          </Card>
        </div>

        <Card className="lg:col-span-2 p-4">
          <div className="flex items-center justify-between mb-1">
            <div>
              <div className="text-xs text-earth-400">This week</div>
              <div className="font-display text-sm font-semibold flex items-center gap-2 text-white">
                <TrendingUp className="w-3.5 h-3.5 text-brand-500" /> {fmtHours(weekly.reduce((s, d) => s + d.value, 0))} logged
              </div>
            </div>
          </div>
          <BarChart data={weekly} color="#38bdf8" />
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="font-display font-semibold text-sm">Recent badges</div>
            <Link to="/achievements" className="text-xs text-brand-500 hover:underline flex items-center gap-0.5">
              All <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          {earned.length === 0 ? (
            <div className="text-xs text-earth-400 py-4 text-center">
              No badges yet — log your first hour to earn one.
            </div>
          ) : (
            <ul className="space-y-1">
              {earned.slice(-3).reverse().map((id) => (
                <li key={id} className="text-sm font-medium capitalize text-earth-100">
                  🏅 {id.replaceAll('-', ' ')}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-3">
          <div className="flex items-center justify-between mb-2">
            <div className="font-display font-semibold text-sm">Recent activity</div>
            <Link to="/log" className="text-xs text-brand-500 hover:underline flex items-center gap-0.5">
              Log new hours <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          {recent.length === 0 ? (
            <div className="py-8 text-center text-earth-400">
              <p className="text-sm">No hours logged yet.</p>
              <Link to="/log" className="btn-primary mt-3 btn-sm inline-flex">Log your first hours</Link>
            </div>
          ) : (
            <ul className="divide-y divide-earth-900">
              {recent.map((l) => (
                <li key={l.id} className="py-2.5 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-brand-500/10 grid place-items-center text-brand-500 font-bold text-sm">
                    {fmtHours(Number(l.hours) || 0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate text-earth-100 text-sm">{l.activity || 'Volunteer activity'}</div>
                    <div className="text-xs text-earth-400 flex items-center gap-2 flex-wrap">
                      <span>{fmtDate(l.date)}</span>
                      {l.location && <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{l.location}</span>}
                      <span>{fromNow(l.createdAt)}</span>
                    </div>
                  </div>
                  <VerificationBadge status={l.verificationStatus} />
                  {l.category && (
                    <span className={`chip ${categoryColor(l.category)}`}>{l.category}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      </>
      )}
      <Toast open={toast} onClose={() => setToast(false)}>{toastMsg}</Toast>
    </AppLayout>
  )
}

function StatCard({ icon: Icon, label, value, accent = 'brand' }) {
  const ring = {
    brand: 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300',
    earth: 'bg-earth-100 text-earth-800 dark:bg-[#243529] dark:text-earth-200',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  }[accent]
  return (
    <Card className="p-2">
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-lg grid place-items-center ${ring}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <div className="text-[10px] text-earth-500 dark:text-earth-400">{label}</div>
          <div className="text-sm font-bold leading-tight">{value}</div>
        </div>
      </div>
    </Card>
  )
}
