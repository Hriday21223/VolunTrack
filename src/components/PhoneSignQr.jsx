import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { CheckCircle2, Loader2, Smartphone } from 'lucide-react'
import { isNativeApp } from '@/lib/platform.js'
import { startCertificateSign, certificateSignStatus } from '@/lib/requirements.js'

const SITE = ((isNativeApp && import.meta.env.VITE_SITE_URL) || window.location.origin).replace(/\/$/, '')
const POLL_MS = 2000

// "Sign on your phone" for the certificate signature (#548): shows a QR code
// for a one-time link, then waits for the phone to send the drawn signature
// back and hands it to onSigned. Saving the settings is still up to the admin.
export default function PhoneSignQr({ signerName, onSigned }) {
  const [state, setState] = useState({ status: 'idle', token: '', error: '' })
  const canvasRef = useRef(null)
  // The parent's callback changes every render; polling shouldn't restart with it.
  const onSignedRef = useRef(onSigned)
  useEffect(() => { onSignedRef.current = onSigned }, [onSigned])
  const url = state.token ? `${SITE}${import.meta.env.BASE_URL}sign-certificate/${state.token}` : ''

  const start = async () => {
    setState({ status: 'loading', token: '', error: '' })
    try {
      const { token } = await startCertificateSign(signerName)
      setState({ status: 'waiting', token, error: '' })
    } catch (e) {
      setState({ status: 'idle', token: '', error: e.message })
    }
  }

  useEffect(() => {
    if (url && canvasRef.current) QRCode.toCanvas(canvasRef.current, url, { width: 220, margin: 2 }, () => {})
  }, [url])

  useEffect(() => {
    if (state.status !== 'waiting') return undefined
    let stopped = false
    let timer
    const tick = async () => {
      try {
        const s = await certificateSignStatus(state.token)
        if (stopped) return
        if (s.signed) {
          onSignedRef.current(s.signatureImage)
          setState((st) => ({ ...st, status: 'done' }))
          return
        }
        if (s.expired) {
          setState({ status: 'idle', token: '', error: 'That QR code expired. Make a new one.' })
          return
        }
      } catch { /* a missed poll is retried */ }
      if (!stopped) timer = setTimeout(tick, POLL_MS)
    }
    timer = setTimeout(tick, POLL_MS)
    return () => { stopped = true; clearTimeout(timer) }
  }, [state.status, state.token])

  if (state.status === 'done') {
    return (
      <p className="flex items-center gap-2 text-sm text-brand-600 dark:text-brand-400">
        <CheckCircle2 className="w-4 h-4" /> Signature received from the phone. Press Save requirements to keep it.
      </p>
    )
  }

  if (state.status === 'waiting') {
    return (
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-earth-200 dark:border-earth-700 p-3">
        <canvas ref={canvasRef} className="rounded-lg bg-white" aria-label="QR code to sign on a phone" />
        <div className="text-sm space-y-2 max-w-xs">
          <p className="font-medium">Scan with the signer’s phone camera</p>
          <p className="text-xs text-earth-500 dark:text-earth-400">They sign with a finger and tap Done. The signature shows up here by itself. The code works once, for 15 minutes.</p>
          <p className="flex items-center gap-2 text-xs text-earth-500 dark:text-earth-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Waiting for the signature…</p>
          <button type="button" className="btn-sm btn-ghost" onClick={() => setState({ status: 'idle', token: '', error: '' })}>Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <button type="button" className="btn-sm btn-secondary" onClick={start} disabled={state.status === 'loading'}>
        {state.status === 'loading' ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Smartphone className="w-3.5 h-3.5 mr-1" />}
        Sign on your phone instead
      </button>
      {state.error && <p className="mt-1 text-xs text-red-500">{state.error}</p>}
    </div>
  )
}
