// Render's free tier spins the web service down after ~15 minutes with no
// inbound HTTP traffic. A cold boot takes far longer than the 5s budget the
// public /status page allows a health poll (src/lib/status.js), so a sleeping
// backend is painted there as "Backend API — unreachable" plus a "Database —
// not configured" tile: a false outage reported for a service that is fine.
//
// keep-warm.yml was meant to prevent exactly this, but GitHub throttles
// scheduled workflows hard — its `*/10 * * * *` schedule actually fires every
// 2-5 hours in practice, so it cannot hold a 15-minute window open. It stays
// on as the outside-in outage monitor, which is the job it can still do.
//
// This keeps the service awake from the inside instead: the request leaves for
// the public origin and comes back in through Render's load balancer, so it
// counts as the inbound traffic that resets the idle timer. It cannot recover
// a service that has *already* fallen asleep — nothing is running to send the
// ping — which is the other reason keep-warm.yml stays.

// Only while people are using the app (the owner's choice, Nov 25): the
// backend notes the last real request (noteActivity, mounted first in
// server.js) and pings itself only while that was within ACTIVE_WINDOW_MS.
// After that it stops, and Render puts it to sleep about 15 minutes later;
// the next visitor wakes it (the website sends a wake-up ping as it loads,
// see src/main.jsx). Scheduled jobs, link-preview robots, the outside monitor
// and this ping itself don't count as people, so they can't keep it up.
const ACTIVE_WINDOW_MS = 20 * 60 * 1000
let lastActivityAt = Date.now() // whoever woke it counts as activity

const NOT_PEOPLE = /^\/api\/(status\/health|og\/|embed\/)|\/internal\//
export function noteActivity(req, _res, next) {
  if (req.path.startsWith('/api/')
    && !req.get('x-keep-awake')
    && !req.get('x-cron-key')
    && !NOT_PEOPLE.test(req.path)) {
    lastActivityAt = Date.now()
  }
  next()
}

// Under Render's 15-minute idle window. Deliberately not 10: at a 10-minute
// interval a single failed ping leaves a 20-minute gap and the service sleeps,
// whereas this tolerates two consecutive failures. The cost is one 204 every
// five minutes.
const PING_INTERVAL_MS = 5 * 60 * 1000

// Same convention (and same hardcoded prod fallback) as backendUrl() in
// server/digest.js and contactLink() in server/email.js.
function backendUrl() {
  return (process.env.PUBLIC_BACKEND_URL || 'https://voluntrack-backend-frrh.onrender.com').replace(/\/$/, '')
}

// Opt-in rather than on-by-default so local dev, CI and any self-hosted
// deployment never sit in a self-ping loop. render.yaml sets it for the
// deployed backend, which is the only place the free-tier spin-down applies.
export function startKeepAwake() {
  if (process.env.KEEP_AWAKE !== '1') return

  const url = `${backendUrl()}/api/status/ping`
  console.log(`Keep-awake: pinging ${url} every ${PING_INTERVAL_MS / 60000} min while someone was active in the last ${ACTIVE_WINDOW_MS / 60000} min.`)

  // unref() so the timer never holds the process open on its own — a shutdown
  // should not have to wait out a five-minute interval.
  const timer = setInterval(() => {
    // Nobody around: let the service go to sleep.
    if (Date.now() - lastActivityAt > ACTIVE_WINDOW_MS) return
    fetch(url, { headers: { 'x-keep-awake': '1' }, signal: AbortSignal.timeout(30_000) })
      // A failed ping is not worth an error-level log: the next one is five
      // minutes away and the window is fifteen. Logging it at all is only so
      // a run of them is visible in the Render logs if the service does sleep.
      .catch((error) => console.warn('Keep-awake ping failed:', error.message))
  }, PING_INTERVAL_MS)
  timer.unref()
}
