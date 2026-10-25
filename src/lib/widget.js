import { Capacitor, registerPlugin } from '@capacitor/core'

// Feeds the Android home-screen widget (#519): hours so far and the goal.
// The numbers stay on the device (android ProgressWidgetPlugin). A no-op on
// the website and on iOS, which has no widget yet.
const ProgressWidget = registerPlugin('ProgressWidget')
const enabled = Capacitor.getPlatform() === 'android'
let last = ''

export function updateWidget({ hours, goal, signedIn = true }) {
  if (!enabled) return
  const payload = { hours: Math.round((Number(hours) || 0) * 10) / 10, goal: Math.round((Number(goal) || 0) * 10) / 10, signedIn }
  const key = JSON.stringify(payload)
  if (key === last) return
  last = key
  ProgressWidget.update(payload).catch(() => {})
}

export function clearWidget() {
  if (!enabled) return
  last = ''
  ProgressWidget.clear().catch(() => {})
}
