import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'
import { applyStoredTheme } from './hooks/useTheme.js'
import { applyStoredDisplay } from './hooks/useDisplayPrefs.js'
import { applyNativeAppChrome, startNativeApp } from './lib/platform.js'
import { installApiFetchGuard } from './lib/apiFetch.js'

// Offline support for the website (the native apps don't use a service
// worker; vite.config.js turns it off for `--mode app`). Registration can be
// refused for reasons that aren't ours — extensions, private browsing, storage
// blocked — and the site works without it, so a refusal is ignored.
if (import.meta.env.PROD && import.meta.env.MODE !== 'app' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
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
