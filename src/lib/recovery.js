// Single source of truth for talking to the email backend during
// password / PIN recovery, so both pages show the same delivery status,
// error, and fallback behavior.
//
// The two flows are not symmetric: a PIN is a local-only credential, so its
// code is generated in the browser and relayed by sendRecoveryEmail. A
// password guards the server account, so its code is minted by the backend
// via requestPasswordReset and only ever reaches the user by email.

const apiUrl = import.meta.env.VITE_API_URL || '/api'

const NO_BACKEND_HINTS = [
  'Email backend returned 404',
  'backend returned 404',
  'failed to fetch',
  'networkerror',
]

function reasonLooksLikeMissingBackend(reason) {
  if (!reason) return false
  const r = String(reason).toLowerCase()
  return NO_BACKEND_HINTS.some((hint) => r.includes(hint))
}

/**
 * Ask the backend to email a client-generated PIN recovery code to `email`.
 *
 * Resolves to an object describing what happened:
 *   - { ok: true }                       - the backend accepted the email
 *   - { ok: false, reason, missingVars, backendAvailable }
 *
 * `backendAvailable` is false when the call failed with a 404 / network error,
 * which on a static-host deployment means there is simply no API server. The
 * pages use that flag to skip retries and surface the on-screen code path.
 *
 * Never throws so callers can render a status banner instead of crashing.
 */
export async function sendRecoveryEmail({ email, code, type }) {
  if (!email || !code || !type) {
    return { ok: false, reason: 'Missing recovery details.', backendAvailable: false }
  }
  try {
    const controller = new AbortController()
    // Gmail SMTP's first connection of a session (fresh TLS handshake) can
    // take 5-10s — 8s was aborting real, successful sends and telling users
    // delivery failed when it hadn't. 25s covers a cold connection with room
    // to spare while still failing fast on a genuinely broken backend.
    const timer = setTimeout(() => controller.abort(), 25000)
    const response = await fetch(`${apiUrl}/send-reset-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, type }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (response.ok) return { ok: true, backendAvailable: true }

    let reason = `Email backend returned ${response.status}.`
    let missingVars = null
    try {
      const body = await response.json()
      if (body?.error) reason = body.error
      if (Array.isArray(body?.missingVars)) missingVars = body.missingVars
    } catch {
      // body wasn't JSON; keep the status-based reason.
    }

    // 404 / network error on a static host = no backend at this URL.
    const backendAvailable = response.status !== 404 && !reasonLooksLikeMissingBackend(reason)
    return { ok: false, reason, missingVars, backendAvailable }
  } catch (err) {
    const isTimeout = err?.name === 'AbortError'
    const reason = isTimeout ? 'Email timed out.' : err?.message || 'Could not reach the email server.'
    return { ok: false, reason, backendAvailable: !isTimeout }
  }
}

/**
 * Cheap liveness check. Used to flip the UI from "fallback" back to "live"
 * once the backend is reachable again. Returns `{ ok, smtpConfigured, missingVars, backendAvailable }`.
 */
export async function getRecoveryStatus() {
  try {
    const response = await fetch(`${apiUrl}/recovery-status`)
    if (!response.ok) {
      return { ok: false, backendAvailable: response.status !== 404 }
    }
    const body = await response.json().catch(() => ({}))
    return {
      ok: true,
      backendAvailable: true,
      smtpConfigured: Boolean(body.smtpConfigured),
      missingVars: Array.isArray(body.missingVars) ? body.missingVars : [],
    }
  } catch {
    return { ok: false, backendAvailable: false }
  }
}

/**
 * Ask the backend to mint and email a password recovery code.
 *
 * The code is generated server-side and only its hash is stored, so nothing
 * the client sends here can become a valid code. Resolves to:
 *   - { ok: true, emailed: true }            - emailed to the account holder
 *   - { ok: true, emailed: false, code }     - no SMTP outside production;
 *                                              the backend hands the code back
 *   - { ok: false, reason, missingVars, backendAvailable }
 *
 * Never throws, and never reveals whether the address has an account.
 */
export async function requestPasswordReset(email) {
  if (!email) return { ok: false, reason: 'Missing email.', backendAvailable: false }
  try {
    const controller = new AbortController()
    // Same 25s budget as sendRecoveryEmail — a cold SMTP handshake is slow.
    const timer = setTimeout(() => controller.abort(), 25000)
    const response = await fetch(`${apiUrl}/auth/request-password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      signal: controller.signal,
    })
    clearTimeout(timer)

    const body = await response.json().catch(() => ({}))
    if (response.ok) {
      return { ok: true, emailed: Boolean(body.emailed), code: body.code || null, backendAvailable: true }
    }

    const reason = body?.error || `Email backend returned ${response.status}.`
    const missingVars = Array.isArray(body?.missingVars) ? body.missingVars : null
    const backendAvailable = response.status !== 404 && !reasonLooksLikeMissingBackend(reason)
    // A backend running without DATABASE_URL has no accounts to reset — that
    // is the localStorage-only setup, not a broken server.
    const noAccountsApi = response.status === 503 && /database/i.test(reason)
    return { ok: false, reason, missingVars, backendAvailable, noAccountsApi }
  } catch (err) {
    const isTimeout = err?.name === 'AbortError'
    const reason = isTimeout ? 'Email timed out.' : err?.message || 'Could not reach the email server.'
    return { ok: false, reason, backendAvailable: !isTimeout }
  }
}
