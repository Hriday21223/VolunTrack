// Billing: the promo math and eligibility rules that the invoice preview and
// POST /api/invoices/admin both run through applyPromoAmount / promoAppliesTo.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  normalizePromo, applyPromoAmount, promoAppliesTo, isPromoLive, publicPromo,
} = await import('../server/promo.js')

// A valid, enabled offer to build cases from.
const baseOffer = (over = {}) => {
  const { offer, error } = normalizePromo({
    enabled: true, headline: '10% off your first month', percentOff: 10,
    audience: 'both', appliesTo: 'any', ...over,
  })
  assert.equal(error, undefined, error)
  return offer
}

test('applyPromoAmount splits an amount and rounds to cents', () => {
  assert.deepEqual(applyPromoAmount(250, 10), { subtotal: 250, discountAmount: 25, total: 225 })
  // 99.99 at 15% = 14.9985 → 15.00 off, 84.99 owed.
  const r = applyPromoAmount(99.99, 15)
  assert.equal(r.discountAmount, 15)
  assert.equal(r.total, 84.99)
})

test('0% leaves the amount whole; 100% clears it', () => {
  assert.deepEqual(applyPromoAmount(120, 0), { subtotal: 120, discountAmount: 0, total: 120 })
  assert.deepEqual(applyPromoAmount(120, 100), { subtotal: 120, discountAmount: 120, total: 0 })
})

test('normalizePromo rejects an out-of-range percent', () => {
  assert.ok(normalizePromo({ percentOff: 0 }).error)
  assert.ok(normalizePromo({ percentOff: 150 }).error)
})

test('a usage limit requires a code to count against', () => {
  assert.ok(normalizePromo({ enabled: true, headline: 'x', percentOff: 10, maxRedemptions: 5 }).error)
  assert.equal(normalizePromo({ enabled: true, headline: 'x', percentOff: 10, maxRedemptions: 5, code: 'LAUNCH5' }).error, undefined)
})

test('an offer past its end date is not live', () => {
  const offer = baseOffer({ endsAt: '2026-01-01' })
  assert.equal(isPromoLive(offer, new Date('2026-06-01T00:00:00Z')), false)
  assert.equal(isPromoLive(offer, new Date('2025-12-01T00:00:00Z')), true)
})

test('audience gates who the offer applies to', () => {
  const schoolsOnly = baseOffer({ audience: 'school' })
  assert.equal(promoAppliesTo(schoolsOnly, { entityType: 'school' }).eligible, true)
  const org = promoAppliesTo(schoolsOnly, { entityType: 'organization' })
  assert.equal(org.eligible, false)
  assert.match(org.reason, /schools only/)
})

test('a first-invoice-only offer is refused on a later invoice', () => {
  const offer = baseOffer({ firstInvoiceOnly: true })
  assert.equal(promoAppliesTo(offer, { entityType: 'school', isFirstInvoice: true }).eligible, true)
  assert.equal(promoAppliesTo(offer, { entityType: 'school', isFirstInvoice: false }).eligible, false)
})

test('a fully-claimed capped offer is refused', () => {
  const offer = baseOffer({ code: 'ONCE', maxRedemptions: 1 })
  assert.equal(promoAppliesTo(offer, { entityType: 'school', redemptionsUsed: 0 }).eligible, true)
  assert.equal(promoAppliesTo(offer, { entityType: 'school', redemptionsUsed: 1 }).eligible, false)
})

test('publicPromo hides invite-only and fully-claimed offers', () => {
  assert.equal(publicPromo(baseOffer({ visibility: 'invite' })), null)
  assert.equal(publicPromo(baseOffer({ code: 'ONCE', maxRedemptions: 1 }), 1), null)
  const live = publicPromo(baseOffer())
  assert.ok(live && live.percentOff === 10)
  assert.equal(live.enabled, undefined, 'internal fields are stripped from the public view')
})

// An organization pays for its schools (#962).
test('a school in an organization follows the organization’s payment', async () => {
  const { schoolIsActive } = await import('../server/schoolActive.js')
  // No organization: a club is free, a school plan must pay.
  assert.equal(schoolIsActive({ plan: 'club', payment_status: 'unpaid', organization_id: null }), true)
  assert.equal(schoolIsActive({ plan: 'school', payment_status: 'unpaid', organization_id: null }), false)
  assert.equal(schoolIsActive({ plan: 'school', payment_status: 'paid', organization_id: null }), true)
  // In an organization: only the organization's payment counts, clubs too.
  assert.equal(schoolIsActive({ plan: 'club', payment_status: 'unpaid', organization_id: 'org1', org_payment_status: 'unpaid' }), false)
  assert.equal(schoolIsActive({ plan: 'school', payment_status: 'paid', organization_id: 'org1', org_payment_status: 'unpaid' }), false)
  assert.equal(schoolIsActive({ plan: 'school', payment_status: 'unpaid', organization_id: 'org1', org_payment_status: 'paid' }), true)
  assert.equal(schoolIsActive(null), false)
})

test('the app shows the matching lock', async () => {
  const { schoolLock } = await import('../src/lib/schoolLock.js')
  assert.equal(schoolLock({ schoolId: 's', schoolPlan: 'club', schoolPaymentStatus: 'unpaid', schoolOrgPaymentStatus: null }), null)
  assert.equal(schoolLock({ schoolId: 's', schoolPlan: 'school', schoolPaymentStatus: 'unpaid', schoolOrgPaymentStatus: null }), 'school')
  assert.equal(schoolLock({ schoolId: 's', schoolPlan: 'club', schoolPaymentStatus: 'unpaid', schoolOrgPaymentStatus: 'unpaid' }), 'organization')
  assert.equal(schoolLock({ schoolId: 's', schoolPlan: 'school', schoolPaymentStatus: 'unpaid', schoolOrgPaymentStatus: 'paid' }), null)
  assert.equal(schoolLock({ schoolId: null }), null)
})

// Coupons for one named customer (#966).
test('coupon requests are checked before a code is made', async () => {
  const { readCouponRequest, normalizeCoupon, hashCoupon, couponLabel } = await import('../server/coupons.js')
  const now = new Date('2026-11-22T12:00:00Z')
  assert.equal(readCouponRequest({ kind: 'percent', percentOff: 100 }, now).percentOff, 100)
  assert.equal(readCouponRequest({ kind: 'months', freeMonths: 3 }, now).freeMonths, 3)
  assert.ok(readCouponRequest({ kind: 'percent', percentOff: 0 }, now).error)
  assert.ok(readCouponRequest({ kind: 'percent', percentOff: 101 }, now).error)
  assert.ok(readCouponRequest({ kind: 'months', freeMonths: 0 }, now).error)
  assert.ok(readCouponRequest({ kind: 'months', freeMonths: 2.5 }, now).error)
  assert.ok(readCouponRequest({ kind: 'gift' }, now).error)
  assert.ok(readCouponRequest({ kind: 'percent', percentOff: 10, expiresAt: '2026-11-01' }, now).error)
  assert.equal(readCouponRequest({ kind: 'percent', percentOff: 10, expiresAt: '2026-12-31' }, now).expiresAt, '2026-12-31T23:59:59.000Z')
  assert.equal(readCouponRequest({ kind: 'percent', percentOff: 10 }, now).expiresAt, null)
  // Typed with spaces, dashes or lower case, it's the same code.
  assert.equal(normalizeCoupon('abcde-fgh2j '), 'ABCDEFGH2J')
  assert.equal(hashCoupon('abcde-fgh2j'), hashCoupon('ABCDEFGH2J'))
  assert.equal(couponLabel({ kind: 'percent', percent_off: '100.00' }), 'Next invoice free')
  assert.equal(couponLabel({ kind: 'months', free_months: 1 }), '1 month free')
})

// Fee lines and tax on an invoice (#968).
test('fees are added after the discount and taxed with the price', async () => {
  const { readCharges, invoiceCharges } = await import('../server/promo.js')
  const asked = readCharges([{ label: 'Sign-up fee', amount: '50' }, { label: '', amount: '' }], '8.25')
  assert.deepEqual(asked, { fees: [{ label: 'Sign-up fee', amount: 50 }], taxPercent: 8.25 })
  // $500 with 10% off = $450, + $50 fee = $500, + 8.25% tax = $41.25 → $541.25
  const c = invoiceCharges(450, asked.fees, asked.taxPercent)
  assert.equal(c.feesTotal, 50)
  assert.equal(c.taxAmount, 41.25)
  assert.equal(c.total, 541.25)
  assert.equal(invoiceCharges(100, [], null).total, 100)
  assert.ok(readCharges([{ label: 'Fee', amount: -5 }]).error)
  assert.ok(readCharges([{ label: '', amount: 5 }]).error)
  assert.ok(readCharges([], '120').error)
  assert.equal(readCharges([], '0').taxPercent, null)
  assert.ok(readCharges(Array.from({ length: 11 }, () => ({ label: 'x', amount: 1 }))).error)
})
