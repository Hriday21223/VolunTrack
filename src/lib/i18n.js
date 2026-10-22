import es from '@/locales/es.js'

// Translations. English is the source: the English text is the key, so any
// string without a translation simply shows in English. Wrap text in tr():
//
//   tr('Log Hours')
//   tr('{n} hours logged', { n: 3 })
//
// The language is read once at start-up; changing it reloads the page, so
// tr() is a plain function that works anywhere (constants, helpers, server
// error messages shown in the UI) without a context provider.

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
]
const DICTIONARIES = { es }
const STORAGE_KEY = 'voluntrack:language'

function detect() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && LANGUAGES.some((l) => l.code === saved)) return saved
  } catch { /* storage blocked: fall back to the browser's language */ }
  const browser = typeof navigator !== 'undefined' ? String(navigator.language || '') : ''
  return browser.toLowerCase().startsWith('es') ? 'es' : 'en'
}

export const language = detect()
const dictionary = DICTIONARIES[language] || null

if (typeof document !== 'undefined') document.documentElement.lang = language

export function tr(text, vars) {
  if (text == null) return text
  let out = (dictionary && dictionary[text]) || text
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m))
  return out
}

export function setLanguage(code) {
  if (code === language) return
  try { localStorage.setItem(STORAGE_KEY, code) } catch { /* nothing to keep it in */ }
  sendLanguageToServer(code)
  window.location.reload()
}

// Tells the server which language a signed-in account uses, so emails sent
// to it (the weekly digest, the come-back nudge) can follow (#416). Fire-and-
// forget: never awaited, never shown as an error. `keepalive` lets the request
// outlive the reload setLanguage does straight after. A local-only account has
// no token and nothing to tell.
export function sendLanguageToServer(code) {
  let token = null
  try { token = localStorage.getItem('voluntrack:auth_token') } catch { /* storage blocked */ }
  if (!token || !LANGUAGES.some((l) => l.code === code)) return
  const apiUrl = import.meta.env.VITE_API_URL || '/api'
  try {
    fetch(`${apiUrl}/auth/me/language`, {
      method: 'PUT',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ language: code }),
    }).catch(() => {})
  } catch { /* fetch unavailable — nothing to do */ }
}

// After sign-in: send this device's language if the server's differs. A
// device that only guessed from the browser (no saved choice) doesn't
// overwrite a language the account chose elsewhere — it only fills in a blank.
export function syncLanguageWithServer(serverLanguage) {
  if (serverLanguage === language) return
  let saved = null
  try { saved = localStorage.getItem(STORAGE_KEY) } catch { /* storage blocked */ }
  if (saved || serverLanguage == null) sendLanguageToServer(language)
}
