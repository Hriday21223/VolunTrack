import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { tr } from '@/lib/i18n.js'

// A volunteer's own check-in PIN for one event (#668), for the organizer's
// kiosk. Hidden until tapped, so it isn't on screen for anyone looking over.
export default function KioskPinChip({ pin, className = '' }) {
  const [shown, setShown] = useState(false)
  if (!pin) return null
  return (
    <button type="button" onClick={() => setShown(!shown)} className={`inline-flex items-center gap-1.5 text-xs rounded-full border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 ${className}`}
      aria-label={shown ? tr('Check-in PIN {pin}', { pin }) : tr('Show my check-in PIN')}>
      <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
      {shown ? <><span>{tr('Check-in PIN:')}</span> <strong className="tracking-widest">{pin}</strong> <span className="text-earth-500">{tr('· don’t share it')}</span></> : tr('Show my check-in PIN')}
    </button>
  )
}
