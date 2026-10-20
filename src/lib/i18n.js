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
  window.location.reload()
}
