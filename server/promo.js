/**
 * The admin-defined join offer — "sign up now and get 10% off your first
 * month". One offer at a time, stored as a single `promo_offer` row in
 * `site_settings` (see server/routes/settings.js).
 *
 * This module is pure (no db, no env, no I/O) and is imported by client code
 * through the `@promo` alias (vite.config.js / jsconfig.json), because the
 * banner on the landing page, the admin's invoice preview, and
 * `POST /api/invoices/admin` — which is what actually charges the discounted
 * amount — have to agree to the cent. Two copies of this arithmetic drift, and
 * the drift shows up as a school being billed something other than the number
 * it was shown.
 */

export const PROMO_AUDIENCES = ['school', 'organization', 'both']
export const PROMO_PERIODS = ['any', 'monthly', 'yearly', 'one_time']
export const PROMO_VISIBILITIES = ['public', 'invite']

const PERIOD_NOUNS = { monthly: 'month', yearly: 'year', one_time: 'invoice' }

/** An offer that exists but is switched off — what every reader gets by default. */
export const NO_PROMO = {
  enabled: false,
  headline: '',
  details: '',
  code: '',
  percentOff: 10,
  audience: 'both',
  appliesTo: 'monthly',
  firstInvoiceOnly: true,
  maxRedemptions: null,
  endsAt: null,
  visibility: 'public',
  referral: false,
}

/** Today in the admin's own terms: a plain YYYY-MM-DD, so `endsAt` is inclusive. */
function dayStamp(now) {
  return new Date(now).toISOString().slice(0, 10)
}

/**
 * Validate and coerce an offer submitted by the admin form (or read back out of
 * site_settings, which may hold a shape written by an older version).
 * Returns `{ error }` on bad input rather than throwing — the route turns that
 * into a 400 and the client into an inline message.
 */
export function normalizePromo(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}

  const percentOff = Number(input.percentOff)
  if (!Number.isFinite(percentOff) || percentOff <= 0 || percentOff > 100) {
    return { error: 'Percent off must be between 1 and 100.' }
  }

  const audience = String(input.audience || 'both')
  if (!PROMO_AUDIENCES.includes(audience)) return { error: 'Invalid audience.' }

  const appliesTo = String(input.appliesTo || 'any')
  if (!PROMO_PERIODS.includes(appliesTo)) return { error: 'Invalid billing period.' }

  const headline = String(input.headline ?? '').trim()
  const details = String(input.details ?? '').trim()
  if (headline.length > 120) return { error: 'Headline is too long.' }
  if (details.length > 500) return { error: 'Details are too long.' }

  // A code is a label to quote, not a secret — it is printed on the public
  // banner. Uppercased and stripped so `launch10`, `LAUNCH10 ` and `Launch10`
  // are the same code, which matters because redemptions are counted by it.
  const code = String(input.code ?? '').trim().toUpperCase().replace(/\s+/g, '')
  if (code && !/^[A-Z0-9-]{3,24}$/.test(code)) {
    return { error: 'A code must be 3–24 letters, digits or dashes.' }
  }

  // null means unlimited. 0 would mean "nobody may claim this", which is what
  // switching the offer off is for, so it is rejected as a likely typo.
  const limitRaw = input.maxRedemptions
  let maxRedemptions = null
  if (limitRaw !== null && limitRaw !== undefined && String(limitRaw).trim() !== '') {
    maxRedemptions = Number(limitRaw)
    if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1) {
      return { error: 'The usage limit must be a whole number of 1 or more.' }
    }
  }
  // Counting redemptions needs something to count them by.
  if (maxRedemptions !== null && !code) return { error: 'A usage limit needs a code to count against.' }

  const visibility = String(input.visibility || 'public')
  if (!PROMO_VISIBILITIES.includes(visibility)) return { error: 'Invalid visibility.' }

  const endsAtRaw = String(input.endsAt ?? '').trim()
  if (endsAtRaw && !/^\d{4}-\d{2}-\d{2}$/.test(endsAtRaw)) return { error: 'End date must be a calendar date.' }

  const enabled = Boolean(input.enabled)
  // A live offer with no headline renders as an empty banner, so require one
  // only at the point it would actually be shown to somebody.
  if (enabled && !headline) return { error: 'An enabled offer needs a headline.' }

  return {
    offer: {
      enabled,
      headline,
      details,
      code,
      percentOff: Math.round(percentOff * 100) / 100,
      audience,
      appliesTo,
      firstInvoiceOnly: input.firstInvoiceOnly !== false,
      maxRedemptions,
      endsAt: endsAtRaw || null,
      visibility,
      referral: Boolean(input.referral),
    },
  }
}

/** Enabled and not past its end date. Says nothing about who is looking. */
export function isPromoLive(offer, now = new Date()) {
  if (!offer || !offer.enabled) return false
  if (offer.endsAt && offer.endsAt < dayStamp(now)) return false
  return true
}

/**
 * How many claims are left, or null when the offer is uncapped. Never negative:
 * an offer that somehow went over its cap reads as 0 left, not -1.
 */
export function promoRemaining(offer, redemptionsUsed = 0) {
  if (!offer || offer.maxRedemptions === null || offer.maxRedemptions === undefined) return null
  return Math.max(0, offer.maxRedemptions - Number(redemptionsUsed || 0))
}

/**
 * The offer as a public reader should see it, or null when nothing is running —
 * which includes an offer that has been fully claimed, since a banner promising
 * a discount nobody can still get is worse than no banner, and an `invite`
 * offer, which is the whole point of that setting: it is mailed to existing
 * customers to pass on, never advertised on the site.
 */
export function publicPromo(offer, redemptionsUsed = 0, now = new Date()) {
  if (!isPromoLive(offer, now)) return null
  if (offer.visibility === 'invite') return null
  // A fully-claimed offer disappears, but how many are left is never published:
  // "only 2 left" is pressure we don't put on a customer, and the raw counts
  // would leak how the campaign is going to anyone who calls the endpoint.
  // The cap stays an internal control, visible to the admin only.
  if (promoRemaining(offer, redemptionsUsed) === 0) return null
  const { enabled, maxRedemptions, ...rest } = offer
  return { ...rest, label: promoLabel(offer) }
}

/**
 * Whether this offer may be applied to one specific invoice. Returns a reason
 * when it may not, so the admin panel can say why the checkbox is unavailable
 * instead of silently hiding it.
 */
export function promoAppliesTo(offer, { entityType, billingPeriod, isFirstInvoice, redemptionsUsed = 0 } = {}, now = new Date()) {
  if (!isPromoLive(offer, now)) return { eligible: false, reason: 'No offer is running.' }
  if (offer.audience !== 'both' && offer.audience !== entityType) {
    return { eligible: false, reason: `This offer is for ${offer.audience === 'school' ? 'schools' : 'organizations'} only.` }
  }
  if (offer.appliesTo !== 'any' && billingPeriod && offer.appliesTo !== billingPeriod) {
    return { eligible: false, reason: `This offer only applies to ${offer.appliesTo.replace('_', '-')} billing.` }
  }
  if (offer.firstInvoiceOnly && isFirstInvoice === false) {
    return { eligible: false, reason: 'This account has already been invoiced.' }
  }
  if (promoRemaining(offer, redemptionsUsed) === 0) {
    const reason = offer.maxRedemptions === 1
      ? 'The single use of this code has been claimed.'
      : `All ${offer.maxRedemptions} uses of this code have been claimed.`
    return { eligible: false, reason }
  }
  return { eligible: true, reason: null }
}

/** Split a pre-discount amount into what is taken off and what is owed. */
export function applyPromoAmount(subtotal, percentOff) {
  const base = Math.round(Number(subtotal) * 100) / 100
  const discount = Math.round(base * Number(percentOff)) / 100
  return { subtotal: base, discountAmount: discount, total: Math.round((base - discount) * 100) / 100 }
}

/** "10% off your first month" — the one-liner used on banners and invoices. */
export function promoLabel(offer) {
  if (!offer) return ''
  const pct = `${offer.percentOff}% off`
  const noun = PERIOD_NOUNS[offer.appliesTo] || 'invoice'
  if (offer.firstInvoiceOnly) return `${pct} your first ${noun}`
  return offer.appliesTo === 'any' ? pct : `${pct} every ${noun}`
}
