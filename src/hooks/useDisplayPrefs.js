import { useEffect, useState, useCallback } from 'react'
import { keys, read, write } from '@/lib/storage.js'

// Bigger text and high contrast: device-level display preferences, kept in
// localStorage like the theme and never sent to the server. They live as
// attributes on <html> — data-text-size scales the root font size, so every
// rem-based Tailwind size grows with it, data-contrast="high" switches on
// the overrides in src/index.css, and data-font="easy" swaps in Atkinson
// Hyperlegible, a font made to keep similar letters apart (#553).

export const TEXT_SIZES = ['default', 'large', 'xlarge']
const CONTRASTS = ['normal', 'high']
const FONTS = ['default', 'easy']
const CHANGE_EVENT = 'voluntrack:display-prefs'

function stored() {
  const textSize = read(keys.textSize, 'default')
  const contrast = read(keys.contrast, 'normal')
  const font = read(keys.font, 'default')
  return {
    textSize: TEXT_SIZES.includes(textSize) ? textSize : 'default',
    contrast: CONTRASTS.includes(contrast) ? contrast : 'normal',
    font: FONTS.includes(font) ? font : 'default',
  }
}

function apply({ textSize, contrast, font }) {
  const html = document.documentElement
  if (textSize === 'default') html.removeAttribute('data-text-size')
  else html.setAttribute('data-text-size', textSize)
  if (contrast === 'high') html.setAttribute('data-contrast', 'high')
  else html.removeAttribute('data-contrast')
  if (font === 'easy') html.setAttribute('data-font', 'easy')
  else html.removeAttribute('data-font')
}

// Called at the very top of main.jsx, before React renders anything, so a
// page never paints at the default size first.
export function applyStoredDisplay() {
  apply(stored())
}

function save(key, value) {
  try { write(key, value); return true } catch { return false /* storage unavailable — still applies on this page */ }
}

export function useDisplayPrefs() {
  const [prefs, setPrefs] = useState(stored)

  // Several controls can be on screen at once (and other tabs can change it),
  // so every copy of the hook follows the same stored value.
  useEffect(() => {
    const sync = () => setPrefs(stored())
    window.addEventListener(CHANGE_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => { apply(prefs) }, [prefs])

  const update = useCallback((key, storageKey, value) => {
    const saved = save(storageKey, value)
    setPrefs((p) => ({ ...p, [key]: value }))
    if (saved) window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

  const setTextSize = useCallback((v) => update('textSize', keys.textSize, TEXT_SIZES.includes(v) ? v : 'default'), [update])
  const setHighContrast = useCallback((on) => update('contrast', keys.contrast, on ? 'high' : 'normal'), [update])
  const setEasyFont = useCallback((on) => update('font', keys.font, on ? 'easy' : 'default'), [update])

  return {
    textSize: prefs.textSize,
    highContrast: prefs.contrast === 'high',
    easyFont: prefs.font === 'easy',
    setTextSize,
    setHighContrast,
    setEasyFont,
  }
}
