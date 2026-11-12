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
