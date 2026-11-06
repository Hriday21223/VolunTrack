import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

// Light motion for the public home page: a number that counts up when it
// scrolls into view, lines that light up one after another, and a floating
// "Get started" button. Plain CSS and one requestAnimationFrame loop, no
// library, and none of it moves for people who ask for reduced motion.

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Calls `onSeen` once, the first time `ref` is at least `threshold` on screen. */
function useSeenOnce(threshold = 0.4) {
  const ref = useRef(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return undefined
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return undefined }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect() } }, { threshold })
    io.observe(el)
    return () => io.disconnect()
  }, [seen, threshold])
  return [ref, seen]
}

function CountUp({ to, start, ms = 1600 }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!start) return undefined
    if (reducedMotion()) { setN(to); return undefined }
    let raf = 0
    const t0 = performance.now()
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / ms)
      setN(Math.round(to * (1 - (1 - p) ** 3))) // ease-out
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [start, to, ms])
  return <span className="tabular-nums">{n}</span>
}

const LINES = [
  'Paper sign-in sheets get lost.',
  'Hours go unsigned.',
  'Seniors scramble in May.',
]

/** "0 → 100 hours" with the problem lines lighting up after it. */
export function HoursStory() {
  const [ref, seen] = useSeenOnce(0.35)
  return (
    <section ref={ref} className="mt-24 md:mt-32 text-center max-w-4xl mx-auto" aria-label="Why track your hours">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-brand-600 dark:text-brand-300/80">Service hours, added up</p>
      <p className="mt-4 flex items-baseline justify-center gap-3 md:gap-5 leading-none" aria-label="100 hours">
        <span aria-hidden="true" className="font-display font-extrabold text-earth-950 dark:text-white text-[6rem] md:text-[10rem] tracking-tight">
          <CountUp to={100} start={seen} />
        </span>
        <span aria-hidden="true" className="font-display italic font-semibold text-brand-600 dark:text-brand-300 text-4xl md:text-6xl">hours</span>
      </p>
      <p className="mt-4 text-lg md:text-xl text-earth-600 dark:text-earth-300">Graduation, NHS and scholarships can ask for this many, or more.</p>
      <div className="mt-12 space-y-2 md:space-y-3">
        {LINES.map((line, i) => (
          <p
            key={line}
            className={`home-light-line text-3xl md:text-5xl font-bold tracking-tight ${seen ? 'is-lit' : ''}`}
            style={{ transitionDelay: `${700 + i * 450}ms` }}
          >
            {line}
          </p>
        ))}
        <p
          className={`home-light-line text-3xl md:text-5xl font-bold tracking-tight home-light-line--brand ${seen ? 'is-lit' : ''}`}
          style={{ transitionDelay: `${700 + LINES.length * 450 + 200}ms` }}
        >
          VolunTrack counts every one.
        </p>
      </div>
    </section>
  )
}

/**
 * A "Get started" pill pinned to the bottom of the screen once the hero's own
 * buttons have scrolled away, and hidden again while `hideNearRef` (the closing
 * call to action) is on screen, so there are never two at once.
 */
export function FloatingStart({ heroRef, hideNearRef }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    let raf = 0
    // Shown once the hero's buttons are above the screen, hidden from the
    // moment the closing call to action reaches the screen to the very end.
    const check = () => {
      raf = 0
      const hero = heroRef?.current?.getBoundingClientRect()
      const end = hideNearRef?.current?.getBoundingClientRect()
      setShow(Boolean(hero && hero.bottom < 0 && (!end || end.top > window.innerHeight)))
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(check) }
    check()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); cancelAnimationFrame(raf) }
  }, [heroRef, hideNearRef])
  return (
    <div
      className={`home-float fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 pointer-events-none ${show ? 'is-shown' : ''}`}
      aria-hidden={!show}
    >
      <Link
        to="/register"
        tabIndex={show ? 0 : -1}
        className="pointer-events-auto inline-flex items-center gap-3 rounded-full border border-white/10 bg-[#0f1a14]/90 backdrop-blur pl-2 pr-2 py-2 shadow-2xl"
      >
        <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="" className="w-8 h-8 rounded-full object-contain" />
        <span className="text-sm text-white font-semibold leading-tight text-left">
          VolunTrack<span className="block text-[0.6875rem] font-normal text-earth-400">Free for students</span>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white">
          Get started <ArrowRight className="w-4 h-4" />
        </span>
      </Link>
    </div>
  )
}

const PHONE_SCREENS = [
  { file: 'dashboard-phone.webp', alt: 'The VolunTrack student dashboard on a phone: hours this year, progress toward a 40-hour goal, and badges.' },
  { file: 'student-log-phone.webp', alt: 'Logging hours on a phone: activity, date and times, place and proof.' },
  { file: 'student-opportunities-phone.webp', alt: 'Volunteer opportunities near you on a phone, each with its date, place and spots left.' },
]

/**
 * A phone that rises in under the hero and shows the app, switching screens
 * every few seconds. Tablets and computers only: on a phone the gallery right
 * below already shows these screens full size. Sample data, never a real account.
 */
export function PhonePreview() {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (reducedMotion()) return undefined
    const id = setInterval(() => setI((n) => (n + 1) % PHONE_SCREENS.length), 3500)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="hidden md:block home-rise relative mx-auto mt-14 w-[300px]" aria-label="A preview of the VolunTrack app on a phone" role="img">
      <div className="relative rounded-[2.75rem] border-[10px] border-[#101a14] bg-[#101a14] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.6)] ring-1 ring-white/10 overflow-hidden h-[520px]">
        <div className="absolute left-1/2 top-2 z-10 h-6 w-24 -translate-x-1/2 rounded-full bg-black" aria-hidden="true" />
        {PHONE_SCREENS.map((sc, n) => (
          <img
            key={sc.file}
            src={`${import.meta.env.BASE_URL}screenshots/${sc.file}`}
            alt={n === i ? sc.alt : ''}
            width="780"
            height="1520"
            loading={n === 0 ? 'eager' : 'lazy'}
            className={`absolute inset-x-0 top-8 bottom-0 h-[calc(100%-2rem)] w-full object-cover object-top transition-opacity duration-700 ${n === i ? 'opacity-100' : 'opacity-0'}`}
          />
        ))}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#101a14] to-transparent" aria-hidden="true" />
      </div>
      <div className="mt-4 flex justify-center gap-1.5" aria-hidden="true">
        {PHONE_SCREENS.map((sc, n) => <span key={sc.file} className={`h-1.5 rounded-full transition-all ${n === i ? 'w-5 bg-brand-400' : 'w-1.5 bg-white/25'}`} />)}
      </div>
    </div>
  )
}
