import { useEffect, useState } from 'react'
import { Gift, Copy, Check } from 'lucide-react'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

/**
 * A customer's own referral code, who has joined with it, and any credit they
 * have earned and not yet spent.
 *
 * The code is permanent, so it is shown whenever the server returns one; the
 * *terms* ("you both get 10% off") only appear while a referral offer is
 * actually running, because otherwise the card would be promising a discount
 * nobody is currently offering. With no offer and no history, it renders
 * nothing — a school that has never referred anyone doesn't need the card.
 */
export default function ReferralCard({ className = '' }) {
  const [data, setData] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('voluntrack:auth_token')
    if (!token) return
    let cancelled = false
    fetch(`${apiUrl}/referral/mine`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!data?.code) return null
  const { offer, referrals = [], credits = [] } = data
  if (!offer && referrals.length === 0 && credits.length === 0) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked — the code is on screen to copy by hand */ }
  }

  const joined = referrals.filter((r) => r.status !== 'pending').length

  return (
    <div className={`rounded-xl border border-brand-500/30 bg-brand-500/10 p-4 ${className}`}>
      <p className="font-display font-semibold text-sm flex items-center gap-2">
        <Gift className="w-4 h-4 text-brand-600 shrink-0" />
        {offer ? offer.headline : 'Your referral code'}
      </p>
      {offer && (
        <p className="text-sm text-earth-600 dark:text-earth-300 mt-1.5">
          Invite another school or organization — you both get {offer.percentOff}% off.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="rounded-md border border-brand-500/40 bg-brand-500/10 px-2.5 py-1 font-mono font-semibold tracking-wider">
          {data.code}
        </code>
        <button type="button" onClick={copy} className="btn-ghost btn-sm inline-flex items-center gap-1.5">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {referrals.length > 0 && (
        <p className="text-xs text-earth-500 dark:text-earth-400 mt-2">
          {joined > 0
            ? `${joined} ${joined === 1 ? 'customer has' : 'customers have'} joined with your code.`
            : `${referrals.length} signed up with your code — your discount lands once they're invoiced.`}
        </p>
      )}

      {credits.length > 0 && (
        <div className="mt-3 rounded-lg bg-brand-500/10 p-2.5">
          <p className="text-sm font-medium">
            {credits.length === 1 ? '1 discount waiting' : `${credits.length} discounts waiting`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {credits.map((c) => (
              <li key={c.id} className="text-xs text-earth-600 dark:text-earth-300">
                {Number(c.percent_off)}% off — for referring {c.referred_name || 'a new customer'}
              </li>
            ))}
          </ul>
          <p className="text-xs text-earth-500 dark:text-earth-400 mt-1.5">Applied to your next invoice.</p>
        </div>
      )}
    </div>
  )
}
