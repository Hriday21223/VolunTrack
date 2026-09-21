import { useEffect, useState } from 'react'
import { Tag } from 'lucide-react'
import { promoLabel } from '@promo'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

/**
 * The admin's current join offer, rendered wherever a school or organization
 * might be deciding whether to sign up. `GET /api/settings/promo` already
 * filters out a disabled or expired offer and returns `null`, so this renders
 * nothing at all unless something is genuinely running — including when there
 * is no backend configured.
 *
 * `audience` narrows it further for a page that only one kind of customer
 * sees: the school signup page shouldn't advertise an organizations-only deal.
 *
 * `fallback` is what to render instead when nothing is running — the landing
 * page hero puts the banner where a standing pill used to be, and that pill has
 * to come back when there is no offer rather than leaving a hole.
 */
export default function PromoBanner({ audience, className = '', compact = false, fallback = null }) {
  const [offer, setOffer] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${apiUrl}/settings/promo`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled) setOffer(data?.offer || null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!offer) return fallback
  if (audience && offer.audience !== 'both' && offer.audience !== audience) return fallback

  const endsAt = offer.endsAt
    ? new Date(`${offer.endsAt}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div className={`rounded-xl border border-brand-500/30 bg-brand-500/10 p-4 ${className}`}>
      <p className="font-display font-semibold text-sm flex items-center gap-2">
        <Tag className="w-4 h-4 text-brand-600 shrink-0" />
        <span>{offer.headline}</span>
        <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white whitespace-nowrap">
          {offer.percentOff}% off
        </span>
      </p>
      {!compact && (
        <p className="text-sm text-earth-600 dark:text-earth-300 mt-1.5">
          {offer.details || `Get ${promoLabel(offer)}.`}
        </p>
      )}
      {offer.code && (
        <p className="text-sm mt-2 flex flex-wrap items-center gap-2">
          <span className="text-earth-500 dark:text-earth-400">Code</span>
          <code className="rounded-md border border-brand-500/40 bg-brand-500/10 px-2 py-0.5 font-mono font-semibold tracking-wider">
            {offer.code}
          </code>
        </p>
      )}
      {endsAt && (
        <p className="text-xs text-earth-500 dark:text-earth-400 mt-1">Offer ends {endsAt}.</p>
      )}
    </div>
  )
}
