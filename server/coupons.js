import { createHash } from 'crypto'

// Coupons for one named customer (#966). The admin makes a code for one school
// or organization (a long-time partner, say); only that account can use it,
// once, before an optional expiry date. Two kinds:
//  - 'percent': percent off the next invoice the admin sends (100 = free).
//    Redeeming marks it waiting; POST /api/invoices/admin applies it.
//  - 'months': that many months free, applied when redeemed (see
//    applyFreeMonths in routes/coupons.js).
// Only a hash of the code is stored: the full code leaves the server once, in
// the admin's create response. Pure, so the unit tests can load it.

export const COUPON_KINDS = ['percent', 'months']
export const MAX_FREE_MONTHS = 36

export function normalizeCoupon(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function hashCoupon(code) {
  return createHash('sha256').update(`voluntrack-coupon:${normalizeCoupon(code)}`).digest('hex')
}

export function couponHint(code) {
  return normalizeCoupon(code).slice(-4)
}

// Checks what the admin asked for. → { kind, percentOff, freeMonths, expiresAt } or { error }.
export function readCouponRequest(body, today = new Date()) {
  const kind = String(body?.kind || '')
  if (!COUPON_KINDS.includes(kind)) return { error: 'Choose percent off or free months.' }
  let percentOff = null
  let freeMonths = null
  if (kind === 'percent') {
    percentOff = Number(body.percentOff)
    if (!Number.isFinite(percentOff) || percentOff <= 0 || percentOff > 100 || Math.round(percentOff * 100) !== percentOff * 100) {
      return { error: 'Percent off must be more than 0 and at most 100.' }
    }
  } else {
    freeMonths = Number(body.freeMonths)
    if (!Number.isInteger(freeMonths) || freeMonths < 1 || freeMonths > MAX_FREE_MONTHS) {
      return { error: `Free months must be a whole number from 1 to ${MAX_FREE_MONTHS}.` }
    }
  }
  let expiresAt = null
  const raw = body.expiresAt ? String(body.expiresAt).trim() : ''
  if (raw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
      return { error: 'Enter the expiry date as YYYY-MM-DD.' }
    }
    // Valid through the end of that day (UTC); a date already over is refused.
    const end = new Date(`${raw}T23:59:59Z`)
    if (end < today) return { error: 'The expiry date has already passed.' }
    expiresAt = end.toISOString()
  }
  const note = body.note ? String(body.note).trim().slice(0, 200) : null
  return { kind, percentOff, freeMonths, expiresAt, note }
}

// What a coupon gives, in plain words for the admin and the customer.
export function couponLabel(c) {
  if (!c) return ''
  const percent = Number(c.percent_off ?? c.percentOff)
  const months = Number(c.free_months ?? c.freeMonths)
  if ((c.kind) === 'percent') return percent >= 100 ? 'Next invoice free' : `${percent}% off the next invoice`
  return `${months} month${months === 1 ? '' : 's'} free`
}
