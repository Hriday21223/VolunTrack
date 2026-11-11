import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { X, BadgeCheck, CalendarDays, MapPin, Loader2 } from 'lucide-react'
import { tr } from '@/lib/i18n.js'
import { fmtDate } from '@/utils/date.js'
import { isNativeApp } from '@/lib/platform.js'
import WalletButtons from '@/components/WalletButtons.jsx'
import BadgeJobs from '@/components/BadgeJobs.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
// Links staff open by scanning: the public site, never the app's own origin.
const siteUrl = () => String((isNativeApp && import.meta.env.VITE_SITE_URL) || window.location.origin).replace(/\/$/, '')

const initials = (name) => String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?'

// The digital volunteer badge (#597): full screen, for showing at the event.
// A live clock and a moving shine make a screenshot easy to tell apart, and
// the QR code opens VolunTrack's own check page (/badge/<code>) for staff.
export default function VolunteerBadge({ taskId, onClose }) {
  const [state, setState] = useState({ loading: true, badge: null, error: '' })
  const [now, setNow] = useState(() => new Date())
  const canvas = useRef(null)

  useEffect(() => {
    let alive = true
    fetch(`${apiUrl}/school/public-tasks/${encodeURIComponent(taskId)}/badge`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` },
    })
      .then(async (res) => {
        const d = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(d.error || tr('Could not load your badge.'))
        if (alive) setState({ loading: false, badge: d.badge, error: '' })
      })
      .catch((e) => alive && setState({ loading: false, badge: null, error: e.message }))
    return () => { alive = false }
  }, [taskId])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!state.badge || !canvas.current) return
    QRCode.toCanvas(canvas.current, `${siteUrl()}/badge/${state.badge.code}`, { width: 168, margin: 1, color: { dark: '#0f2a1a', light: '#ffffff' } }).catch(() => {})
  }, [state.badge])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const b = state.badge
  return (
    <div className="fixed inset-0 z-[120] bg-[#06120b] overflow-y-auto" role="dialog" aria-modal="true" aria-label={tr('Volunteer badge')}>
      <button type="button" onClick={onClose} className="absolute top-4 right-4 z-10 rounded-full bg-white/10 p-2 text-white" aria-label={tr('Close')}>
        <X className="w-5 h-5" />
      </button>
      <div className="min-h-full grid place-items-center px-4 py-12">
        {state.loading ? (
          <Loader2 className="w-8 h-8 animate-spin text-white" />
        ) : state.error ? (
          <p className="max-w-xs text-center text-white/80">{state.error}</p>
        ) : (
          <div className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700 p-6 text-white shadow-2xl">
            <span aria-hidden="true" className="pointer-events-none absolute inset-0 badge-shine" />
            <p className="text-center text-xs font-semibold uppercase tracking-[0.3em] text-white/80">VolunTrack</p>
            <p className="mt-1 text-center font-display text-4xl font-extrabold tracking-wide">{tr('VOLUNTEER')}</p>
            <div className="mx-auto mt-5 grid h-20 w-20 place-items-center rounded-full bg-white/20 font-display text-3xl font-bold ring-4 ring-white/40">{initials(b.name)}</div>
            <p className="mt-3 text-center font-display text-2xl font-bold break-words">{b.name}</p>
            <p className="mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold">
              <BadgeCheck className="w-4 h-4" />{' '}{tr('Approved by the organizer')}
            </p>
            <div className="mt-5 rounded-2xl bg-black/20 p-4 text-sm space-y-1.5">
              <p className="font-semibold text-base break-words">{b.title}</p>
              <p className="flex items-center gap-1.5"><CalendarDays className="w-4 h-4 shrink-0" />{' '}{fmtDate(b.date)}{b.time ? ` · ${b.time}` : ''}</p>
              {b.location && <p className="flex items-start gap-1.5"><MapPin className="w-4 h-4 mt-0.5 shrink-0" /><span className="break-words">{b.location}</span></p>}
              {b.organizer && <p className="text-white/80">{tr('Organized by {name}', { name: b.organizer })}</p>}
            </div>
            <div className="mt-5 flex items-center justify-between gap-4">
              <div>
                <BadgeTimer badge={b} now={now} />
                <p className="mt-2 text-xs text-white/80 max-w-[9rem]">{tr('Staff can scan the code to check this badge.')}</p>
              </div>
              <canvas ref={canvas} className="rounded-xl bg-white p-1 shrink-0 w-36 h-36" width={168} height={168} aria-label={tr('Badge check code')} />
            </div>
          </div>
        )}
        {b && <BadgeJobs taskId={taskId} />}
        {b && (
          <div className="mt-4 w-full max-w-sm space-y-2">
            <WalletButtons badgeTaskId={taskId} className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/20 disabled:opacity-60" />
          </div>
        )}
      </div>
    </div>
  )
}

// How long they've been volunteering (#847), counting up every second from
// check-in, so it stays live like the clock it replaced (a screenshot shows a
// frozen number). Before check-in it shows the clock; after check-out, the total.
function BadgeTimer({ badge, now }) {
  const start = badge.checkedInAt ? new Date(badge.checkedInAt) : null
  const end = badge.checkedOutAt ? new Date(badge.checkedOutAt) : null
  if (start && end) {
    const mins = Math.max(0, Math.round((end - start) / 60000))
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return (
      <>
        <p className="text-xs uppercase tracking-wider text-white/70">{tr('You volunteered')}</p>
        <p className="text-xl font-bold whitespace-nowrap">{h > 0 ? tr('{h} h {m} min', { h, m }) : tr('{m} min', { m })}</p>
        <p className="mt-1 font-mono text-xs tabular-nums text-white/80" aria-live="off">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</p>
      </>
    )
  }
  if (start) {
    const secs = Math.max(0, Math.floor((now - start) / 1000))
    const pad = (n) => String(n).padStart(2, '0')
    const text = `${Math.floor(secs / 3600)}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}`
    return (
      <>
        <p className="text-xs uppercase tracking-wider text-white/70">{tr('Volunteering for')}</p>
        <p className="font-mono text-xl font-bold tabular-nums whitespace-nowrap" aria-live="off">{text}</p>
        <p className="mt-1 text-xs text-white/80">{tr('Checked in at {time}', { time: start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) })}</p>
      </>
    )
  }
  return (
    <>
      <p className="text-xs uppercase tracking-wider text-white/70">{tr('Not checked in yet')}</p>
      <p className="font-mono text-xl font-bold tabular-nums whitespace-nowrap" aria-live="off">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</p>
    </>
  )
}
