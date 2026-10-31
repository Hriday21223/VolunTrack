import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'
import { applyStoredTheme } from './hooks/useTheme.js'
import { applyStoredDisplay } from './hooks/useDisplayPrefs.js'
import { applyNativeAppChrome, startNativeApp } from './lib/platform.js'
import { startNativePush } from './lib/nativePush.js'
import { installApiFetchGuard } from './lib/apiFetch.js'

// Offline support for the website (the native apps don't use a service
// worker; vite.config.js turns it off for `--mode app`). Registration can be
// refused for reasons that aren't ours — extensions, private browsing, storage
// blocked — and the site works without it, so a refusal is ignored.
//
// Updates (#599): we register the worker ourselves, so we also do what the
// plugin's own register script would — tell a newly installed version to take
// over (the worker only skips waiting when asked). Otherwise an update waited
// until every VolunTrack tab was closed, which on a phone can be days. Nothing
// is reloaded mid-task: the new version is used from the next page load.
if (import.meta.env.PROD && import.meta.env.MODE !== 'app' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((reg) => {
      // Only an update: on a first install there's no older version to replace.
      const takeOver = (worker) => {
        if (worker && navigator.serviceWorker.controller) worker.postMessage({ type: 'SKIP_WAITING' })
      }
      takeOver(reg.waiting)
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing
        worker?.addEventListener('statechange', () => { if (worker.state === 'installed') takeOver(worker) })
      })
      const check = () => reg.update().catch(() => {})
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
      setInterval(check, 60 * 60 * 1000)
    }).catch(() => {})
  })
  // A page opened before an update can ask for a lazily loaded screen whose old
  // file no longer exists; load the new version instead (once per minute at most).
  window.addEventListener('vite:preloadError', (event) => {
    let last = 0
    try { last = Number(sessionStorage.getItem('voluntrack:preload-reload')) || 0 } catch { /* storage blocked */ }
    if (Date.now() - last < 60 * 1000) return
    try { sessionStorage.setItem('voluntrack:preload-reload', String(Date.now())) } catch { /* storage blocked */ }
    event.preventDefault()
    window.location.reload()
  })
}
import { installErrorReporting } from './lib/errorReporting.js'

installErrorReporting()
installApiFetchGuard()
applyStoredTheme()
applyStoredDisplay()
applyNativeAppChrome()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)

startNativeApp()
// Phone push (#603): route notification taps; refresh the token if it was on.
startNativePush()
