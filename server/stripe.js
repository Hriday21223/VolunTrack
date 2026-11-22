// Card payments for invoices through Stripe Checkout (#899). No SDK: one
// form-encoded POST makes a Checkout Session, and webhooks are checked with
// Stripe's documented signature scheme (HMAC-SHA256 over "t.body").
//
// Off until both STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set: without
// the webhook secret a payment could never be recorded, so the button stays
// hidden. Card numbers never reach VolunTrack; Stripe's hosted page takes
// them, and the webhook only tells us the invoice was paid.
import crypto from 'node:crypto'

export const STRIPE_API = 'https://api.stripe.com/v1'
export const SIGNATURE_TOLERANCE_SECONDS = 300

export function stripeEnabled(env = process.env) {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET)
}

/** Dollars (number or numeric string) to whole cents, or null when not payable. */
export function toCents(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100)
}

/**
 * The form fields for POST /v1/checkout/sessions. Pure, so it can be tested.
 * The invoice id travels in both client_reference_id and metadata; the
 * webhook trusts neither on its own and re-reads the invoice by id.
 */
export function checkoutParams({ invoice, entityName, email, successUrl, cancelUrl }) {
  const cents = toCents(invoice.amount)
  if (!cents) throw new Error('Invoice has nothing to pay.')
  const name = `VolunTrack invoice ${invoice.invoice_number}`
  const description = [entityName, invoice.description].filter(Boolean).join(' · ').slice(0, 500)
  const p = new URLSearchParams()
  p.set('mode', 'payment')
  p.set('success_url', successUrl)
  p.set('cancel_url', cancelUrl)
  p.set('client_reference_id', invoice.id)
  p.set('metadata[invoice_id]', invoice.id)
  p.set('payment_intent_data[metadata][invoice_id]', invoice.id)
  p.set('payment_intent_data[description]', name)
  p.set('line_items[0][quantity]', '1')
  p.set('line_items[0][price_data][currency]', 'usd')
  p.set('line_items[0][price_data][unit_amount]', String(cents))
  p.set('line_items[0][price_data][product_data][name]', name)
  if (description) p.set('line_items[0][price_data][product_data][description]', description)
  if (email) p.set('customer_email', email)
  // A checkout link left open in a tab stops working after an hour, so a
  // stale tab can't pay an invoice that was voided or changed since.
  p.set('expires_at', String(Math.floor(Date.now() / 1000) + 60 * 60))
  return p
}

/** Makes a Checkout Session; resolves to { id, url } or throws. */
export async function createCheckoutSession(params, env = process.env) {
  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.url) {
    throw new Error(`Stripe checkout failed (${res.status}): ${data?.error?.message || 'no url'}`)
  }
  return { id: data.id, url: data.url }
}

/**
 * Checks a `Stripe-Signature` header ("t=…,v1=…[,v1=…]") against the raw body.
 * True only for a v1 signature made with `secret` within the tolerance.
 */
export function verifyStripeSignature(rawBody, header, secret, nowSeconds = Math.floor(Date.now() / 1000), tolerance = SIGNATURE_TOLERANCE_SECONDS) {
  if (!rawBody || !header || !secret) return false
  let t = null
  const sigs = []
  for (const part of String(header).split(',')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k === 't') t = v
    else if (k === 'v1') sigs.push(v)
  }
  if (!t || !/^\d+$/.test(t) || sigs.length === 0) return false
  if (Math.abs(nowSeconds - Number(t)) > tolerance) return false
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody)
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
  const want = Buffer.from(expected, 'hex')
  return sigs.some((s) => {
    if (!/^[0-9a-f]+$/i.test(s) || s.length !== expected.length) return false
    return crypto.timingSafeEqual(Buffer.from(s, 'hex'), want)
  })
}

/**
 * From a verified webhook event, the paid checkout it reports, or null.
 * Only completed sessions that are actually paid count (bank-debit methods
 * finish later, through async_payment_succeeded).
 */
export function paidCheckout(event) {
  const type = event?.type
  if (type !== 'checkout.session.completed' && type !== 'checkout.session.async_payment_succeeded') return null
  const s = event.data?.object
  if (!s || s.object !== 'checkout.session' || s.payment_status !== 'paid') return null
  const invoiceId = s.metadata?.invoice_id || s.client_reference_id
  if (!invoiceId) return null
  return {
    invoiceId: String(invoiceId),
    sessionId: String(s.id || ''),
    amountCents: Number(s.amount_total),
    currency: String(s.currency || '').toLowerCase(),
  }
}
