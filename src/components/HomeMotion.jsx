import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

// Light motion for the public home page, tied to scrolling: a phone that
// stands up as you scroll, a number that counts up and lines that light up as
// their section passes, all reversing on the way back, plus a floating "Get
// started" button. Scroll listeners throttled to one update per frame, no
// library, and none of it moves for people who ask for reduced motion.

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const clamp = (n) => Math.min(1, Math.max(0, n))

/**
 * How far the page has scrolled through `ref`, 0 to 1, updated on scroll so
 * the motion follows the reader both ways. 0 when the element's top reaches
 * `from` (a share of the screen height), 1 when its bottom reaches `to`.
 * Always 1 with reduced motion.
 */
function useScrollProgress(from = 0.95, to = 0.6) {
  const ref = useRef(null)
  const [p, setP] = useState(0)
  useEffect(() => {
    if (reducedMotion()) { setP(1); return undefined }
    let raf = 0
    const measure = () => {
      raf = 0
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const vh = window.innerHeight
      setP(clamp((vh * from - r.top) / (vh * from - (vh * to - r.height))))
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure) }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); cancelAnimationFrame(raf) }
  }, [from, to])
  return [ref, p]
}

const easeOut = (t) => 1 - (1 - t) ** 3

const LINES = [
  'Paper sign-in sheets get lost.',
  'Hours go unsigned.',
  'Seniors scramble in May.',
  'VolunTrack counts every one.',
]

/**
 * "0 → 100 hours" with the problem lines lighting up after it, both driven by
 * scrolling: the number climbs as the section scrolls up the screen, each line
 * lights at its point, and scrolling back runs it in reverse.
 */
export function HoursStory() {
  const [ref, p] = useScrollProgress()
  const count = Math.round(100 * easeOut(clamp(p / 0.6)))
  const grow = 0.85 + 0.15 * easeOut(clamp(p / 0.6))
  return (
    <section ref={ref} className="mt-24 md:mt-32 text-center max-w-4xl mx-auto" aria-label="Why track your hours">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-brand-600 dark:text-brand-300/80">Service hours, added up</p>
      <p className="mt-4 flex items-baseline justify-center gap-3 md:gap-5 leading-none" aria-label="100 hours" style={{ transform: `scale(${grow})` }}>
        <span aria-hidden="true" className="font-display font-extrabold text-earth-950 dark:text-white text-[6rem] md:text-[10rem] tracking-tight tabular-nums">
          {count}
        </span>
        <span aria-hidden="true" className="font-display italic font-semibold text-brand-600 dark:text-brand-300 text-4xl md:text-6xl">hours</span>
      </p>
      <p className="mt-4 text-lg md:text-xl text-earth-600 dark:text-earth-300">Graduation, NHS and scholarships can ask for this many, or more.</p>
      <div className="mt-12 space-y-2 md:space-y-3">
        {LINES.map((line, i) => (
          <p
            key={line}
            className={`home-light-line text-3xl md:text-5xl font-bold tracking-tight ${i === LINES.length - 1 ? 'home-light-line--brand' : ''} ${p >= 0.62 + i * 0.1 ? 'is-lit' : ''}`}
          >
            {line}
          </p>
        ))}
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
  // Tilted back at the top of the page; it stands up and comes forward as
  // the reader scrolls, and tips back again on the way up.
  const [tilt, setTilt] = useState(0)
  useEffect(() => {
    if (reducedMotion()) { setTilt(1); return undefined }
    let raf = 0
    const measure = () => { raf = 0; setTilt(clamp(window.scrollY / 380)) }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure) }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf) }
  }, [])
  useEffect(() => {
    if (reducedMotion()) return undefined
    const id = setInterval(() => setI((n) => (n + 1) % PHONE_SCREENS.length), 3500)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="hidden md:block home-rise relative mx-auto mt-14 w-[300px] [perspective:1200px]" aria-label="A preview of the VolunTrack app on a phone" role="img">
      <div
        className="relative rounded-[2.75rem] will-change-transform"
        style={{ transform: `rotateX(${(1 - tilt) * 24}deg) scale(${0.9 + tilt * 0.1})`, transformOrigin: '50% 100%' }}
      >
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
      </div>
      <div className="mt-4 flex justify-center gap-1.5" aria-hidden="true">
        {PHONE_SCREENS.map((sc, n) => <span key={sc.file} className={`h-1.5 rounded-full transition-all ${n === i ? 'w-5 bg-brand-400' : 'w-1.5 bg-white/25'}`} />)}
      </div>
    </div>
  )
}
