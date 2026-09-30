import { Capacitor } from '@capacitor/core'

// True inside the Android/iOS apps (Capacitor), false on the website. The
// apps share every page with the site, so this is the single switch for the
// few places where an app should look or behave like an app rather than a
// web page — the website must render exactly as it did without it.
export const isNativeApp = Capacitor.isNativePlatform()

// Called once at boot, before React renders. Marks <html> so CSS can scope
// app-only rules under `.native-app`, and turns off pinch-zoom, which a web
// page needs for accessibility but an app's fixed-size UI does not.
export function applyNativeAppChrome() {
  if (!isNativeApp) return
  document.documentElement.classList.add('native-app')
  const viewport = document.querySelector('meta[name="viewport"]')
  if (viewport) {
    viewport.setAttribute(
      'content',
      'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover',
    )
  }
}

// Status bar and splash screen, once React has painted the first screen.
// Plugins are loaded on demand so the website never downloads them.
export async function startNativeApp() {
  if (!isNativeApp) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    // Style.Dark = light text, for the app's dark background.
    await StatusBar.setStyle({ style: Style.Dark })
    if (Capacitor.getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: '#071117' })
    }
  } catch { /* cosmetic — never block startup on it */ }
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    await SplashScreen.hide()
  } catch { /* the splash also times out on its own */ }
}

// A light "success" tap for moments worth feeling — saving hours, finishing
// something. No-op on the website.
export async function hapticSuccess() {
  if (!isNativeApp) return
  try {
    const { Haptics, NotificationType } = await import('@capacitor/haptics')
    await Haptics.notification({ type: NotificationType.Success })
  } catch { /* haptics are optional */ }
}
