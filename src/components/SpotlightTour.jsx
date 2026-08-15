import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { read, write } from '@/lib/storage.js'

const PAD = 8

/**
 * Step-by-step walkthrough that highlights a real on-page element (found via
 * `selector`, matched against a `data-tour="…"` attribute placed on the
 * target) and shows a tooltip describing it. Steps whose target isn't found
 * within a couple seconds (e.g. data still loading) are skipped automatically.
 *
 * `storageKey` gates whether the tour has already been seen — pass a
 * role-specific key (e.g. `voluntrack:tour-seen:student`) so each user type
 * gets its own tour and its own "seen" state.
 */
export default function SpotlightTour({ storageKey, steps }) {
  const [dismissed, setDismissed] = useState(() => read(storageKey, false))
  const [stepIndex, setStepIndex] = useState(0)
  const [rect, setRect] = useState(null)
  const [ready, setReady] = useState(false)
  const retryRef = useRef(null)

  const step = steps[stepIndex]

  const finish = () => {
    write(storageKey, true)
    setDismissed(true)
  }

  // Locate (and keep tracking) the current step's target element.
  useEffect(() => {
    if (dismissed || !step) return undefined
    setReady(false)
    let attempts = 0
    const tryFind = () => {
      const el = document.querySelector(step.selector)
      if (el) {
        // Instant, not smooth: the highlight box's position is measured
        // right after this call, and a smooth scroll wouldn't have settled
        // yet — that raced the highlight onto the previous step's element
        // for the duration of the animation.
        el.scrollIntoView({ behavior: 'instant', block: 'center' })
        setReady(true)
        return true
      }
      return false
    }

    if (tryFind()) return undefined

    // Target may not be mounted yet (data still loading) — poll briefly,
    // then skip to the next step rather than blocking the tour forever.
    retryRef.current = setInterval(() => {
      attempts += 1
      if (tryFind()) {
        clearInterval(retryRef.current)
      } else if (attempts > 10) {
        clearInterval(retryRef.current)
        setStepIndex((i) => (i + 1 < steps.length ? i + 1 : (finish(), i)))
      }
    }, 200)

    return () => clearInterval(retryRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, dismissed])

  // Track the target's position (resize/scroll/DOM changes).
  useEffect(() => {
    if (dismissed || !ready || !step) return undefined
    const update = () => {
      const el = document.querySelector(step.selector)
      if (!el) return
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const observer = new MutationObserver(update)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true })
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      observer.disconnect()
    }
  }, [ready, stepIndex, dismissed])

  if (dismissed || !step || !ready || !rect) return null

  const isLast = stepIndex === steps.length - 1
  const tooltipTop = rect.top + rect.height + PAD + 12 < window.innerHeight - 160
    ? rect.top + rect.height + PAD + 12
    : Math.max(12, rect.top - PAD - 172)

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
      {/* Four bands around the target act as the dimmed backdrop, leaving the
          spotlighted element itself fully visible and clickable. */}
      <div className="fixed bg-black/60" style={{ top: 0, left: 0, right: 0, height: Math.max(0, rect.top - PAD) }} />
      <div className="fixed bg-black/60" style={{ top: rect.top + rect.height + PAD, left: 0, right: 0, bottom: 0 }} />
      <div className="fixed bg-black/60" style={{ top: Math.max(0, rect.top - PAD), left: 0, width: Math.max(0, rect.left - PAD), height: rect.height + PAD * 2 }} />
      <div className="fixed bg-black/60" style={{ top: Math.max(0, rect.top - PAD), left: rect.left + rect.width + PAD, right: 0, height: rect.height + PAD * 2 }} />

      <div
        className="fixed rounded-xl ring-2 ring-brand-400 shadow-[0_0_0_9999px_rgba(0,0,0,0)] pointer-events-none transition-all duration-200"
        style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
      />

      <div
        className="fixed w-full max-w-xs rounded-2xl border border-earth-900 bg-[#0b1620] shadow-2xl p-4 transition-all duration-200"
        style={{ top: tooltipTop, left: Math.min(Math.max(12, rect.left), window.innerWidth - 336) }}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm text-earth-50">{step.title}</h3>
          <button onClick={finish} aria-label="Skip tour" className="text-earth-500 hover:text-earth-200 -mt-1 -mr-1 p-1">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="mt-1.5 text-sm text-earth-300">{step.description}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-earth-500">{stepIndex + 1} / {steps.length}</span>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <button onClick={() => setStepIndex((i) => i - 1)} className="btn-sm btn-ghost">Back</button>
            )}
            <button
              onClick={() => (isLast ? finish() : setStepIndex((i) => i + 1))}
              className="btn-sm btn-primary"
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
