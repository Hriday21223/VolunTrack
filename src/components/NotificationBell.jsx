import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth.jsx'
import { cn } from '@/utils/cn.js'
import { tr, language } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const POLL_MS = 60 * 1000
const PANEL_MAX = 352 // 22rem
const GUTTER = 16

// A heading per kind (server/notifications.js NOTIFICATION_KINDS), so it can
// be translated; the server's English title is the fallback for a kind this
// build doesn't know yet.
const KIND_LABELS = {
  signup_approved: tr('Sign-up approved'),
  signup_rejected: tr('Sign-up not accepted'),
  waitlist_spot: tr("You're off the waitlist"),
  new_task: tr('New task'),
  hours_approved: tr('Hours approved'),
  hours_rejected: tr('Hours not approved'),
  hours_reminder: tr('Hours reminder'),
  friend_joined: tr('A friend joined'),
  parent_ok_request: tr('Needs your OK'),
  parent_ok_given: tr('Your parent said yes'),
  parent_ok_declined: tr('Your parent said no'),
  comeback_nudge: tr('We miss you'),
}

const getToken = () => {
  try { return localStorage.getItem('voluntrack:auth_token') } catch { return null }
}

const relative = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
function timeAgo(value) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000)
  if (!Number.isFinite(seconds)) return ''
  const abs = Math.abs(seconds)
  if (abs < 60) return relative.format(0, 'second')
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute')
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour')
  return relative.format(Math.round(seconds / 86400), 'day')
}

// The bell in the app header: approvals, waitlist spots, new tasks from
// followed organizers and hour decisions (server/routes/notifications.js).
// Polls once a minute, only while the tab is visible. A local-only account
// (no token) has no server to ask, so it shows nothing.
export default function NotificationBell({ className }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [hasToken, setHasToken] = useState(() => Boolean(getToken()))
  // Where the panel sits, relative to the bell. The bell isn't always at the
  // right edge (the header wraps on a phone), so the panel is clamped to the
  // screen with a 16px gutter rather than hung off the bell's right side.
  const [panel, setPanel] = useState({ left: 0, width: PANEL_MAX })
  const rootRef = useRef(null)

  const load = useCallback(async () => {
    const token = getToken()
    setHasToken(Boolean(token))
    if (!token) return
    try {
      const r = await fetch(`${apiUrl}/notifications`, { headers: { Authorization: `Bearer ${token}` } })
      if (!r.ok) return
      const d = await r.json()
      setItems(d.notifications || [])
      setUnread(Number(d.unread) || 0)
      setLoaded(true)
    } catch { /* offline or asleep: try again on the next tick */ }
  }, [])

  useEffect(() => {
    if (!user) return undefined
    load()
    const tick = () => { if (document.visibilityState === 'visible') load() }
    const timer = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [user, load])

  const place = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    const vw = document.documentElement.clientWidth || window.innerWidth
    const width = Math.min(PANEL_MAX, vw - GUTTER * 2)
    const left = Math.min(Math.max(rect.right - width, GUTTER), vw - GUTTER - width)
    setPanel({ left: left - rect.left, width })
  }, [])

  useEffect(() => {
    if (!open) return undefined
    window.addEventListener('resize', place)
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  const markRead = async (ids) => {
    const token = getToken()
    if (!token) return
    // Optimistic: the badge drops at once, and the next poll corrects it.
    const now = new Date().toISOString()
    setItems((list) => list.map((n) => (!ids || ids.includes(n.id) ? { ...n, readAt: n.readAt || now } : n)))
    setUnread((n) => (ids ? Math.max(0, n - ids.length) : 0))
    try {
      await fetch(`${apiUrl}/notifications/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(ids ? { ids } : {}),
      })
    } catch { /* the next poll shows the true state */ }
  }

  const openItem = (n) => {
    if (!n.readAt) markRead([n.id])
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  if (!user || !hasToken) return null

  const badge = unread > 99 ? '99+' : String(unread)
  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => {
          if (!open) { place(); load() }
          setOpen((o) => !o)
        }}
        className="relative p-2 rounded-lg text-earth-200 hover:text-white hover:bg-white/10"
        aria-label={unread ? tr('Notifications, {n} unread', { n: unread }) : tr('Notifications')}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[1.15rem] h-[1.15rem] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-[1.15rem] text-center">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={tr('Notifications')}
          style={{ left: panel.left, width: panel.width }}
          className="absolute top-full mt-2 z-50 rounded-2xl border border-earth-800 bg-[#0b1a22] shadow-2xl text-earth-100 overflow-hidden"
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-earth-800">
            <span className="font-semibold text-sm">{tr('Notifications')}</span>
            {unread > 0 && (
              <button type="button" onClick={() => markRead(null)} className="text-xs font-medium text-brand-300 hover:text-brand-200">
                {tr('Mark all read')}
              </button>
            )}
          </div>
          <div className="max-h-[min(26rem,70vh)] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-earth-400">
                {loaded ? tr("You're all caught up.") : tr('Loading…')}
              </p>
            ) : (
              <ul className="divide-y divide-earth-800/70">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={cn('w-full text-left px-4 py-3 flex gap-3 hover:bg-white/5', !n.readAt && 'bg-brand-500/5')}
                    >
                      <span
                        className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand-400')}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-earth-400">
                          {KIND_LABELS[n.kind] || tr('Update')} · {timeAgo(n.createdAt)}
                          {!n.readAt && <span className="sr-only"> ({tr('unread')})</span>}
                        </span>
                        <span className={cn('block text-sm truncate', n.readAt ? 'text-earth-200' : 'font-semibold text-white')}>{n.title}</span>
                        {n.body && <span className="block text-xs text-earth-400 line-clamp-2">{n.body}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
