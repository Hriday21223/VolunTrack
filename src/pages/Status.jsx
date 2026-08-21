import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Activity, CheckCircle2, XCircle, Globe, Clock, Database, Cpu, Monitor, Eye, AlertTriangle, Bell, Server, List, Mail } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { useSeo } from '@/hooks/useSeo.js'
import { getHealth, getIncidents, subscribeToStatus, confirmSubscription, unsubscribeFromStatus } from '@/lib/status.js'

function StatusBadge({ ok, label }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : <XCircle className="w-5 h-5 text-red-600" />}
      <span className="text-sm">{label}</span>
    </div>
  )
}

function DetailRow({ label, value }) {
  return (
    <p><span className="font-medium text-earth-700 dark:text-earth-200">{label}:</span> <span className="text-earth-600 dark:text-earth-300">{value || '—'}</span></p>
  )
}

const STORAGE_KEYS = [
  'voluntrack:user', 'voluntrack:users', 'voluntrack:logs', 'voluntrack:goals',
  'voluntrack:achievements', 'voluntrack:theme', 'voluntrack:reminders',
  'voluntrack:fired-reminders', 'voluntrack:reviews', 'voluntrack:contacts',
  'voluntrack:dashboard-tour', 'voluntrack:auth_token',
]

export default function Status() {
  useSeo({
    title: 'System Status',
    description: 'Live status and uptime for VolunTrack services.',
    path: '/status',
  })

  useEffect(() => { window.scrollTo(0, 0) }, [])

  const storageOk = (() => {
    try {
      localStorage.setItem('__test__', '1')
      localStorage.removeItem('__test__')
      return true
    } catch { return false }
  })()

  const [online, setOnline] = useState(navigator.onLine)
  const [swStatus, setSwStatus] = useState('checking')
  const [incidents, setIncidents] = useState([])
  const [statusTab, setStatusTab] = useState('overview')

  const [searchParams, setSearchParams] = useSearchParams()
  const [subscribeEmail, setSubscribeEmail] = useState('')
  const [subscribing, setSubscribing] = useState(false)
  const [subscribeMessage, setSubscribeMessage] = useState('')
  const [linkMessage, setLinkMessage] = useState('')

  useEffect(() => {
    const confirmToken = searchParams.get('confirm')
    const unsubscribeToken = searchParams.get('unsubscribe')
    if (!confirmToken && !unsubscribeToken) return

    const run = async () => {
      try {
        if (confirmToken) {
          await confirmSubscription(confirmToken)
          setLinkMessage("You're subscribed to VolunTrack status updates.")
        } else {
          await unsubscribeFromStatus(unsubscribeToken)
          setLinkMessage("You've been unsubscribed from status updates.")
        }
      } catch {
        setLinkMessage('That link is invalid or has expired.')
      }
    }
    run()
    setSearchParams({}, { replace: true })
  }, [])

  const submitSubscribe = async (e) => {
    e.preventDefault()
    if (!subscribeEmail.trim()) return
    setSubscribing(true)
    setSubscribeMessage('')
    try {
      const result = await subscribeToStatus(subscribeEmail.trim())
      setSubscribeMessage(result.alreadySubscribed ? "You're already subscribed." : 'Check your email to confirm.')
      setSubscribeEmail('')
    } catch (err) {
      setSubscribeMessage(err.message || 'Failed to subscribe.')
    } finally {
      setSubscribing(false)
    }
  }

  useEffect(() => {
    const go = () => setOnline(true)
    const goA = () => setOnline(false)
    window.addEventListener('online', go)
    window.addEventListener('offline', goA)
    return () => { window.removeEventListener('online', go); window.removeEventListener('offline', goA) }
  }, [])

  // Real backend/DB health — replaces the old per-browser feature-detection
  // list. apiOk starts optimistic (true) so the banner doesn't flash red
  // before the first check completes.
  const [apiOk, setApiOk] = useState(true)
  const [health, setHealth] = useState(null)

  useEffect(() => {
    const check = async () => {
      const result = await getHealth()
      setApiOk(result !== null)
      setHealth(result)
    }
    check()
    const id = setInterval(check, 30000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const loadIncidents = async () => setIncidents(await getIncidents())
    loadIncidents()
    const id = setInterval(loadIncidents, 30000)
    return () => clearInterval(id)
  }, [])

  const [appHealthy, setAppHealthy] = useState(true)

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}`, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
        setAppHealthy(res.ok)
      } catch { setAppHealthy(false) }
    }
    check()
    const id = setInterval(check, 30000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        setSwStatus(reg ? 'active' : 'none')
      }).catch(() => { setSwStatus('error') })
    } else {
      setSwStatus('unsupported')
    }
  }, [])

  const used = new TextEncoder().encode(JSON.stringify(localStorage)).length
  const pretty = used > 1024 * 1024
    ? `${(used / 1024 / 1024).toFixed(1)} MB`
    : used > 1024
      ? `${(used / 1024).toFixed(1)} KB`
      : `${used} B`

  const storageBreakdown = STORAGE_KEYS.map((key) => {
    const raw = localStorage.getItem(key)
    let data = null
    if (raw) {
      try {
        data = JSON.parse(raw)
      } catch {
        data = raw
      }
    }
    const count = Array.isArray(data) ? data.length : (data ? 1 : 0)
    const size = raw ? new TextEncoder().encode(raw).length : 0
    const label = key.replace('voluntrack:', '')
    return { key, label, count, size }
  })

  const totalCount = storageBreakdown.reduce((s, i) => s + i.count, 0)

  const sessionOk = (() => { try { sessionStorage.setItem('__test__', '1'); sessionStorage.removeItem('__test__'); return true } catch { return false } })()
  const cacheOk = 'caches' in window

  const dbConfigured = health ? health.checks.database.ok !== null : false
  const dbOk = health ? health.checks.database.ok : true
  const emailOk = health ? health.checks.email.ok : true

  // Only real infra checks are "critical" — client capability checks below
  // are informational only, since this app is designed to work offline
  // (see CLAUDE.md: fully usable with no backend running).
  const services = [
    { name: 'Application', ok: appHealthy, critical: true, detail: appHealthy ? 'responding' : 'unreachable' },
    { name: 'Backend API', ok: apiOk, critical: true, detail: apiOk ? 'responding' : 'unreachable' },
    { name: 'Database', ok: dbOk !== false, critical: dbConfigured, detail: !dbConfigured ? 'not configured' : dbOk ? 'connected' : 'unreachable' },
    { name: 'Email (SMTP)', ok: emailOk, critical: false, detail: emailOk ? 'configured' : 'not configured' },
    { name: 'Local Storage', ok: storageOk, critical: true, detail: storageOk ? 'ready' : 'unavailable' },
    { name: 'Session Storage', ok: sessionOk, critical: false, detail: sessionOk ? 'ready' : 'unavailable' },
    { name: 'Service Worker', ok: swStatus === 'active' || swStatus === 'none', critical: false, detail: swStatus },
    { name: 'Cache API', ok: cacheOk, critical: false, detail: cacheOk ? 'ready' : 'unavailable' },
    { name: 'Connection', ok: online, critical: false, detail: online ? 'online' : 'offline' },
  ]

  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection
  const mem = navigator.deviceMemory
  const cores = navigator.hardwareConcurrency

  const userAgent = navigator.userAgent
  const platform = navigator.platform || '—'
  const language = navigator.language
  const languages = navigator.languages?.join(', ') || language
  const screenW = window.screen.width
  const screenH = window.screen.height
  const colorDepth = window.screen.colorDepth
  const pixelRatio = window.devicePixelRatio

  const criticalServices = services.filter((s) => s.critical)
  const allOk = criticalServices.every((s) => s.ok)
  const active = incidents.filter((i) => i.status !== 'resolved')
  const resolved = incidents.filter((i) => i.status === 'resolved')

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-earth-50 to-earth-100 dark:from-[#0f1813] dark:via-[#0f1813] dark:to-[#14201a]">
      <header className="px-4 md:px-8 py-5 flex items-center justify-between">
        <Link to="/login" className="flex items-center gap-2.5">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="VolunTrack" className="w-9 h-9 object-contain" />
          <span className="font-display font-bold text-lg">VolunTrack</span>
        </Link>
        <Link to="/login" className="btn-ghost"><ArrowLeft className="w-4 h-4" /> Back to sign in</Link>
      </header>

      <main className="max-w-3xl mx-auto px-4 md:px-8 pb-20">
        <div className={`text-center p-6 rounded-2xl mb-6 ${allOk ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'}`}>
          <div className="text-4xl mb-2">{allOk ? '✅' : '⚠️'}</div>
          <h1 className="text-2xl font-bold text-earth-800 dark:text-earth-100">
            {allOk ? 'All Systems Operational' : 'Issues Detected'}
          </h1>
          <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">
            {allOk ? 'VolunTrack is running normally.' : `${active.length} active issue(s)`}
          </p>
        </div>

        {linkMessage && (
          <div className="text-center text-sm p-3 rounded-lg mb-4 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 text-brand-700 dark:text-brand-300">
            {linkMessage}
          </div>
        )}

        <Card className="mb-6">
          <form onSubmit={submitSubscribe} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="flex items-center gap-2 text-sm text-earth-600 dark:text-earth-300 shrink-0">
              <Mail className="w-4 h-4 text-brand-600" />
              Get emailed when there's an incident
            </div>
            <input
              type="email"
              required
              value={subscribeEmail}
              onChange={(e) => setSubscribeEmail(e.target.value)}
              placeholder="you@example.com"
              className="input flex-1"
            />
            <button type="submit" disabled={subscribing} className="btn-primary btn-sm shrink-0">
              {subscribing ? 'Subscribing…' : 'Subscribe'}
            </button>
          </form>
          {subscribeMessage && <p className="text-xs text-earth-500 dark:text-earth-400 mt-2">{subscribeMessage}</p>}
        </Card>

        <div className="flex gap-1 mb-6 bg-white/40 dark:bg-[#0f1813]/60 p-1 rounded-xl border border-earth-200 dark:border-earth-700">
          <button onClick={() => setStatusTab('overview')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${statusTab === 'overview' ? 'bg-brand-500 text-white shadow-sm' : 'text-earth-500 dark:text-earth-400 hover:text-earth-700 dark:hover:text-earth-200'}`}>
            <Server className="w-4 h-4" /> Overview
          </button>
          <button onClick={() => setStatusTab('incidents')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all relative ${statusTab === 'incidents' ? 'bg-brand-500 text-white shadow-sm' : 'text-earth-500 dark:text-earth-400 hover:text-earth-700 dark:hover:text-earth-200'}`}>
            <AlertTriangle className="w-4 h-4" /> Incidents
            {active.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center font-bold">{active.length > 9 ? '9+' : active.length}</span>
            )}
          </button>
          <button onClick={() => setStatusTab('system')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${statusTab === 'system' ? 'bg-brand-500 text-white shadow-sm' : 'text-earth-500 dark:text-earth-400 hover:text-earth-700 dark:hover:text-earth-200'}`}>
            <List className="w-4 h-4" /> System
          </button>
        </div>

        {statusTab === 'overview' && (
          <Card>
            <h2 className="font-display font-semibold text-lg mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5 text-brand-600" /> Services
              <span className="ml-auto text-xs font-normal text-earth-400">{criticalServices.filter(s => s.ok).length}/{criticalServices.length} critical operational</span>
            </h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {services.map((s) => (
                <StatusBadge key={s.name} ok={s.ok} label={`${s.name} — ${s.detail}`} />
              ))}
            </div>
          </Card>
        )}

        {statusTab === 'system' && (
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <h2 className="font-display font-semibold text-lg mb-4 flex items-center gap-2">
                <Database className="w-5 h-5 text-brand-600" /> Data
              </h2>
              <div className="text-sm text-earth-600 dark:text-earth-300 space-y-1">
                <DetailRow label="Total records" value={totalCount.toLocaleString()} />
                <DetailRow label="Total size" value={pretty} />
                <div className="mt-3 space-y-1.5">
                  {storageBreakdown.map(({ label, count, size }) => (
                    <div key={label} className="flex items-center justify-between text-xs">
                      <span className="capitalize text-earth-500 dark:text-earth-400">{label}</span>
                      <span className="text-earth-700 dark:text-earth-200 font-medium">{count} item{count !== 1 ? 's' : ''} ({(size / 1024).toFixed(1)} KB)</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            <Card>
              <h2 className="font-display font-semibold text-lg mb-4 flex items-center gap-2">
                <Globe className="w-5 h-5 text-brand-600" /> Network
              </h2>
              <div className="text-sm text-earth-600 dark:text-earth-300 space-y-1">
                <DetailRow label="API" value={import.meta.env.VITE_API_URL || 'local (dev)'} />
                <DetailRow label="Connection type" value={conn?.effectiveType || '—'} />
                <DetailRow label="Downlink" value={conn?.downlink ? `${conn.downlink} Mbps` : '—'} />
                <DetailRow label="RTT" value={conn?.rtt ? `${conn.rtt} ms` : '—'} />
              </div>
            </Card>

            <Card>
              <h2 className="font-display font-semibold text-lg mb-4 flex items-center gap-2">
                <Monitor className="w-5 h-5 text-brand-600" /> Display
              </h2>
              <div className="text-sm text-earth-600 dark:text-earth-300 space-y-1">
                <DetailRow label="Resolution" value={`${screenW} × ${screenH}`} />
                <DetailRow label="Pixel ratio" value={pixelRatio} />
                <DetailRow label="Color depth" value={`${colorDepth}-bit`} />
                <DetailRow label="Language" value={language} />
                <DetailRow label="Languages" value={languages} />
              </div>
            </Card>

            <Card>
              <h2 className="font-display font-semibold text-lg mb-4 flex items-center gap-2">
                <Cpu className="w-5 h-5 text-brand-600" /> Hardware
              </h2>
              <div className="text-sm text-earth-600 dark:text-earth-300 space-y-1">
                <DetailRow label="Platform" value={platform} />
                <DetailRow label="CPU cores" value={cores ? `${cores} logical` : '—'} />
                <DetailRow label="Device memory" value={mem ? `${mem} GB` : '—'} />
              </div>
            </Card>

            <Card>
              <h2 className="font-display font-semibold text-lg mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-brand-600" /> Time
              </h2>
              <div className="text-sm text-earth-600 dark:text-earth-300 space-y-1">
                <DetailRow label="Local time" value={new Date().toLocaleString()} />
                <DetailRow label="UTC time" value={new Date().toUTCString()} />
                <DetailRow label="Timezone" value={Intl.DateTimeFormat().resolvedOptions().timeZone} />
                <DetailRow label="Offset" value={`UTC${new Date().getTimezoneOffset() <= 0 ? '+' : '-'}${Math.abs(new Date().getTimezoneOffset() / 60)}`} />
                <DetailRow label="Locale" value={navigator.language} />
              </div>
            </Card>

            <Card className="md:col-span-2">
              <h2 className="font-display font-semibold text-lg mb-4 flex items-center gap-2">
                <Eye className="w-5 h-5 text-brand-600" /> User Agent
              </h2>
              <p className="text-xs text-earth-500 dark:text-earth-400 break-all select-all leading-relaxed">{userAgent}</p>
            </Card>
          </div>
        )}

        {statusTab === 'incidents' && (
          <Card>
            <h2 className="font-display font-semibold text-lg mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-brand-600" /> Incidents
              {incidents.length > 0 && (
                <span className="ml-auto text-xs font-normal text-earth-400">
                  <Bell className="w-3.5 h-3.5 inline mr-1" />
                  {active.length} active · {resolved.length} resolved
                </span>
              )}
            </h2>
            {incidents.length === 0 ? (
              <div className="text-sm text-earth-500 dark:text-earth-400">No incidents recorded.</div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {incidents.map((inc) => {
                  const isResolved = inc.status === 'resolved'
                  return (
                    <div key={inc.id} className={`flex items-start gap-2 text-sm rounded-lg p-3 border ${isResolved ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'}`}>
                      {isResolved ? <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-earth-800 dark:text-earth-200">{inc.service}</p>
                          <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${isResolved ? 'text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/30' : 'text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30'}`}>{inc.status}</span>
                        </div>
                        {inc.detail && <p className="text-xs text-earth-500 dark:text-earth-400 mt-0.5">{inc.detail}</p>}
                        <p className="text-xs text-earth-400 dark:text-earth-500 mt-0.5">{new Date(inc.detectedAt).toLocaleString()}</p>
                        {inc.issueUrl && (
                          <a href={inc.issueUrl} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline mt-0.5 inline-block">
                            GitHub issue ↗
                          </a>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        )}
      </main>
    </div>
  )
}
