// Sends errors from people's browsers and the apps to our own server
// (server/routes/clientErrors.js), shown in Admin → Incidents. Before this a
// crash on someone's phone left no trace anywhere.
//
// What's sent: the error message and stack, the page path (never the query
// string, which can hold a token or a code), and the app version. Never who
// the user is, nor anything they typed. At most MAX_PER_PAGE reports per page
// load, each distinct message once, and network failures are skipped — those
// are the offline/retry paths working, not bugs.

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const MAX_PER_PAGE = 5
// Network failures are the offline/retry paths working; "Script error." is what
// a browser reports for a script from another origin (an extension, say), with
// no details to act on.
const NOISE = /Failed to fetch|NetworkError|Load failed|TimeoutError|AbortError|The operation was aborted|ResizeObserver loop|Network request failed|^Script error\.?$/i

let sent = 0
const seen = new Set()

export function reportError(error, extraStack = '') {
  try {
    const message = String(error?.message || error || '').slice(0, 500)
    if (!message || NOISE.test(message) || seen.has(message) || sent >= MAX_PER_PAGE) return
    seen.add(message)
    sent += 1
    const stack = `${error?.stack || ''}${extraStack ? `\n${extraStack}` : ''}`.slice(0, 4000)
    fetch(`${apiUrl}/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, stack, path: window.location.pathname, appVersion: import.meta.env.VITE_APP_VERSION || '' }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Reporting must never cause an error of its own.
  }
}

export function installErrorReporting() {
  if (typeof window === 'undefined' || window.__voluntrackErrorReporting) return
  window.__voluntrackErrorReporting = true
  window.addEventListener('error', (e) => {
    // A script from a browser extension or another site isn't ours to fix.
    if (e.filename && !e.filename.startsWith(window.location.origin) && !e.filename.startsWith('capacitor://')) return
    reportError(e.error || e.message)
  })
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason))
}
