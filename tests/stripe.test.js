// Card payments (#899): the checkout fields we send Stripe, and the webhook
// signature check that decides whether an invoice gets marked paid.
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { stripeEnabled, toCents, checkoutParams, verifyStripeSignature, paidCheckout } from '../server/stripe.js'

const sign = (body, secret, t) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`

test('off unless both keys are set', () => {
  assert.equal(stripeEnabled({}), false)
  assert.equal(stripeEnabled({ STRIPE_SECRET_KEY: 'sk_test_x' }), false)
  assert.equal(stripeEnabled({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }), true)
})

test('amounts become whole cents', () => {
  assert.equal(toCents('720.00'), 72000)
  assert.equal(toCents(19.99), 1999)
  assert.equal(toCents(0.1 + 0.2), 30)
  assert.equal(toCents(0), null)
  assert.equal(toCents('abc'), null)
})

test('checkout carries the invoice id, amount and return links', () => {
  const p = checkoutParams({
    invoice: { id: 'inv_1', invoice_number: 'VT-0007', amount: '720.00', description: '8 schools × $90.00' },
    entityName: 'Coppell ISD', email: 'pay@example.org',
    successUrl: 'https://app/ok', cancelUrl: 'https://app/no',
  })
  assert.equal(p.get('mode'), 'payment')
  assert.equal(p.get('client_reference_id'), 'inv_1')
  assert.equal(p.get('metadata[invoice_id]'), 'inv_1')
  assert.equal(p.get('line_items[0][price_data][unit_amount]'), '72000')
  assert.equal(p.get('line_items[0][price_data][currency]'), 'usd')
  assert.match(p.get('line_items[0][price_data][product_data][name]'), /VT-0007/)
  assert.equal(p.get('customer_email'), 'pay@example.org')
  assert.equal(p.get('success_url'), 'https://app/ok')
  assert.ok(Number(p.get('expires_at')) > Date.now() / 1000)
  assert.throws(() => checkoutParams({ invoice: { id: 'x', invoice_number: 'n', amount: 0 }, successUrl: 'a', cancelUrl: 'b' }))
})

test('webhook signatures', () => {
  const body = JSON.stringify({ id: 'evt_1' })
  const now = 1_800_000_000
  assert.equal(verifyStripeSignature(body, sign(body, 'whsec_a', now), 'whsec_a', now), true)
  assert.equal(verifyStripeSignature(Buffer.from(body), sign(body, 'whsec_a', now), 'whsec_a', now), true)
  // wrong secret, changed body, too old, missing parts
  assert.equal(verifyStripeSignature(body, sign(body, 'whsec_b', now), 'whsec_a', now), false)
  assert.equal(verifyStripeSignature(body + ' ', sign(body, 'whsec_a', now), 'whsec_a', now), false)
  assert.equal(verifyStripeSignature(body, sign(body, 'whsec_a', now - 301), 'whsec_a', now), false)
  assert.equal(verifyStripeSignature(body, `t=${now}`, 'whsec_a', now), false)
  assert.equal(verifyStripeSignature(body, 'v1=abc', 'whsec_a', now), false)
  assert.equal(verifyStripeSignature(body, sign(body, 'whsec_a', now), '', now), false)
  // one good signature among several (Stripe sends two while a secret rolls)
  const good = sign(body, 'whsec_a', now).split(',')[1]
  assert.equal(verifyStripeSignature(body, `t=${now},v1=${'0'.repeat(64)},${good}`, 'whsec_a', now), true)
})

test('only paid checkout sessions count', () => {
  const session = { object: 'checkout.session', id: 'cs_1', payment_status: 'paid', amount_total: 72000, currency: 'usd', metadata: { invoice_id: 'inv_1' } }
  assert.deepEqual(paidCheckout({ type: 'checkout.session.completed', data: { object: session } }), { invoiceId: 'inv_1', sessionId: 'cs_1', amountCents: 72000, currency: 'usd' })
  assert.equal(paidCheckout({ type: 'checkout.session.completed', data: { object: { ...session, payment_status: 'unpaid' } } }), null)
  assert.equal(paidCheckout({ type: 'checkout.session.expired', data: { object: session } }), null)
  assert.equal(paidCheckout({ type: 'checkout.session.async_payment_succeeded', data: { object: session } })?.invoiceId, 'inv_1')
  assert.equal(paidCheckout({ type: 'checkout.session.completed', data: { object: { ...session, metadata: {}, client_reference_id: 'inv_2' } } })?.invoiceId, 'inv_2')
})
