import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Shield, ArrowRight, Smartphone, Monitor, Scan, Camera, CameraOff } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth.jsx'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import { useSeo } from '@/hooks/useSeo.js'
import { Html5Qrcode } from 'html5-qrcode'

export default function SyncLogin() {
  useSeo({
    title: 'Sync Your Device',
    description: 'Enter your 5-digit sync PIN or scan a QR code to bring your VolunTrack account to a new device.',
    path: '/sync-login',
  })

  const { loginWithSyncPin } = useAuth()
  const nav = useNavigate()
  const [syncPin, setSyncPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [scanning, setScanning] = useState(false)
  const scannerRef = useRef(null)
  const scannerInstance = useRef(null)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    setIsMobile(mq.matches)
    const handler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    return () => {
      if (scannerInstance.current) {
        scannerInstance.current.stop().catch(() => {})
      }
    }
  }, [])

  const onSubmit = async (e) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await loginWithSyncPin(syncPin)
      setToast(true)
      setTimeout(() => nav('/', { replace: true }), 600)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const startScanning = async () => {
    setScanning(true)
    setErr('')
    try {
      const cameras = await Html5Qrcode.getCameras().catch(() => [])
      if (cameras.length === 0) {
        setErr('No camera found. Upload a QR code screenshot below.')
        return
      }
      const scanner = new Html5Qrcode('qr-reader')
      scannerInstance.current = scanner
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          scanner.stop().catch(() => {})
          scannerInstance.current = null
          setScanning(false)
          const pin = decodedText.replace(/[^0-9]/g, '').slice(0, 5)
          if (pin.length === 5) {
            setSyncPin(pin)
            setBusy(true)
            loginWithSyncPin(pin)
              .then(() => {
                setToast(true)
                setTimeout(() => nav('/', { replace: true }), 600)
              })
              .catch((e) => {
                setErr(e.message)
                setBusy(false)
              })
          } else {
            setErr('Invalid QR code — no 5-digit PIN found.')
            setBusy(false)
          }
        },
        () => {},
      )
    } catch (e) {
      setErr('Camera unavailable. Upload a QR code screenshot below.')
    }
  }

  const scanFromFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setErr('')
    setBusy(true)
    try {
      const scanner = new Html5Qrcode('qr-reader-file')
      scannerInstance.current = scanner
      const decodedText = await scanner.scanFile(file, false)
      const pin = decodedText.replace(/[^0-9]/g, '').slice(0, 5)
      if (pin.length === 5) {
        setSyncPin(pin)
        scannerInstance.current = null
        await loginWithSyncPin(pin)
        setToast(true)
        setTimeout(() => nav('/', { replace: true }), 600)
      } else {
        setErr('Invalid QR code — no 5-digit PIN found.')
        setBusy(false)
        scannerInstance.current = null
      }
    } catch (e) {
      setErr('Could not read QR code from the image. Try a clearer screenshot.')
      setBusy(false)
      scannerInstance.current = null
    }
  }

  const stopScanning = () => {
    if (scannerInstance.current) {
      scannerInstance.current.stop().catch(() => {})
      scannerInstance.current = null
    }
    setScanning(false)
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(168,85,247,0.18),transparent_24%),radial-gradient(circle_at_top_right,rgba(34,197,95,0.18),transparent_18%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.16),transparent_18%),linear-gradient(180deg,#08161b_0%,#0b1c24_45%,#0f1e16_100%)] text-white px-4 py-8">
      <div className="mx-auto max-w-md">
        <Link to="/login" className="btn-ghost mb-6 inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> Back to sign in
        </Link>

        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-slate-900/60 px-4 py-2 text-sm text-brand-100 shadow-soft backdrop-blur">
            {isMobile ? <Monitor className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
            {isMobile ? 'Laptop sync' : 'Mobile sync'}
          </div>
        </div>

        <Card padded={false} className="overflow-hidden border border-white/10 bg-slate-950/80 shadow-soft">
          <div className="bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_25%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.14),transparent_25%)] p-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-sm text-brand-200 uppercase tracking-[0.3em]">Sync your device</p>
                <h1 className="text-3xl font-bold text-white">Enter sync PIN</h1>
              </div>
              <Shield className="w-12 h-12 text-brand-400" />
            </div>

            <div id="qr-reader-file" className="hidden" />
            {scanning ? (
              <div className="space-y-4">
                <div id="qr-reader" ref={scannerRef} className="w-full overflow-hidden rounded-xl" />
                <div className="border-t border-white/10 pt-4">
                  <p className="text-xs text-slate-400 mb-2 text-center">Upload a QR code screenshot</p>
                  <label className="btn-secondary w-full flex items-center justify-center cursor-pointer">
                    <Camera className="w-4 h-4 mr-2" /> Choose QR image
                    <input type="file" accept="image/*" className="hidden" onChange={scanFromFile} />
                  </label>
                </div>
                <button onClick={stopScanning} className="btn-ghost w-full text-sm">
                  <CameraOff className="w-4 h-4 mr-2" /> Cancel
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm text-slate-300 mb-6">
                  {isMobile
                    ? 'Enter the 5-digit sync PIN from your laptop settings or scan the QR code.'
                    : 'Enter the 5-digit sync PIN from your mobile device or scan the QR code.'}
                </p>

                <form onSubmit={onSubmit} className="space-y-5">
                  <div>
                    <label className="label text-slate-300" htmlFor="syncPin">5-digit sync PIN</label>
                    <input
                      id="syncPin"
                      type="text"
                      required
                      inputMode="numeric"
                      pattern="[0-9]{5}"
                      maxLength={5}
                      className="input bg-slate-900/80 text-white border-white/10 text-center text-2xl tracking-widest font-mono"
                      placeholder="12345"
                      value={syncPin}
                      onChange={(e) => setSyncPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
                    />
                  </div>

                  <div className="flex gap-2">
                    <button type="submit" className="btn-primary flex-1 py-3 text-sm font-semibold" disabled={busy}>
                      {busy ? 'Syncing…' : <>Sync account <ArrowRight className="w-4 h-4" /></>}
                    </button>
                    <button type="button" onClick={startScanning} className="btn-secondary px-4">
                      <Scan className="w-5 h-5" />
                    </button>
                  </div>
                </form>

                {err && <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">{err}</div>}

                <div className="mt-6 text-center text-sm text-slate-400">
                  {isMobile ? 'Open on your laptop to generate a PIN.' : "Don't have the mobile app?"}{' '}
                  {!isMobile && (
                    <a href="https://github.com/Hriday21223/VolunTrack" target="_blank" rel="noopener noreferrer" className="text-sky-200 font-semibold hover:text-white">
                      Get VolunTrack mobile
                    </a>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-center gap-4 text-sm text-slate-400">
                  <Link to="/register" className="text-sky-200 font-semibold hover:text-white">Create an account</Link>
                  <span className="text-slate-600">·</span>
                  <Link to="/help" className="text-sky-200 font-semibold hover:text-white">Need help?</Link>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      <Toast open={toast} onClose={() => setToast(false)}>Account synced successfully!</Toast>
    </div>
  )
}
