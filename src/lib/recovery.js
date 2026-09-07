// Single source of truth for talking to the email backend during
// password / PIN recovery. Both pages use this so the user always
// sees the same delivery status, error, and fallback behavior.

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
 * Ask the backend to email a recovery code to `email`.
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
 * Dev-only helper used by the live demo: when the backend is reachable the
 * most recently generated code can be pulled from /api/dev-recovery-code so
 * the user isn't blocked. When the backend isn't reachable at all (e.g. the
 * GitHub Pages static host), this returns `backendAvailable: false` and the
 * page renders the on-screen code path instead.
 */
export async function fetchDevRecoveryCode(email) {
  if (!email) return { ok: false, reason: 'Missing email.', backendAvailable: false }
  try {
    const response = await fetch(`${apiUrl}/dev-recovery-code?email=${encodeURIComponent(email)}`)
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      const backendAvailable = response.status !== 404
      return {
        ok: false,
        reason: body?.error || `Backend returned ${response.status}.`,
        backendAvailable,
      }
    }
    const body = await response.json()
    return { ok: true, code: body.code, type: body.type, backendAvailable: true }
  } catch (err) {
    return {
      ok: false,
      reason: err?.message || 'Could not reach the email server.',
      backendAvailable: false,
    }
  }
}
