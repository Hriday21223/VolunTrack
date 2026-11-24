import { Capacitor, registerPlugin } from '@capacitor/core'

// Guards a screen that shows a document (PdfPreview) in the phone apps.
// - Android: blocks screenshots and screen recording while it's open
//   (FLAG_SECURE, android ScreenGuardPlugin); they come out black.
// - iOS can't block a screenshot, only report it afterwards, so the preview
//   closes when one is taken, and hides while the screen is being recorded
//   or mirrored (ScreenGuardPlugin in ios/App/App/SceneDelegate.swift).
// A no-op on the website, where screenshots can't be detected reliably;
// there the watermark on every preview is the protection.
const ScreenGuard = registerPlugin('ScreenGuard')
const platform = Capacitor.getPlatform()

/**
 * Turns the guard on and returns a function that turns it off.
 * onScreenshot(): iOS, after a screenshot. onCaptured(bool): iOS, when
 * recording or mirroring starts or stops (and once at start).
 */
export function guardScreen({ onScreenshot, onCaptured } = {}) {
  if (platform === 'android') {
    ScreenGuard.enable().catch(() => {})
    return () => { ScreenGuard.disable().catch(() => {}) }
  }
  if (platform !== 'ios') return () => {}

  const handles = []
  let stopped = false
  const add = (event, fn) => ScreenGuard.addListener(event, fn)
    .then((h) => { if (stopped) h.remove(); else handles.push(h) })
    .catch(() => {})
  add('screenshotTaken', () => onScreenshot?.())
  add('captureChanged', (e) => onCaptured?.(Boolean(e?.captured)))
  ScreenGuard.isCaptured().then((r) => { if (!stopped) onCaptured?.(Boolean(r?.captured)) }).catch(() => {})
  return () => {
    stopped = true
    handles.forEach((h) => h.remove())
  }
}
