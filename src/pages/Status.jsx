import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Activity, CheckCircle2, XCircle, Globe, HardDrive, Smartphone, Clock, Database, Cpu, Monitor, Eye, AlertTriangle, Bell, Bot, Loader2, Wrench, Server, List } from 'lucide-react'
import Card from '@/components/Card.jsx'

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

import { getIncidents, getAgentLog, saveIncident, logAgentAction, sendEmailAlert, notify, runAgent, updateIncidentStatus } from '@/lib/agent.js'

const STORAGE_KEYS = [
  'voluntrack:user', 'voluntrack:users', 'voluntrack:logs', 'voluntrack:goals',
  'voluntrack:achievements', 'voluntrack:theme', 'voluntrack:reminders',
  'voluntrack:fired-reminders', 'voluntrack:reviews', 'voluntrack:contacts',
  'voluntrack:dashboard-tour', 'voluntrack:auth_token', 'voluntrack:incidents',
  'voluntrack:agent_log',
]

export default function Status() {
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
  const [incidents, setIncidents] = useState(getIncidents)
  const [agentLog, setAgentLog] = useState(getAgentLog)
  const [ready, setReady] = useState(false)
  const [agentRunning, setAgentRunning] = useState(false)
  const prevRef = useRef({})

  useEffect(() => {
    const go = () => setOnline(true)
    const goA = () => setOnline(false)
    window.addEventListener('online', go)
    window.addEventListener('offline', goA)
    return () => { window.removeEventListener('online', go); window.removeEventListener('offline', goA) }
  }, [])

  const [appHealthy, setAppHealthy] = useState(true)
  const [emailOk, setEmailOk] = useState(null)

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
    const checkEmail = async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL || '/api'}/recovery-status`, { signal: AbortSignal.timeout(5000) })
        const data = await res.json()
        setEmailOk(Boolean(data.smtpConfigured))
      } catch { setEmailOk(false) }
    }
    checkEmail()
    const id = setInterval(checkEmail, 30000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        setSwStatus(reg ? 'active' : 'none')
        setReady(true)
      }).catch(() => { setSwStatus('error'); setReady(true) })
    } else {
      setSwStatus('unsupported')
      setReady(true)
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

  const notificationOk = 'Notification' in window && Notification.permission !== 'denied'
  const geolocationOk = 'geolocation' in navigator
  const pwaSupported = 'serviceWorker' in navigator
  const sessionOk = (() => { try { sessionStorage.setItem('__test__', '1'); sessionStorage.removeItem('__test__'); return true } catch { return false } })()
  const indexedDbOk = 'indexedDB' in window
  const cacheOk = 'caches' in window
  const cookiesOk = navigator.cookieEnabled
  const workersOk = 'Worker' in window
  const canvasOk = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext && c.getContext('2d')) } catch { return false } })()
  const webglOk = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))) } catch { return false } })()
  const fileApiOk = 'FileReader' in window
  const clipboardOk = 'clipboard' in navigator
  const touchOk = 'ontouchstart' in window
  const batteryOk = 'getBattery' in navigator
  const vibrationOk = 'vibrate' in navigator
  const webSocketOk = 'WebSocket' in window
  const webAudioOk = (() => { try { return !!(window.AudioContext || window.webkitAudioContext) } catch { return false } })()
  const screenWakeOk = 'wakeLock' in navigator

  const services = [
    { name: 'Application', ok: appHealthy, critical: true },
    { name: 'Service Worker', ok: swStatus === 'active' || swStatus === 'none', critical: true },
    { name: 'Connection', ok: online, critical: true },
    { name: 'Session Storage', ok: sessionOk },
    { name: 'Local Storage', ok: storageOk, critical: true },
    { name: 'IndexedDB', ok: indexedDbOk, critical: true },
    { name: 'Cache API', ok: cacheOk },
    { name: 'Cookies', ok: cookiesOk },
    { name: 'Notifications', ok: notificationOk },
    { name: 'Geolocation', ok: geolocationOk, critical: true },
    { name: 'File API', ok: fileApiOk, critical: true },
    { name: 'Canvas 2D', ok: canvasOk },
    { name: 'WebGL', ok: webglOk, critical: true },
    { name: 'Web Workers', ok: workersOk, critical: true },
    { name: 'Clipboard', ok: clipboardOk },
    { name: 'Touch Events', ok: touchOk },
    { name: 'Battery API', ok: batteryOk },
    { name: 'Vibration', ok: vibrationOk },
    { name: 'WebSocket', ok: webSocketOk, critical: true },
    { name: 'Email (SMTP)', ok: emailOk !== null ? emailOk : true, critical: false },
    { name: 'Web Audio', ok: webAudioOk },
    { name: 'Screen Wake Lock', ok: screenWakeOk },
    { name: 'PWA', ok: pwaSupported && swStatus === 'active' },
  ]

  useEffect(() => {
    if (!ready) return
    const prev = prevRef.current
    const toFix = []
    services.forEach(({ name, ok, critical }) => {
      if (!ok && prev[name] !== false) {
        if (critical) {
          saveIncident(name, `${name} is unavailable`)
          notify(name)
          sendEmailAlert(name)
          toFix.push(name)
        }
      }
      prev[name] = ok
    })
    prevRef.current = services.reduce((acc, { name, ok }) => ({ ...acc, [name]: ok }), {})
    setIncidents(getIncidents())

    if (toFix.length > 0) {
      setAgentRunning(true)
      logAgentAction(`AI Agent activated — ${toFix.length} issue(s) detected`, 'info')
      const incs = getIncidents()
      toFix.forEach(async (svc) => {
        const inc = incs.find((i) => i.service === svc && i.status === 'detected')
        if (inc) {
          await runAgent(svc, inc.id)
          setIncidents(getIncidents())
          setAgentLog(getAgentLog())
        }
      })
      setTimeout(() => setAgentRunning(false), toFix.length * 3000)
    }
  }, [ready, appHealthy, online, swStatus, storageOk, sessionOk, indexedDbOk, cacheOk, cookiesOk, notificationOk, geolocationOk, pwaSupported, canvasOk, webglOk, fileApiOk, clipboardOk, touchOk, batteryOk, vibrationOk, webSocketOk, webAudioOk, screenWakeOk, workersOk])

  useEffect(() => {
    const h = () => { setAgentLog(getAgentLog()); setIncidents(getIncidents()) }
    window.addEventListener('storage', h)
    return () => window.removeEventListener('storage', h)
  }, [])

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
  const [statusTab, setStatusTab] = useState('overview')

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-earth-50 to-earth-100 dark:from-[#0f1813] dark:via-[#0f1813] dark:to-[#14201a]">
      <header className="px-4 md:px-8 py-5 flex items-center justify-between">
        <Link to="/login" className="flex items-center gap-2.5">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="VolunTrack" className="w-9 h-9 object-contain" />
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
            {allOk ? 'VolunTrack is running normally.' : `${active.length} active issue(s) — AI agent is ${agentRunning ? 'working' : 'idle'}`}
          </p>
        </div>

        {!allOk && (
          <Card className="mb-4 border-amber-400/30 bg-amber-50 dark:bg-amber-900/10">
            <div className="flex items-center gap-3">
              {agentRunning ? (
                <Loader2 className="w-5 h-5 text-amber-600 animate-spin" />
              ) : (
                <Bot className="w-5 h-5 text-amber-600" />
              )}
              <div className="text-sm">
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  AI Agent — {agentRunning ? 'resolving issues...' : 'auto-fix complete'}
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                  {active.length} unresolved · {resolved.length} resolved
                </p>
              </div>
            </div>
          </Card>
        )}

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
          <button onClick={() => setStatusTab('agent')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${statusTab === 'agent' ? 'bg-brand-500 text-white shadow-sm' : 'text-earth-500 dark:text-earth-400 hover:text-earth-700 dark:hover:text-earth-200'}`}>
            <Bot className="w-4 h-4" /> Agent Log
            {agentRunning && <Loader2 className="w-3 h-3 text-amber-500 animate-spin" />}
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
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
              <StatusBadge ok={appHealthy} label={`Application — ${appHealthy ? 'responding' : 'unreachable'}`} />
              <StatusBadge ok={swStatus === 'active' || swStatus === 'none'} label={`Service Worker — ${swStatus}`} />
              <StatusBadge ok={online} label={`Connection — ${online ? 'online' : 'offline'}`} />
              <StatusBadge ok={sessionOk} label={`Session Storage — ${sessionOk ? 'ready' : 'unavailable'}`} />
              <StatusBadge ok={storageOk} label={`Local Storage — ${storageOk ? 'ready' : 'unavailable'}`} />
              <StatusBadge ok={indexedDbOk} label={`IndexedDB — ${indexedDbOk ? 'ready' : 'unavailable'}`} />
              <StatusBadge ok={cacheOk} label={`Cache API — ${cacheOk ? 'ready' : 'unavailable'}`} />
              <StatusBadge ok={cookiesOk} label={`Cookies — ${cookiesOk ? 'enabled' : 'disabled'}`} />
              <StatusBadge ok={notificationOk} label={`Notifications — ${notificationOk ? 'granted' : 'blocked'}`} />
              <StatusBadge ok={geolocationOk} label={`Geolocation — ${geolocationOk ? 'ready' : 'unavailable'}`} />
              <StatusBadge ok={fileApiOk} label={`File API — ${fileApiOk ? 'ready' : 'unavailable'}`} />
              <StatusBadge ok={canvasOk} label={`Canvas 2D — ${canvasOk ? 'ready' : 'unavailable'}`} />
              <StatusBadge ok={webglOk} label={`WebGL — ${webglOk ? 'ready' : 'unavailable'}`} />
              <StatusBadge ok={workersOk} label={`Web Workers — ${workersOk ? 'ready' : 'unavailable'}`} />
              <StatusBadge ok={clipboardOk} label={`Clipboard — ${clipboardOk ? 'ready' : 'unavailable'}`} />
              <StatusBadge ok={touchOk} label={`Touch Events — ${touchOk ? 'supported' : 'unsupported'}`} />
              <StatusBadge ok={batteryOk} label={`Battery API — ${batteryOk ? 'ready' : 'unavailable'}`} />
              <StatusBadge ok={vibrationOk} label={`Vibration — ${vibrationOk ? 'ready' : 'unavailable'}`} />
              <StatusBadge ok={webSocketOk} label={`WebSocket — ${webSocketOk ? 'ready' : 'unavailable'}`} />
              <StatusBadge ok={webAudioOk} label={`Web Audio — ${webAudioOk ? 'ready' : 'unavailable'}`} />
              <StatusBadge ok={screenWakeOk} label={`Screen Wake Lock — ${screenWakeOk ? 'ready' : 'unavailable'}`} />
              <StatusBadge ok={pwaSupported && swStatus === 'active'} label={`PWA — ${!pwaSupported ? 'unsupported' : swStatus === 'active' ? 'ready' : swStatus === 'none' ? 'not registered' : swStatus}`} />
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
              {active.length > 0 && (
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
                  const statusColors = {
                    detected: 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800',
                    investigating: 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800',
                    fixing: 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800',
                    resolved: 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800',
                    failed: 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800',
                  }
                  const statusIcons = {
                    detected: <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />,
                    investigating: <Loader2 className="w-4 h-4 text-amber-500 mt-0.5 shrink-0 animate-spin" />,
                    fixing: <Wrench className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />,
                    resolved: <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />,
                    failed: <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />,
                  }
                  return (
                    <div key={inc.id} className={`flex items-start gap-2 text-sm rounded-lg p-3 border ${statusColors[inc.status] || statusColors.detected}`}>
                      {statusIcons[inc.status] || statusIcons.detected}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-earth-800 dark:text-earth-200">{inc.service}</p>
                          <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${
                            inc.status === 'resolved' ? 'text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/30' :
                            inc.status === 'failed' ? 'text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30' :
                            inc.status === 'investigating' || inc.status === 'fixing' ? 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30' :
                            'text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30'
                          }`}>{inc.status}</span>
                        </div>
                        <p className="text-xs text-earth-500 dark:text-earth-400 mt-0.5">{inc.detail}</p>
                        <p className="text-xs text-earth-400 dark:text-earth-500 mt-0.5">{new Date(inc.detectedAt).toLocaleString()}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        )}

        {statusTab === 'agent' && (
          <Card>
            <h2 className="font-display font-semibold text-lg mb-4 flex items-center gap-2">
              <Bot className="w-5 h-5 text-brand-600" /> AI Agent Log
              {agentRunning && <Loader2 className="w-4 h-4 text-amber-500 animate-spin ml-1" />}
            </h2>
            {agentLog.length === 0 ? (
              <div className="text-sm text-earth-500 dark:text-earth-400">No agent activity yet.</div>
            ) : (
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {agentLog.map((entry) => {
                  const typeColors = {
                    info: 'text-blue-600 dark:text-blue-400',
                    fixing: 'text-amber-600 dark:text-amber-400',
                    success: 'text-green-600 dark:text-green-400',
                    error: 'text-red-600 dark:text-red-400',
                  }
                  return (
                    <div key={entry.id} className="flex items-start gap-2 text-xs">
                      <span className="text-earth-400 dark:text-earth-500 shrink-0 w-16">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                      <span className={typeColors[entry.type] || 'text-earth-600 dark:text-earth-300'}>{entry.message}</span>
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
