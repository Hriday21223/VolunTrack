// Text messages to supervisors (#609), through Twilio's REST API (no SDK).
// Off until TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and either TWILIO_FROM (a
// number, E.164) or TWILIO_MESSAGING_SERVICE_SID are set — like email, a
// request without SMS just goes by email.
//
// STOP / START replies are handled by Twilio itself (Advanced Opt-Out on US
// numbers): a supervisor who replies STOP is never texted again from our
// number, and Twilio rejects the send (error 21610), which we treat as "don't
// text this number".
//
// US sending needs the number registered for A2P (10DLC) or a verified
// toll-free number, done in the Twilio console; nothing here changes for that.

export function smsConfigured() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    && (process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID))
}

/**
 * A mobile number in E.164 (+15551234567), or null. Ten digits (or eleven
 * starting with 1) are read as a US/Canada number; anything else must start
 * with + and a country code.
 */
export function normalizePhone(input) {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  const plus = raw.startsWith('+')
  const digits = raw.replace(/\D/g, '')
  if (!plus) {
    if (digits.length === 10) return `+1${digits}`
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
    return null
  }
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null
  return `+${digits}`
}

/** "+15551234567" → "•••-•••-4567", for showing which number was texted. */
export function maskPhone(e164) {
  const s = String(e164 || '')
  return s ? `•••-•••-${s.slice(-4)}` : ''
}

/**
 * Sends one text. Never throws.
 * @returns {Promise<{ ok: boolean, skipped?: boolean, optedOut?: boolean, error?: string }>}
 */
export async function sendSms(to, body) {
  if (!smsConfigured()) return { ok: false, skipped: true }
  if (/^\+1555/.test(to)) return { ok: false, skipped: true } // fictional test numbers
  const sid = process.env.TWILIO_ACCOUNT_SID
  const form = new URLSearchParams({ To: to, Body: body })
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', process.env.TWILIO_MESSAGING_SERVICE_SID)
  else form.set('From', process.env.TWILIO_FROM)
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) return { ok: true }
    const err = await res.json().catch(() => ({}))
    return { ok: false, optedOut: err.code === 21610, error: `Twilio ${res.status} ${err.code || ''} ${err.message || ''}`.trim() }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

/** The first text to a supervisor. Short, so it fits in about two SMS segments. */
export function verificationText({ studentName, hours, activity, verifyUrl }) {
  const act = String(activity || '').slice(0, 60)
  return `VolunTrack: ${studentName} listed you as their supervisor for ${hours} volunteer hour(s) ("${act}"). Approve or reject: ${verifyUrl} Reply STOP to opt out.`
}

export function reminderText({ studentName, hours, verifyUrl, last }) {
  return `VolunTrack reminder: ${studentName} is waiting for you to confirm ${hours} volunteer hour(s): ${verifyUrl}${last ? ' (last reminder)' : ''} Reply STOP to opt out.`
}
