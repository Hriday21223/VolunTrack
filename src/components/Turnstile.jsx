import { useEffect, useRef, useState } from 'react'
import { TURNSTILE_SITE_KEY, turnstileEnabled } from '@/lib/turnstile.js'

// Explicit-render mode: we mount the widget ourselves so it lands inside the
// form and we control its lifecycle across React re-renders.
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let scriptPromise = null

function loadTurnstileScript() {
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    if (window.turnstile) return resolve()
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      scriptPromise = null // allow a later retry (e.g. after a page reload)
      reject(new Error('Failed to load Turnstile'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

/**
 * Cloudflare Turnstile widget. Renders nothing when VITE_TURNSTILE_SITE_KEY
 * is unset, so callers can mount it unconditionally.
 *
 * @param {(token: string) => void} onVerify - called with the token on success,
 *   and with '' when the token expires or errors (so the caller can re-disable
 *   its submit button).
 */
export default function Turnstile({ onVerify, action, className = '' }) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  // Keep the latest callback without making it an effect dependency — an
  // inline arrow from the parent would otherwise re-mount the widget every
  // render.
  const onVerifyRef = useRef(onVerify)
  onVerifyRef.current = onVerify
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!turnstileEnabled) return
    let cancelled = false

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          action,
          theme: 'auto',
          callback: (token) => onVerifyRef.current?.(token),
          'expired-callback': () => onVerifyRef.current?.(''),
          'error-callback': () => {
            setFailed(true)
            onVerifyRef.current?.('')
          },
        })
      })
      .catch(() => setFailed(true))

    return () => {
      cancelled = true
      if (widgetIdRef.current != null && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          // widget already gone (e.g. script failed to load) — nothing to do
        }
      }
      widgetIdRef.current = null
    }
  }, [action])

  if (!turnstileEnabled) return null

  return (
    <div className={className}>
      <div ref={containerRef} />
      {failed && (
        <p className="text-xs text-red-600 dark:text-red-300 mt-1">
          Couldn&rsquo;t load the CAPTCHA. Refresh the page and try again.
        </p>
      )}
    </div>
  )
}
