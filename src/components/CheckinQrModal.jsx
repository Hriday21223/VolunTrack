import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { X, QrCode, CheckCircle, LogIn } from 'lucide-react'
import { isNativeApp } from '@/lib/platform.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
// Where the QR code points. The phone app's own origin is a localhost the
// volunteer's camera can't open, so the app uses the public site instead.
const SITE = (isNativeApp && import.meta.env.VITE_SITE_URL) || window.location.origin

// The organizer's check-in screen: a QR code volunteers scan on arrival and
// again when they leave (server/routes/school.js, "QR check-in"). The code in
// it changes every minute, so this refreshes on the server's schedule, and
// polls who has scanned.
export default function CheckinQrModal({ task, onClose }) {
  const canvasRef = useRef(null)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

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
      timer = setTimeout(tick, Math.min(10, body?.refreshIn ?? 10) * 1000 + 300)
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
            Volunteers scan this with their phone's camera when they <strong>arrive</strong>, and again when they <strong>leave</strong> — their hours are then logged and approved for you.
          </p>
          <p className="text-xs text-earth-500 mt-1 text-center">The code changes every minute, so a photo of it stops working.</p>
        </div>

        <div className="mt-4 border-t border-white/10 pt-3">
          <p className="text-sm font-medium mb-2">{inCount} of {people.length} checked in · {outCount} checked out</p>
          {people.length === 0 ? (
            <p className="text-sm text-earth-500">No approved volunteers yet.</p>
          ) : (
            <ul className="space-y-1">
              {people.map((p) => (
                <li key={p.name} className="flex items-center justify-between text-sm">
                  <span>{p.name}</span>
                  <span className={`text-xs flex items-center gap-1 ${p.checkedOutAt ? 'text-emerald-400' : p.checkedInAt ? 'text-amber-300' : 'text-earth-500'}`}>
                    {p.checkedOutAt ? <><CheckCircle className="w-3.5 h-3.5" /> Done</> : p.checkedInAt ? <><LogIn className="w-3.5 h-3.5" /> Here</> : 'Not yet'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
