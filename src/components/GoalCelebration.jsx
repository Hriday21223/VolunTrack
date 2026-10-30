import { useEffect, useMemo } from 'react'
import { PartyPopper, Share2, Printer, X } from 'lucide-react'
import { fmtHours } from '@/utils/date.js'
import { tr } from '@/lib/i18n.js'

const COLORS = ['#4ade80', '#facc15', '#60a5fa', '#f472b6', '#fb923c', '#a78bfa']

// Goal reached (#607): a full-screen moment the first time a student meets
// their school's requirement or their own primary goal. Share opens the
// "Share my hours" picture; Print opens the certificate.
export default function GoalCelebration({ celebration, onShare, onPrint, onClose }) {
  const pieces = useMemo(() => Array.from({ length: 48 }, (_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 1.2,
    duration: 2.4 + Math.random() * 1.8,
    color: COLORS[i % COLORS.length],
    rotate: Math.random() * 360,
  })), [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const isRequirement = celebration.kind === 'requirement'
  const heading = isRequirement ? tr('You met your requirement!') : tr('You reached your goal!')
  const detail = isRequirement
    ? (celebration.title
      ? tr('{hours} logged. That’s everything {school} asks for.', { hours: fmtHours(celebration.hours), school: celebration.title })
      : tr('{hours} logged. That’s everything your school asks for.', { hours: fmtHours(celebration.hours) }))
    : tr('{hours} toward “{goal}”.', { hours: fmtHours(celebration.hours), goal: celebration.title || tr('your goal') })

  return (
    <div className="fixed inset-0 z-[110] grid place-items-center bg-black/80 backdrop-blur-sm p-4 overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="goal-celebration-title">
      <div className="confetti" aria-hidden="true">
        {pieces.map((p, i) => (
          <span
            key={i}
            style={{
              left: `${p.left}%`,
              background: p.color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              transform: `rotate(${p.rotate}deg)`,
            }}
          />
        ))}
      </div>
      <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#0f1813] p-6 text-center text-white shadow-soft">
        <button type="button" onClick={onClose} className="absolute right-3 top-3 p-1.5 rounded-lg text-earth-400 hover:text-white hover:bg-white/10" aria-label={tr('Close')}>
          <X className="w-4 h-4" />
        </button>
        <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-brand-500/20 text-brand-300">
          <PartyPopper className="h-8 w-8" />
        </div>
        <h2 id="goal-celebration-title" className="text-2xl font-bold">{heading}</h2>
        <p className="mt-2 text-sm text-earth-300">{detail}</p>
        {isRequirement && celebration.parentsTold && <p className="mt-1 text-xs text-earth-400">{tr('We’ve let your linked parents know.')}</p>}
        <div className="mt-5 grid gap-2">
          <button type="button" className="btn-primary w-full" onClick={onShare}>
            <Share2 className="w-4 h-4" />{' '}{tr('Share my hours')}
          </button>
          <button type="button" className="btn-ghost w-full" onClick={onPrint}>
            <Printer className="w-4 h-4" />{' '}{tr('Print certificate')}
          </button>
        </div>
      </div>
    </div>
  )
}
