import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { ScanLine, X } from 'lucide-react'
import { tr } from '@/lib/i18n.js'

// The task id and code from an organizer's check-in QR code
// (CheckinQrModal: <site>/checkin/<taskId>?c=<code>). Any host is accepted —
// the live site, a school's own domain or a dev server all show the same
// codes — because only the id and code are used, and the server checks both.
function parseCheckinQr(text) {
  try {
    const u = new URL(String(text).trim())
    const m = u.pathname.match(/^\/checkin\/([^/]+)\/?$/)
    const code = u.searchParams.get('c')
    if (m && code) return { taskId: decodeURIComponent(m[1]), code }
  } catch { /* not a URL */ }
  return null
}

// "Scan check-in code": scans the organizer's QR code with the camera inside
// the page (or the app), then opens the check-in page, so nobody has to leave
// the app for the phone's camera and sign in again in the browser.
export default function ScanCheckinButton({ className = 'btn-primary text-sm', label }) {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  const scanner = useRef(null)

  const stop = () => {
    const s = scanner.current
    scanner.current = null
    if (s) s.stop().then(() => s.clear()).catch(() => {})
  }

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setErr('')
    ;(async () => {
      try {
        const cameras = await Html5Qrcode.getCameras().catch(() => [])
        if (cancelled) return
        if (cameras.length === 0) { setErr(tr('No camera found. Scan the code with your phone\'s camera app instead.')); return }
        const s = new Html5Qrcode('checkin-qr-reader')
        scanner.current = s
        await s.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (text) => {
            const hit = parseCheckinQr(text)
            if (!hit) { setErr(tr('That isn\'t a VolunTrack check-in code.')); return }
            stop()
            setOpen(false)
            nav(`/checkin/${encodeURIComponent(hit.taskId)}?c=${encodeURIComponent(hit.code)}`)
          },
          () => {},
        )
        if (cancelled) stop()
      } catch {
        if (!cancelled) setErr(tr('Camera unavailable. Allow camera access, or scan the code with your phone\'s camera app.'))
      }
    })()
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => { cancelled = true; window.removeEventListener('keydown', onKey); stop() }
  }, [open, nav])

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${className} inline-flex items-center gap-1.5`}>
        <ScanLine className="w-4 h-4" /> {label || tr('Scan check-in code')}
      </button>
      {/* Portaled: the page header (backdrop-blur) would otherwise trap a fixed overlay inside it. */}
      {open && createPortal(
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/80 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-labelledby="scan-checkin-title">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0f1813] p-5 text-white shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <h2 id="scan-checkin-title" className="font-display font-semibold text-lg flex items-center gap-2">
                <ScanLine className="w-5 h-5 text-brand-400" /> {tr('Scan check-in code')}
              </h2>
              <button onClick={() => setOpen(false)} className="btn-ghost p-1" aria-label={tr('Close')}><X className="w-5 h-5" /></button>
            </div>
            <div id="checkin-qr-reader" className="mt-4 overflow-hidden rounded-xl bg-black min-h-[240px]" />
            {err && <p className="text-sm text-amber-300 mt-3" role="alert">{err}</p>}
            <p className="text-sm text-earth-400 mt-3">{tr('Point your camera at the QR code on the organizer\'s screen: once when you arrive, and again when you leave.')}</p>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
