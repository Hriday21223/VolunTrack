import { language } from './i18n.js'
// One place that every call to our own API passes through (installed in
// main.jsx), instead of editing the ~220 fetch calls one by one.
//
//  - A time limit. Calls used to wait forever: Render's free server sleeps
//    after a quiet spell and takes 30-50 s to wake, and a request stuck past
//    that showed an endless spinner. After API_TIMEOUT_MS it fails like a
//    network error, which the existing retry and offline paths already handle.
//  - A "waking up" signal. When a call has taken SLOW_AFTER_MS, a
//    'voluntrack:api-slow' event says so (SlowServerNotice shows a bar), and
//    'voluntrack:api-idle' when nothing slow is left in flight.
//
// Only our API is touched — not school buckets, maps or place search — and a
// call that brings its own AbortSignal keeps it.

export const API_TIMEOUT_MS = 60_000
export const SLOW_AFTER_MS = 4_000

const apiBase = import.meta.env.VITE_API_URL || '/api'

function isOurApi(url) {
  try {
    const u = new URL(url, window.location.origin)
    const base = new URL(apiBase, window.location.origin)
    return u.origin === base.origin && u.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/')
  } catch {
    return false
  }
}

let slowCount = 0
function emit(name) {
  window.dispatchEvent(new Event(name))
}

function withLanguage(init) {
  const headers = new Headers(init?.headers || {})
  if (!headers.has('Accept-Language')) headers.set('Accept-Language', language)
  return { ...(init || {}), headers }
}

export function installApiFetchGuard() {
  if (typeof window === 'undefined' || window.__voluntrackFetchGuard) return
  window.__voluntrackFetchGuard = true
  const original = window.fetch.bind(window)

  window.fetch = (input, init) => {
    // The app always passes a URL string; a Request object (which always
    // carries its own signal) or a call with its own signal is left as is.
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : null
    if (!url || !isOurApi(url)) return original(input, init)
    // The app's language, so emails sent from this request (a sign-up code,
    // the welcome email) and error messages come back in it (#604).
    // Accept-Language is a CORS-safelisted header: no extra preflight.
    init = withLanguage(init)
    if (init?.signal) return original(input, init)
    const request = original(input, { ...(init || {}), signal: AbortSignal.timeout(API_TIMEOUT_MS) })
    let slow = false
    const timer = setTimeout(() => {
      slow = true
      if (++slowCount === 1) emit('voluntrack:api-slow')
    }, SLOW_AFTER_MS)
    const settle = () => {
      clearTimeout(timer)
      if (slow && --slowCount === 0) emit('voluntrack:api-idle')
    }
    request.then(settle, settle)
    return request
  }
}
