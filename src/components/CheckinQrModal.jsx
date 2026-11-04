import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { X, QrCode, CheckCircle, LogIn, Phone } from 'lucide-react'
import { isNativeApp } from '@/lib/platform.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
// Where the QR code points. The phone app's own origin is a localhost the
// volunteer's camera can't open, so the app uses the public site instead.
const SITE = (isNativeApp && import.meta.env.VITE_SITE_URL) || window.location.origin

// "9:05 AM" in the viewer's own clock.
function clock(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// "2.25 hours", "1 hour".
function hoursText(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100
  return v === 1 ? '1 hour' : `${v} hours`
}

// A 6-digit check-out PIN for phones (#681): the organizer makes one, says it
// aloud or shows it, and checked-in volunteers type it under Attendance to
// check out. The server keeps only a hash, so the PIN shows just once here;
// it lasts 30 minutes and a new one replaces it.
function CheckoutPinSection({ taskId, until, onChange }) {
  const [pin, setPin] = useState(null) // { pin, until }
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const call = async (method) => {
    setBusy(true)
    setMsg('')
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${taskId}/checkout-pin`, {
        method,
        headers: { Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not change the check-out PIN.')
      setPin(method === 'POST' ? body : null)
      onChange?.()
    } catch (e) {
      setMsg(e.message)
    } finally {
      setBusy(false)
    }
  }
  const live = pin && new Date(pin.until) > new Date() ? pin : null
  return (
    <div className="mt-3 border-t border-white/10 pt-3">
      <p className="text-sm font-medium">Check-out PIN for phones</p>
      {live ? (
        <>
          <p className="text-4xl font-bold tracking-[0.3em] text-yellow-300 my-2" aria-label={`Check-out PIN ${live.pin.split('').join(' ')}`}>{live.pin}</p>
          <p className="text-xs text-earth-400">Volunteers who checked in open <strong>Attendance</strong> on their phone and type this to check out. It works until {clock(live.until)}.</p>
        </>
      ) : until ? (
        <p className="text-xs text-earth-400 mt-1">A check-out PIN is on until {clock(until)}. It's shown only when it's made, so make a new one if you need to see it.</p>
      ) : (
        <p className="text-xs text-earth-400 mt-1">Instead of scanning again, volunteers can check out on their phone with a PIN you make. It lasts 30 minutes.</p>
      )}
      <div className="flex flex-wrap gap-2 mt-2">
        <button type="button" onClick={() => call('POST')} disabled={busy} className="btn-secondary btn-sm">{live || until ? 'Make a new PIN' : 'Make a check-out PIN'}</button>
        {(live || until) && <button type="button" onClick={() => call('DELETE')} disabled={busy} className="btn-ghost btn-sm">Turn off</button>}
      </div>
      {msg && <p className="text-sm text-red-400 mt-1" role="alert">{msg}</p>}
    </div>
  )
}

// The organizer's check-in screen: a QR code volunteers scan on arrival and
// again when they leave (server/routes/school.js, "QR check-in"). The code in
// it changes every minute, so this refreshes on the server's schedule, and
// polls who has scanned.
// "9:05 AM" in the viewer's own clock.
function clock(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// "2.25 hours", "1 hour".
function hoursText(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100
  return v === 1 ? '1 hour' : `${v} hours`
}

export default function CheckinQrModal({ task, onClose }) {
  const canvasRef = useRef(null)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [confirmClose, setConfirmClose] = useState(false)
  const [closing, setClosing] = useState(false)
  const [closeMsg, setCloseMsg] = useState(null) // { text, ok }

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${task.id}/checkin`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not load the check-in code.')
      setData(body)
      setError('')
      return body
    } catch (e) {
      setError(e.message)
      return null
    }
  }, [task.id])

  // Refresh when the code changes, and every 10 s for the scan list.
  useEffect(() => {
    let timer
    let stopped = false
    const tick = async () => {
      const body = await load()
      if (stopped) return
      timer = setTimeout(tick, Math.min(3, body?.refreshIn ?? 3) * 1000 + 300)
    }
    tick()
    return () => { stopped = true; clearTimeout(timer) }
  }, [load])

  const url = data ? `${SITE}/checkin/${task.id}?c=${encodeURIComponent(data.code)}` : ''
  useEffect(() => {
    if (url && canvasRef.current) QRCode.toCanvas(canvasRef.current, url, { width: 300, margin: 2 }, () => {})
  }, [url])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const people = data?.people || []
  const inCount = people.filter((p) => p.checkedInAt).length
  const outCount = people.filter((p) => p.checkedOutAt).length
  const stillHere = inCount - outCount
  const totalHours = data?.totalHours || 0

  // Everyone still checked in leaves now: for volunteers who forget the
  // second scan. Their hours are logged as approved by you.
  const checkEveryoneOut = async () => {
    setClosing(true)
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${task.id}/checkin/close`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not check volunteers out.')
      setCloseMsg({ ok: true, text: body.checkedOut === 1 ? '1 volunteer checked out and their hours logged.' : `${body.checkedOut} volunteers checked out and their hours logged.` })
      await load()
    } catch (e) {
      setCloseMsg({ ok: false, text: e.message })
    } finally {
      setClosing(false)
      setConfirmClose(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/80 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-labelledby="checkin-title">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0f1813] p-5 text-white shadow-soft max-h-[95vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="checkin-title" className="font-display font-semibold text-lg flex items-center gap-2"><QrCode className="w-5 h-5 text-brand-400" /> Check-in</h2>
            <p className="text-sm text-earth-400">{task.title}</p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        <div className="mt-4 grid place-items-center">
          {error ? (
            <p className="text-sm text-red-400 py-10 text-center">{error}</p>
          ) : (
            <div className="rounded-2xl bg-white p-3"><canvas ref={canvasRef} aria-label="Check-in QR code" /></div>
          )}
          <p className="text-sm text-earth-300 mt-3 text-center">
            Volunteers scan this with their phone's camera when they <strong>arrive</strong>, and again when they <strong>leave</strong> — their hours are worked out from the two scans and sent to you to sign.
          </p>
          <p className="text-xs text-earth-500 mt-1 text-center">The code changes every minute, so a photo of it stops working.</p>
        </div>

        <div className="mt-4 border-t border-white/10 pt-3">
          <p className="text-sm font-medium">{inCount} of {people.length} checked in · {outCount} checked out</p>
          {outCount > 0 && (
            <p className="text-sm text-emerald-300">Total: {hoursText(totalHours)} from {outCount === 1 ? '1 volunteer' : `${outCount} volunteers`}</p>
          )}
          <div className="mb-2" />
          {people.length === 0 ? (
            <p className="text-sm text-earth-500">No approved volunteers yet.</p>
          ) : (
            <ul className="space-y-1">
              {people.map((p) => (
                <li key={p.name} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0">
                    {p.name}
                    {p.parentComing && <span className="block text-xs text-amber-300">Parent coming: {p.parentComing}</span>}
                    {p.screenCode && <span className="block text-2xl font-bold tracking-[0.3em] text-yellow-300">{p.screenCode}</span>}
                    {p.emergencyContact && (
                      <a href={`tel:${p.emergencyContact.phone.replace(/[^\d+]/g, '')}`} className="block text-xs text-sky-300 hover:underline">
                        <Phone className="w-3 h-3 inline mr-1" aria-hidden="true" />
                        Emergency: {p.emergencyContact.name ? `${p.emergencyContact.name}, ` : ''}{p.emergencyContact.phone}
                      </a>
                    )}
                  </span>
                  <span className={`text-xs flex items-center gap-1 ${p.checkedOutAt ? 'text-emerald-400' : p.checkedInAt ? 'text-amber-300' : 'text-earth-500'}`}>
                    {p.checkedOutAt ? <><CheckCircle className="w-3.5 h-3.5" /> Done</> : p.checkedInAt ? <><LogIn className="w-3.5 h-3.5" /> Here</> : 'Not yet'}
                    {p.checkedOutAt
                      ? <span className="text-earth-300 whitespace-nowrap">· {clock(p.checkedInAt)}–{clock(p.checkedOutAt)} · {hoursText(p.hours)}</span>
                      : p.checkedInAt && <span className="text-earth-300 whitespace-nowrap">· since {clock(p.checkedInAt)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {stillHere > 0 && (
            <div className="mt-3 border-t border-white/10 pt-3">
              {confirmClose ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-earth-300">Check out {stillHere === 1 ? 'the 1 volunteer' : `all ${stillHere} volunteers`} still here, and log their hours until now?</span>
                  <button onClick={checkEveryoneOut} disabled={closing} className="btn-primary btn-sm">{closing ? 'Checking out…' : 'Yes'}</button>
                  <button onClick={() => setConfirmClose(false)} disabled={closing} className="btn-ghost btn-sm">No</button>
                </div>
              ) : (
                <button onClick={() => { setCloseMsg(null); setConfirmClose(true) }} className="btn-secondary btn-sm">
                  Check everyone out ({stillHere})
                </button>
              )}
              <p className="text-xs text-earth-500 mt-1">For volunteers who leave without scanning again.</p>
            </div>
          )}
          {closeMsg && <p className={`text-sm mt-2 ${closeMsg.ok ? 'text-emerald-300' : 'text-red-400'}`} role="status">{closeMsg.text}</p>}
          {inCount > 0 && <CheckoutPinSection taskId={task.id} until={data?.checkoutPinUntil} onChange={load} />}
        </div>
      </div>
    </div>
  )
}
