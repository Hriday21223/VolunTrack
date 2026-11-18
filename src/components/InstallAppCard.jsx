import { useEffect, useState } from 'react'
import { Smartphone, Share, PlusSquare, X } from 'lucide-react'
import { isNativeApp } from '@/lib/platform.js'
import { canPromptInstall, onInstallChange, promptInstall, isStandalone, phoneKind, DISMISS_KEY } from '@/lib/installPrompt.js'
import { tr } from '@/lib/i18n.js'

// "Install VolunTrack on your phone" (#936): phones only, in the browser only
// (not the store app, not once added to the home screen), until dismissed.
export default function InstallAppCard() {
  const [, bump] = useState(0)
  const [hidden, setHidden] = useState(() => {
    try { return Boolean(localStorage.getItem(DISMISS_KEY)) } catch { return false }
  })
  useEffect(() => onInstallChange(() => bump((n) => n + 1)), [])

  const kind = phoneKind()
  if (hidden || isNativeApp || isStandalone() || !kind) return null
  if (kind === 'android' && !canPromptInstall()) return null

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, 'dismissed') } catch { /* */ }
    setHidden(true)
  }
  const install = async () => {
    const outcome = await promptInstall()
    if (outcome === 'accepted') dismiss()
    else bump((n) => n + 1)
  }

  return (
    <div className="relative rounded-2xl border border-brand-500/30 bg-brand-500/10 p-4 text-sm">
      <button type="button" onClick={dismiss} aria-label={tr('Not now')} className="absolute right-2 top-2 p-1.5 text-earth-400 hover:text-earth-200">
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
      <p className="font-medium flex items-center gap-2 pr-8"><Smartphone className="w-4 h-4" aria-hidden="true" /> {tr('Put VolunTrack on your home screen')}</p>
      <p className="text-earth-600 dark:text-earth-300 mt-1">{tr('It opens like an app, full screen, and works without internet.')}</p>
      {kind === 'android' ? (
        <button type="button" onClick={install} className="btn-primary btn-sm mt-3">{tr('Install')}</button>
      ) : (
        <ol className="mt-2 space-y-1 text-earth-600 dark:text-earth-300">
          <li className="flex items-center gap-2">1. {tr('Tap the Share button')} <Share className="w-4 h-4" aria-hidden="true" /></li>
          <li className="flex items-center gap-2">2. {tr('Choose Add to Home Screen')} <PlusSquare className="w-4 h-4" aria-hidden="true" /></li>
        </ol>
      )}
    </div>
  )
}
