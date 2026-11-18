// "Install VolunTrack on your phone" (#936). Chrome on Android fires
// beforeinstallprompt once, often before any card is on screen, so it's
// caught here at start-up and kept for InstallAppCard. iPhone Safari has no
// such event; the card shows the Share → Add to Home Screen steps instead.
let deferred = null
const listeners = new Set()

export function installInstallPromptCatcher() {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // keep it for our own Install button
    deferred = e
    listeners.forEach((fn) => fn())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    try { localStorage.setItem(DISMISS_KEY, 'installed') } catch { /* */ }
    listeners.forEach((fn) => fn())
  })
}

export const DISMISS_KEY = 'voluntrack:install-card'
export const canPromptInstall = () => Boolean(deferred)
export function onInstallChange(fn) { listeners.add(fn); return () => listeners.delete(fn) }

// → 'accepted' | 'dismissed' | null
export async function promptInstall() {
  if (!deferred) return null
  const e = deferred
  deferred = null
  e.prompt()
  const choice = await e.userChoice.catch(() => null)
  listeners.forEach((fn) => fn())
  return choice?.outcome || null
}

export function isStandalone() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
  } catch { return false }
}

export function phoneKind() {
  const ua = navigator.userAgent || ''
  if (/iPhone|iPod/.test(ua) || (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return null
}
