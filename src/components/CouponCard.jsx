import { useCallback, useEffect, useState } from 'react'
import { Ticket } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { tr } from '@/lib/i18n.js'
import { fmtDate } from '@/utils/date.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

// "Have a coupon?" on a school's Billing tab and an organization's Schools tab
// (#966). A coupon is made by VolunTrack for this one account and works once.
export default function CouponCard({ className = '', onRedeemed, compact = false }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [mine, setMine] = useState([])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/coupons/mine`, { headers: auth() })
      if (res.ok) setMine((await res.json()).coupons || [])
    } catch {}
  }, [])
  useEffect(() => { load() }, [load])

  const redeem = async (e) => {
    e.preventDefault()
    if (!code.trim()) return
    setBusy(true); setError(''); setDone('')
    try {
      const res = await fetch(`${apiUrl}/coupons/redeem`, {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || tr('Could not use the coupon.')); return }
      setCode('')
      if (data.kind === 'percent') {
        setDone(data.percentOff >= 100
          ? tr('Done! Your next invoice will be free.')
          : tr('Done! Your next invoice will be {n}% off.', { n: data.percentOff }))
      } else if (data.dueDate) {
        setDone(tr('Done! {n} free months: your next payment is now due {date}.', { n: data.freeMonths, date: fmtDate(data.dueDate) }))
      } else {
        setDone(tr('Done! {n} free months: you’re paid until {date}.', { n: data.freeMonths, date: fmtDate(String(data.paidUntil).slice(0, 10)) }))
      }
      load()
      onRedeemed?.()
    } catch { setError(tr('Could not use the coupon.')) } finally { setBusy(false) }
  }

  const waiting = mine.filter((c) => c.waiting)
  // Compact: just a link until opened (the organization's first page).
  const [open, setOpen] = useState(!compact)
  const label = (c) => (c.percentOff >= 100 ? tr('a free invoice') : tr('{n}% off', { n: c.percentOff }))

  if (!open && waiting.length === 0) {
    return (
      <p className={`text-sm ${className}`}>
        <button type="button" className="text-brand-700 dark:text-brand-300 hover:underline inline-flex items-center gap-1" onClick={() => setOpen(true)}>
          <Ticket className="w-4 h-4" />{' '}{tr('Have a coupon?')}
        </button>
      </p>
    )
  }
  return (
    <Card className={className}>
      <h3 className="font-semibold text-sm flex items-center gap-2 mb-1"><Ticket className="w-4 h-4 text-brand-600" />{' '}{tr('Have a coupon?')}</h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">{tr('Enter a coupon code VolunTrack gave you.')}</p>
      {waiting.length > 0 && (
        <p className="text-sm text-brand-700 dark:text-brand-300 mb-3">{tr('Waiting for your next invoice: {what}.', { what: waiting.map(label).join(', ') })}</p>
      )}
      <form onSubmit={redeem} className="flex gap-2">
        <label htmlFor="coupon-code" className="sr-only">{tr('Coupon code')}</label>
        <input id="coupon-code" className="input flex-1 font-mono uppercase" maxLength={20} autoComplete="off" placeholder="XXXXX-XXXXX" value={code} onChange={(e) => setCode(e.target.value)} />
        <button type="submit" className="btn-primary btn-sm shrink-0" disabled={busy || !code.trim()}>{busy ? tr('Checking…') : tr('Use coupon')}</button>
      </form>
      {error && <p className="text-sm text-red-500 mt-2">{tr(error)}</p>}
      {done && <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-2">{done}</p>}
    </Card>
  )
}
