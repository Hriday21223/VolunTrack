import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'
import { applyStoredTheme } from './hooks/useTheme.js'
import { applyNativeAppChrome, startNativeApp } from './lib/platform.js'
import { installApiFetchGuard } from './lib/apiFetch.js'

installApiFetchGuard()
applyStoredTheme()
applyNativeAppChrome()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)

startNativeApp()
