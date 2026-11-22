import { useEffect, useState } from 'react'
import { CreditCard, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { tr } from '@/lib/i18n.js'
import { isNativeApp } from '@/lib/platform.js'

// Card payments for invoices (#899): a *Pay by card* button that opens
// Stripe's hosted checkout, and the note shown on coming back. Hidden unless
// the backend has Stripe set up, and inside the phone apps (paying for a
// school's account happens on the website).

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const token = () => localStorage.getItem('voluntrack:auth_token')

let enabledPromise = null
function cardPaymentsEnabled() {
  if (!enabledPromise) {
    enabledPromise = fetch(`${apiUrl}/invoices/card-payments`, { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => Boolean(d.enabled))
      .catch(() => false)
  }
  return enabledPromise
}

/** Whether card payments are on (false until known). */
function useCardPayments() {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let alive = true
    cardPaymentsEnabled().then((on) => { if (alive) setEnabled(on) })
    return () => { alive = false }
  }, [])
  return enabled
}

/** *Pay by card* for one open invoice; `canPay` is false for co-admins. */
export function PayByCardButton({ invoice, canPay = true }) {
  const enabled = useCardPayments()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!enabled || !canPay || isNativeApp || invoice.status !== 'sent' || !(Number(invoice.amount) > 0)) return null

  const pay = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/invoices/${encodeURIComponent(invoice.id)}/checkout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) throw new Error(data.error || tr('Could not start the card payment. Please try again.'))
      window.location.assign(data.url)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button type="button" onClick={pay} disabled={busy} className="btn-primary btn-sm inline-flex items-center gap-1.5">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <CreditCard className="w-3.5 h-3.5" aria-hidden="true" />}
        {busy ? tr('Opening secure checkout…') : tr('Pay by card')}
      </button>
      {error && <span role="alert" className="text-xs text-red-500 mt-1 max-w-[14rem] text-right">{error}</span>}
    </span>
  )
}

/**
 * The note after coming back from Stripe (`?card=paid` or `?card=cancelled`).
 * The invoice turns paid when Stripe tells our server, usually within
 * seconds, so `onPaid` re-reads the list a few times.
 */
// Read when this file loads: the dashboard tidies its address on first render,
// which can drop the query string before the invoice list has loaded.
let pendingReturn = (() => {
  try { return new URLSearchParams(window.location.search).get('card') } catch { return null }
})()

export function CardPaymentReturn({ onPaid }) {
  const [state] = useState(() => pendingReturn)
  useEffect(() => {
    pendingReturn = null
    if (!state) return undefined
    // Drop the marker so a reload doesn't show the note again.
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('card')
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    } catch { /* leave the address as it is */ }
    if (state !== 'paid' || !onPaid) return undefined
    const timers = [3000, 8000, 20000].map((ms) => setTimeout(onPaid, ms))
    return () => timers.forEach(clearTimeout)
  }, [state, onPaid])

  if (state === 'paid') {
    return (
      <div role="status" className="mb-3 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" aria-hidden="true" />
        <span>{tr('Thanks! Your card payment went through. The invoice turns to Paid within a minute.')}</span>
      </div>
    )
  }
  if (state === 'cancelled') {
    return (
      <div role="status" className="mb-3 flex items-start gap-2 rounded-xl border border-white/10 bg-earth-500/10 p-3 text-sm">
        <XCircle className="w-4 h-4 text-earth-400 shrink-0 mt-0.5" aria-hidden="true" />
        <span>{tr('Payment cancelled. Nothing was charged.')}</span>
      </div>
    )
  }
  return null
}

/** One line under the invoice list saying who handles the card. */
export function CardPaymentNote({ invoices }) {
  const enabled = useCardPayments()
  if (!enabled || isNativeApp || !invoices.some((inv) => inv.status === 'sent')) return null
  return <p className="mt-3 text-xs text-earth-400">{tr('Card payments are handled by Stripe. VolunTrack never sees your card number.')}</p>
}
