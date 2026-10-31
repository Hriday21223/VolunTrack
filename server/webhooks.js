// Webhooks (#622, part 3): VolunTrack calls a school's, organization's or
// organizer's own https address when something happens, so their systems
// don't have to poll the API.
//
// Safety:
//  - The address is customer-supplied and our server connects to it, so it is
//    an SSRF vector. On save: https only, a public hostname, no IP literals or
//    internal names. On every delivery: we resolve the name ourselves and
//    refuse private, loopback, link-local and other non-public addresses at
//    connection time (safeLookup), which also defeats DNS rebinding. Redirects
//    are never followed.
//  - Each delivery is signed: VolunTrack-Signature: t=<unix>,v1=<hex HMAC-SHA256
//    of "<t>.<body>">, with the endpoint's own secret (shown once, stored
//    encrypted with server/secrets.js).
//  - Payloads carry ids and the fields the API would show, never a log's
//    reflection, skills, notes or proof, and no student under 13 still waiting
//    for a parent.
//
// Delivery: queued in webhook_deliveries and sent at once, then retried after
// 1 min, 10 min, 1 h, 6 h and 24 h by an in-process worker (startWebhookWorker).
// An endpoint failing for 3 days straight is switched off and its owner emailed.
import crypto from 'node:crypto'
import dns from 'node:dns'
import https from 'node:https'
import net from 'node:net'
import validator from 'validator'
import { query, hasDatabase } from './db.js'
import { uid } from './ids.js'
import { encryptSecret, decryptSecret, hasEncryptionKey } from './secrets.js'
import { sendEmail, emailFooterHtml } from './email.js'
import { escapeHtml } from './html.js'

export const WEBHOOK_EVENTS = {
  school: ['hours.created', 'hours.approved', 'hours.rejected', 'student.joined', 'student.left', 'requirement.met'],
  organization: ['hours.created', 'hours.approved', 'hours.rejected', 'student.joined', 'student.left', 'requirement.met'],
  organizer: ['event.signup', 'event.attendance'],
}
export const MAX_ENDPOINTS_PER_OWNER = 5
const RETRY_DELAYS_MIN = [1, 10, 60, 360, 1440]
const DISABLE_AFTER_HOURS = 72
const TIMEOUT_MS = 10_000

export class WebhookError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

// --- Address checks ---------------------------------------------------------

/** The cleaned https URL, or a WebhookError. */
export function cleanWebhookUrl(raw) {
  let url
  try { url = new URL(String(raw || '').trim()) } catch { throw new WebhookError('Enter the full address, starting with https://') }
  if (url.protocol !== 'https:') throw new WebhookError('The address must start with https://')
  if (url.username || url.password) throw new WebhookError('Leave the user name and password out of the address.')
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (validator.isIP(host)) throw new WebhookError('Use a hostname, not an IP address.')
  if (host === 'localhost' || /\.(local|internal|localhost|lan|home|corp)$/.test(host) || !host.includes('.')) {
    throw new WebhookError('That address isn’t a public website.')
  }
  if (url.port && url.port !== '443') throw new WebhookError('Use the standard https port (443).')
  if (url.href.length > 500) throw new WebhookError('That address is too long.')
  url.hash = ''
  return url.href
}

/** Whether an IP is somewhere a webhook may never reach. */
export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0)
      || (a === 198 && (b === 18 || b === 19)) || a >= 224
  }
  const v = ip.toLowerCase()
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7))
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9')
    || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff') || v.startsWith('64:ff9b') || v.startsWith('2001:db8')
}

// A dns.lookup that refuses non-public answers, used as the socket's lookup,
// so the address we check is the address we connect to.
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err)
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options?.family || 4 }]
    const bad = list.find((a) => isPrivateAddress(a.address))
    if (bad || list.length === 0) return callback(Object.assign(new Error('That address points to a private network.'), { code: 'EPRIVATE' }))
    if (options?.all) return callback(null, list)
    return callback(null, list[0].address, list[0].family)
  })
}

// --- Signing and sending ------------------------------------------------------

export function signatureHeader(secret, body, t = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
  return `t=${t},v1=${v1}`
}

/** POSTs one body. Resolves { ok, status, error } and never throws. */
export function postSigned(url, secret, { body, event, deliveryId }) {
  return new Promise((resolve) => {
    let u
    try { u = new URL(url) } catch { return resolve({ ok: false, status: 0, error: 'Bad address.' }) }
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: `${u.pathname}${u.search}`,
      method: 'POST',
      lookup: safeLookup,
      timeout: TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'VolunTrack-Webhooks/1',
        'VolunTrack-Event': event,
        'VolunTrack-Delivery': deliveryId,
        'VolunTrack-Signature': signatureHeader(secret, body),
      },
    }, (res) => {
      res.resume() // read and drop the body; redirects are not followed
      const ok = res.statusCode >= 200 && res.statusCode < 300
      resolve({ ok, status: res.statusCode, error: ok ? null : `HTTP ${res.statusCode}` })
    })
    req.on('timeout', () => { req.destroy(new Error('Timed out after 10 seconds.')) })
    req.on('error', (e) => resolve({ ok: false, status: 0, error: e.code === 'EPRIVATE' ? e.message : (e.message || 'Could not connect.').slice(0, 200) }))
    req.end(body)
  })
}

// --- Endpoints ----------------------------------------------------------------

const endpointOut = (r) => ({
  id: r.id, url: r.url, events: r.events, active: r.active, createdAt: r.created_at,
  disabledAt: r.disabled_at, failingSince: r.failing_since,
})

export async function listEndpoints({ ownerType, ownerId }) {
  const { rows } = await query('SELECT * FROM webhook_endpoints WHERE owner_type = $1 AND owner_id = $2 ORDER BY created_at', [ownerType, ownerId])
  return rows.map(endpointOut)
}

function cleanEvents(ownerType, events) {
  const allowed = WEBHOOK_EVENTS[ownerType] || []
  const list = [...new Set(Array.isArray(events) ? events : [])]
  if (list.length === 0) throw new WebhookError('Pick at least one event.')
  const bad = list.filter((e) => !allowed.includes(e))
  if (bad.length) throw new WebhookError(`This account can’t subscribe to: ${bad.join(', ')}.`)
  return list
}

/** Returns { endpoint, secret }; the secret is shown once. */
export async function createEndpoint(owner, createdBy, { url, events }) {
  if (!hasEncryptionKey()) throw new WebhookError('Webhooks aren’t available on this server yet.', 503)
  const clean = cleanWebhookUrl(url)
  const list = cleanEvents(owner.ownerType, events)
  const { rows: n } = await query('SELECT COUNT(*)::int AS n FROM webhook_endpoints WHERE owner_type = $1 AND owner_id = $2', [owner.ownerType, owner.ownerId])
  if (n[0].n >= MAX_ENDPOINTS_PER_OWNER) throw new WebhookError(`You can have up to ${MAX_ENDPOINTS_PER_OWNER} webhook addresses.`)
  const secret = `whsec_${crypto.randomBytes(24).toString('base64url')}`
  const { rows } = await query(
    `INSERT INTO webhook_endpoints (id, owner_type, owner_id, url, events, secret_enc, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [uid('whk'), owner.ownerType, owner.ownerId, clean, list, encryptSecret(secret), createdBy],
  )
  return { endpoint: endpointOut(rows[0]), secret }
}

export async function updateEndpoint(owner, id, { events, active }) {
  const { rows } = await query('SELECT * FROM webhook_endpoints WHERE id = $1 AND owner_type = $2 AND owner_id = $3', [id, owner.ownerType, owner.ownerId])
  if (!rows[0]) throw new WebhookError('Webhook not found.', 404)
  const nextEvents = events !== undefined ? cleanEvents(owner.ownerType, events) : rows[0].events
  if (active !== undefined && typeof active !== 'boolean') throw new WebhookError('active must be true or false.')
  const turnOn = active === true && !rows[0].active
  const { rows: out } = await query(
    `UPDATE webhook_endpoints SET events = $2, active = COALESCE($3, active),
            disabled_at = CASE WHEN $4 THEN NULL WHEN $3 = false THEN now() ELSE disabled_at END,
            failing_since = CASE WHEN $4 THEN NULL ELSE failing_since END
      WHERE id = $1 RETURNING *`,
    [id, nextEvents, active ?? null, turnOn],
  )
  return endpointOut(out[0])
}

export async function deleteEndpoint(owner, id) {
  const { rowCount } = await query('DELETE FROM webhook_endpoints WHERE id = $1 AND owner_type = $2 AND owner_id = $3', [id, owner.ownerType, owner.ownerId])
  if (!rowCount) throw new WebhookError('Webhook not found.', 404)
}

export async function listDeliveries(owner, endpointId) {
  const { rows: e } = await query('SELECT 1 FROM webhook_endpoints WHERE id = $1 AND owner_type = $2 AND owner_id = $3', [endpointId, owner.ownerType, owner.ownerId])
  if (!e[0]) throw new WebhookError('Webhook not found.', 404)
  const { rows } = await query(
    `SELECT id, event, status, attempts, last_status_code, last_error, created_at, delivered_at, next_attempt_at
       FROM webhook_deliveries WHERE endpoint_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [endpointId],
  )
  return rows.map((r) => ({
    id: r.id, event: r.event, status: r.status, attempts: r.attempts, responseCode: r.last_status_code,
    error: r.last_error, createdAt: r.created_at, deliveredAt: r.delivered_at, nextAttemptAt: r.next_attempt_at,
  }))
}

// --- Queue and worker -----------------------------------------------------------

async function attempt(deliveryId) {
  const { rows } = await query(
    `SELECT d.*, e.url, e.secret_enc, e.active, e.failing_since, e.id AS endpoint_id
       FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id
      WHERE d.id = $1 AND d.status = 'pending'`,
    [deliveryId],
  )
  const d = rows[0]
  if (!d) return null
  if (!d.active) {
    await query("UPDATE webhook_deliveries SET status = 'failed', last_error = 'Webhook is turned off.', next_attempt_at = NULL WHERE id = $1", [d.id])
    return { ok: false }
  }
  let secret
  try { secret = decryptSecret(d.secret_enc) } catch {
    await query("UPDATE webhook_deliveries SET status = 'failed', last_error = 'Signing secret unavailable.', next_attempt_at = NULL WHERE id = $1", [d.id])
    return { ok: false }
  }
  const body = JSON.stringify({ id: d.id, type: d.event, createdAt: d.created_at, data: d.payload })
  const r = await postSigned(d.url, secret, { body, event: d.event, deliveryId: d.id })
  const attempts = d.attempts + 1
  if (r.ok) {
    await query(
      `UPDATE webhook_deliveries SET status = 'delivered', attempts = $2, last_status_code = $3, last_error = NULL,
              delivered_at = now(), next_attempt_at = NULL WHERE id = $1`,
      [d.id, attempts, r.status],
    )
    await query('UPDATE webhook_endpoints SET failing_since = NULL WHERE id = $1', [d.endpoint_id])
    return r
  }
  const delay = RETRY_DELAYS_MIN[attempts - 1]
  await query(
    `UPDATE webhook_deliveries SET attempts = $2, last_status_code = $3, last_error = $4,
            status = CASE WHEN $5::int IS NULL THEN 'failed' ELSE 'pending' END,
            next_attempt_at = CASE WHEN $5::int IS NULL THEN NULL ELSE now() + ($5::int * interval '1 minute') END
      WHERE id = $1`,
    [d.id, attempts, r.status || null, r.error, delay ?? null],
  )
  await query('UPDATE webhook_endpoints SET failing_since = COALESCE(failing_since, now()) WHERE id = $1', [d.endpoint_id])
  return r
}

/** Retries due deliveries and switches off endpoints that kept failing. */
export async function runDueDeliveries(limit = 50) {
  const { rows } = await query(
    `SELECT id FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= now()
      ORDER BY next_attempt_at LIMIT $1`,
    [limit],
  )
  for (const r of rows) await attempt(r.id)
  const { rows: dead } = await query(
    `UPDATE webhook_endpoints SET active = false, disabled_at = now()
      WHERE active AND failing_since < now() - ($1 || ' hours')::interval RETURNING *`,
    [String(DISABLE_AFTER_HOURS)],
  )
  for (const e of dead) tellOwnerDisabled(e).catch(() => {})
  return { attempted: rows.length, disabled: dead.length }
}

async function tellOwnerDisabled(e) {
  const { rows } = await query('SELECT email, name FROM users WHERE id = $1', [e.created_by])
  const to = rows[0]?.email
  if (!to || /@test\.com$/i.test(to)) return
  await sendEmail({
    to,
    subject: 'A VolunTrack webhook was turned off',
    html: `<p>Hi${rows[0].name ? ` ${escapeHtml(rows[0].name.split(/\s+/)[0])}` : ''},</p>
<p>Deliveries to <strong>${escapeHtml(e.url)}</strong> have failed for 3 days, so we turned this webhook off. Fix the address or the server behind it, then turn it back on in VolunTrack under Settings → Webhooks, where you can also see each attempt and resend.</p>
${emailFooterHtml()}`,
  })
}

let worker = null
export function startWebhookWorker() {
  if (worker || !hasDatabase()) return
  worker = setInterval(() => { runDueDeliveries().catch((e) => console.error('webhook worker failed:', e.message)) }, 60_000)
  worker.unref?.()
}

/**
 * Queues an event for every active endpoint subscribed to it, then sends it
 * at once. Fire-and-forget: call without await; never throws.
 * `owners` is a list of { ownerType, ownerId }.
 */
export async function emitWebhook(owners, event, data) {
  try {
    if (!hasDatabase() || !owners?.length) return
    const clauses = owners.map((_, i) => `(owner_type = $${i * 2 + 2} AND owner_id = $${i * 2 + 3})`).join(' OR ')
    const params = [event, ...owners.flatMap((o) => [o.ownerType, o.ownerId])]
    const { rows } = await query(`SELECT id FROM webhook_endpoints WHERE active AND $1 = ANY(events) AND (${clauses})`, params)
    for (const e of rows) {
      const id = uid('whd')
      await query(
        `INSERT INTO webhook_deliveries (id, endpoint_id, event, payload, status, next_attempt_at)
         VALUES ($1, $2, $3, $4, 'pending', now())`,
        [id, e.id, event, JSON.stringify(data)],
      )
      attempt(id).catch((err) => console.error('webhook delivery failed:', err.message))
    }
  } catch (error) {
    console.error('webhook emit failed:', error.message)
  }
}

/** A test event to one endpoint, sent now. */
export async function sendTestEvent(owner, endpointId) {
  const { rows } = await query('SELECT * FROM webhook_endpoints WHERE id = $1 AND owner_type = $2 AND owner_id = $3', [endpointId, owner.ownerType, owner.ownerId])
  if (!rows[0]) throw new WebhookError('Webhook not found.', 404)
  const id = uid('whd')
  await query(
    `INSERT INTO webhook_deliveries (id, endpoint_id, event, payload, status, next_attempt_at)
     VALUES ($1, $2, 'test', $3, 'pending', now())`,
    [id, endpointId, JSON.stringify({ message: 'This is a test from VolunTrack.' })],
  )
  // A test may go to a switched-off endpoint (to check a fix) without turning it on.
  const wasActive = rows[0].active
  if (!wasActive) await query('UPDATE webhook_endpoints SET active = true WHERE id = $1', [endpointId])
  const r = await attempt(id).finally(async () => { if (!wasActive) await query('UPDATE webhook_endpoints SET active = false WHERE id = $1', [endpointId]) })
  if (!r?.ok) await query("UPDATE webhook_deliveries SET status = 'failed', next_attempt_at = NULL WHERE id = $1", [id])
  return { ok: Boolean(r?.ok), status: r?.status ?? null, error: r?.error ?? null }
}

/** Sends a past delivery again now (as a new attempt on the same delivery). */
export async function resendDelivery(owner, deliveryId) {
  const { rows } = await query(
    `SELECT d.id FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id
      WHERE d.id = $1 AND e.owner_type = $2 AND e.owner_id = $3`,
    [deliveryId, owner.ownerType, owner.ownerId],
  )
  if (!rows[0]) throw new WebhookError('Delivery not found.', 404)
  await query("UPDATE webhook_deliveries SET status = 'pending', attempts = 0, next_attempt_at = now() WHERE id = $1", [deliveryId])
  const r = await attempt(deliveryId)
  return { ok: Boolean(r?.ok), status: r?.status ?? null, error: r?.error ?? null }
}

// --- Event helpers used by the routes ------------------------------------------

/** The school and its organization, as webhook owners. */
export async function schoolOwners(schoolId) {
  if (!schoolId) return []
  const { rows } = await query('SELECT organization_id FROM schools WHERE id = $1', [schoolId])
  const owners = [{ ownerType: 'school', ownerId: schoolId }]
  if (rows[0]?.organization_id) owners.push({ ownerType: 'organization', ownerId: rows[0].organization_id })
  return owners
}

/**
 * hours.* for one log, if its student is at a school (and not an under-13
 * still waiting for a parent, nor a @test.com fixture). Same fields as the API.
 */
export async function emitHours(event, logId) {
  try {
    const { rows } = await query(
      `SELECT l.id, l.user_id, to_char(l.date, 'YYYY-MM-DD') AS date, l.activity, l.category, l.hours, l.org_name,
              l.verification_status, l.review_note, l.task_id, l.created_at, u.school_id
         FROM logs l JOIN users u ON u.id = l.user_id
        WHERE l.id = $1 AND u.role = 'student' AND u.school_id IS NOT NULL
          AND (u.parental_consent_status IS NULL OR u.parental_consent_status <> 'pending')
          AND u.email NOT ILIKE '%@test.com'`,
      [logId],
    )
    const l = rows[0]
    if (!l) return
    emitWebhook(await schoolOwners(l.school_id), event, {
      hours: {
        id: l.id, studentId: l.user_id, schoolId: l.school_id, date: l.date, activity: l.activity, category: l.category || null,
        hours: Number(l.hours), place: l.org_name || null,
        status: !l.verification_status || l.verification_status === 'none' ? 'unconfirmed' : l.verification_status,
        reviewNote: l.review_note || null, eventId: l.task_id || null, createdAt: l.created_at,
      },
    })
  } catch (error) {
    console.error('webhook hours event failed:', error.message)
  }
}

/** student.joined / student.left. */
export async function emitStudent(event, userId, schoolId) {
  try {
    const { rows } = await query(
      `SELECT id, name, email, grade FROM users WHERE id = $1 AND role = 'student'
          AND (parental_consent_status IS NULL OR parental_consent_status <> 'pending') AND email NOT ILIKE '%@test.com'`,
      [userId],
    )
    if (!rows[0]) return
    emitWebhook(await schoolOwners(schoolId), event, { student: { id: rows[0].id, name: rows[0].name, email: rows[0].email, grade: rows[0].grade || null, schoolId } })
  } catch (error) {
    console.error('webhook student event failed:', error.message)
  }
}

/** event.signup / event.attendance for an organizer's event. */
export async function emitEventSignup(event, signupId) {
  try {
    const { rows } = await query(
      `SELECT s.id, s.task_id, s.status, s.attendance_status, s.checked_in_at, s.checked_out_at, u.name, t.created_by, t.title,
              to_char(t.date, 'YYYY-MM-DD') AS date
         FROM public_task_signups s JOIN users u ON u.id = s.user_id JOIN public_tasks t ON t.id = s.task_id
        WHERE s.id = $1 AND (u.parental_consent_status IS NULL OR u.parental_consent_status <> 'pending')`,
      [signupId],
    )
    const s = rows[0]
    if (!s) return
    const parts = String(s.name || '').trim().split(/\s+/)
    const volunteer = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] || ''
    emitWebhook([{ ownerType: 'organizer', ownerId: s.created_by }], event, {
      event: { id: s.task_id, title: s.title, date: s.date },
      signup: { id: s.id, volunteer, status: s.status, attendance: s.attendance_status || (s.checked_in_at ? 'present' : null), checkedInAt: s.checked_in_at, checkedOutAt: s.checked_out_at },
    })
  } catch (error) {
    console.error('webhook signup event failed:', error.message)
  }
}

/** Same as emitEventSignup, found by event and volunteer. */
export async function emitSignupFor(event, taskId, userId) {
  try {
    const { rows } = await query('SELECT id FROM public_task_signups WHERE task_id = $1 AND user_id = $2', [taskId, userId])
    if (rows[0]) await emitEventSignup(event, rows[0].id)
  } catch (error) {
    console.error('webhook signup lookup failed:', error.message)
  }
}
