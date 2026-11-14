import { useEffect, useState } from 'react'
import { tr } from '@/lib/i18n.js'

// Shown while a call to our API has been running for a few seconds (see
// src/lib/apiFetch.js): the free server waking up after a quiet spell, or a
// slow connection. The VolunTrack logo sits inside a spinning ring so it's
// clear the app is still working, not stuck.
function connectionIsSlow() {
  const c = typeof navigator !== 'undefined' ? navigator.connection : null
  if (!c) return false
  return c.saveData === true || ['slow-2g', '2g', '3g'].includes(c.effectiveType) || (typeof c.downlink === 'number' && c.downlink > 0 && c.downlink < 1)
}

export default function SlowServerNotice() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const on = () => setSlow(true)
    const off = () => setSlow(false)
    window.addEventListener('voluntrack:api-slow', on)
    window.addEventListener('voluntrack:api-idle', off)
    return () => {
      window.removeEventListener('voluntrack:api-slow', on)
      window.removeEventListener('voluntrack:api-idle', off)
    }
  }, [])
  if (!slow) return null
  const text = connectionIsSlow()
    ? tr('Your connection is slow. Still loading…')
    : tr('Waking up the server — this can take up to a minute after a quiet spell.')
  return (
    <div role="status" aria-live="polite" className="fixed top-20 left-1/2 -translate-x-1/2 z-[90] w-72 max-w-[calc(100%-2rem)] rounded-2xl border border-white/10 bg-[#0f1813]/95 px-5 py-4 text-sm text-earth-200 text-center shadow-soft flex flex-col items-center gap-3">
      <span className="relative w-16 h-16 shrink-0" aria-hidden="true">
        <span className="absolute inset-0 rounded-full border-[3px] border-brand-400/20 border-t-brand-400 animate-spin motion-reduce:animate-none" />
        <span className="absolute inset-[7px] rounded-full bg-white overflow-hidden flex items-center justify-center">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="" className="w-[42px] h-[42px] object-contain" />
        </span>
      </span>
      <span>{text}</span>
    </div>
  )
}
