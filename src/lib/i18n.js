import es from '@/locales/es.js'
import vi from '@/locales/vi.js'
import zh from '@/locales/zh.js'

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
  // Vietnamese and Simplified Chinese (#637). Screens not translated yet show
  // in English.
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'zh', label: '中文（简体）' },
  // The world's most-spoken languages (#834). Their files are loaded only for
  // someone who picks them (loadLanguage), so nobody else downloads them, and
  // so far only the most-seen screens are translated: the rest shows English.
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ar', label: 'العربية', dir: 'rtl' },
  { code: 'pt', label: 'Português' },
  { code: 'fr', label: 'Français' },
  { code: 'bn', label: 'বাংলা' },
  { code: 'ru', label: 'Русский' },
  { code: 'ja', label: '日本語' },
]
const DICTIONARIES = { es, vi, zh }
const LAZY_DICTIONARIES = {
  hi: () => import('@/locales/hi.js'),
  ar: () => import('@/locales/ar.js'),
  pt: () => import('@/locales/pt.js'),
  fr: () => import('@/locales/fr.js'),
  bn: () => import('@/locales/bn.js'),
  ru: () => import('@/locales/ru.js'),
  ja: () => import('@/locales/ja.js'),
}
const STORAGE_KEY = 'voluntrack:language'

function detect() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && LANGUAGES.some((l) => l.code === saved)) return saved
  } catch { /* storage blocked: fall back to the browser's language */ }
  const browser = typeof navigator !== 'undefined' ? String(navigator.language || '') : ''
  const lower = browser.toLowerCase()
  if (lower.startsWith('es')) return 'es'
  if (lower.startsWith('vi')) return 'vi'
  // Simplified only: a browser set to Traditional Chinese keeps English.
  if (lower === 'zh' || lower.startsWith('zh-cn') || lower.startsWith('zh-sg') || lower.startsWith('zh-hans')) return 'zh'
  for (const code of Object.keys(LAZY_DICTIONARIES)) if (lower === code || lower.startsWith(`${code}-`)) return code
  return 'en'
}

export const language = detect()
let dictionary = DICTIONARIES[language] || null

if (typeof document !== 'undefined') {
  document.documentElement.lang = language
  // Arabic reads right to left; index.css flips the few left/right-pinned bits.
  document.documentElement.dir = LANGUAGES.find((l) => l.code === language)?.dir || 'ltr'
}

// For a language loaded on demand, main.jsx awaits this before importing the
// app, so tr() calls in module-level constants already see it. A failed load
// (offline, old cached page) just leaves English.
export async function loadLanguage() {
  const load = LAZY_DICTIONARIES[language]
  if (!load) return
  try { dictionary = (await load()).default } catch { dictionary = null }
}

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
