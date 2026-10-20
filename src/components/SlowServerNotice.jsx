import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { tr } from '@/lib/i18n.js'

// Shown while a call to our API has been running for a few seconds (see
// src/lib/apiFetch.js): usually the free server waking up after a quiet spell.
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
  return (
    <div role="status" aria-live="polite" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[90] max-w-[calc(100%-2rem)] rounded-full border border-white/10 bg-[#0f1813]/95 px-4 py-2 text-sm text-earth-200 shadow-soft flex items-center gap-2">
      <Loader2 className="w-4 h-4 animate-spin shrink-0 text-brand-400" />
      {tr('Waking up the server — this can take up to a minute after a quiet spell.')}
    </div>
  )
}
