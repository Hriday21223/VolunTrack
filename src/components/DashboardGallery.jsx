import { useEffect, useRef, useState } from 'react'

const shot = (file) => `${import.meta.env.BASE_URL}screenshots/${file}`
const screen = (id, label, file, caption, alt) => ({ id, label, desktop: `${file}.webp`, phone: `${file}-phone.webp`, caption, alt })

// Captured with sample data by scripts/capture-landing-screenshots.mjs (the
// parent and volunteer ones against a throwaway backend filled by
// scripts/seed-landing-demo.mjs) — never a real account, never the admin
// panel. Regenerate them when a screen changes noticeably.
//
// The school and organization dashboards are deliberately left out: they are
// what paying customers get, and we don't show that product to competitors.
const ROLES = [
  {
    id: 'student',
    label: 'Student',
    screens: [
      screen('dashboard', 'Dashboard', 'dashboard',
        'Students see their goal, this month’s hours, and badges at a glance.',
        'The VolunTrack student dashboard: 30 hours logged this year, 75% of a 40-hour NHS service goal, 9 of 12 badges earned, and this week’s hours.'),
      screen('log', 'Log Hours', 'student-log',
        'Logging a session takes a minute: what, when, where, and proof.',
        'The Log Hours form: activity and category, date with start and end times, location, notes, and a proof upload.'),
      screen('calendar', 'Calendar', 'student-calendar',
        'Every session on a calendar, so gaps are easy to spot.',
        'A month calendar with logged sessions on their days, such as 4 hours of a Habitat build day and 3 hours of creek cleanup.'),
      screen('achievements', 'Achievements', 'student-achievements',
        'Badges for streaks, milestones, and trying new kinds of service.',
        'The Achievements page: 9 of 12 badges earned, including 3-Day Streak, 10 Hours Completed and Category Explorer, with three still locked.'),
      screen('reports', 'Reports', 'student-reports',
        'Export a PDF or CSV, print a certificate, or submit to school.',
        'The Reports page: 30 total hours across 12 sessions and 7 categories, hours by category, and buttons to download a PDF, export CSV, print a certificate or submit to school.'),
    ],
  },
  {
    id: 'parent',
    label: 'Parent',
    screens: [
      screen('family', 'Family dashboard', 'parent',
        'Parents follow their child’s progress toward the school’s requirement.',
        'The VolunTrack family dashboard: Maya Patel has logged 7 of the 40 hours Lincoln High School requires, with approved and pending entries.'),
    ],
  },
  {
    id: 'volunteer',
    label: 'Volunteer',
    screens: [
      screen('tasks', 'My Tasks', 'volunteer',
        'Organizers post volunteer tasks and see who has signed up.',
        'The task organizer view: three upcoming volunteer tasks with dates, locations, and how many students have signed up.'),
      screen('post', 'Post a task', 'volunteer-post',
        'Posting an opportunity is one short form — no paperwork.',
        'The Post a volunteer opportunity form: title, description, location, important info, phone, date, time and volunteers needed.'),
      screen('signups', 'Sign-ups', 'volunteer-signups',
        'Approve volunteers, then sign off their hours right in VolunTrack.',
        'A task opened to show four volunteers signed up: two approved, two waiting with Approve and Reject buttons.'),
    ],
  },
]

// Arrow keys, Home and End move between a tablist's tabs, and focus follows.
function tabKeyHandler(count, active, select, refs) {
  return (e) => {
    const last = count - 1
    const next = { ArrowRight: active === last ? 0 : active + 1, ArrowLeft: active === 0 ? last : active - 1, Home: 0, End: last }[e.key]
    if (next === undefined) return
    e.preventDefault()
    select(next)
    refs.current[next]?.focus()
  }
}

// Tailwind's `sm` breakpoint, as state: the screen menu is rendered in exactly
// one place (window bar on wider screens, above the frame on phones), so its
// tab ids stay unique and keyboard focus never lands on a hidden copy.
function useWide() {
  const query = '(min-width: 640px)'
  const [wide, setWide] = useState(() => typeof window === 'undefined' || window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = (e) => setWide(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return wide
}

// The landing-page hero's "see it for yourself": a tab per kind of account,
// and inside each, the screens a visitor can click through — like using the
// app, but every view is a screenshot of sample data. Only the screen on show
// is in the page, so the rest download only when someone asks to see them.
// `onRoleChange(roleId)` lets the page follow the visitor's pick — the "How it
// works" section below swaps to that role's steps.
export default function DashboardGallery({ onRoleChange }) {
  const [roleIndex, setRoleIndex] = useState(0)
  const [screenIndex, setScreenIndex] = useState(0)
  const roleTabs = useRef([])
  const screenTabs = useRef([])
  const role = ROLES[roleIndex]
  const current = role.screens[screenIndex]
  const hasMenu = role.screens.length > 1
  const wide = useWide()

  const selectRole = (i) => { setRoleIndex(i); setScreenIndex(0); onRoleChange?.(ROLES[i].id) }
  const onRoleKeys = tabKeyHandler(ROLES.length, roleIndex, selectRole, roleTabs)
  const onScreenKeys = tabKeyHandler(role.screens.length, screenIndex, setScreenIndex, screenTabs)

  const screenMenu = hasMenu && (
    <div role="tablist" aria-label={`${role.label} screens`} onKeyDown={onScreenKeys} className="flex gap-1 overflow-x-auto max-w-full">
      {role.screens.map((s, i) => (
        <button
          key={s.id}
          ref={(el) => { screenTabs.current[i] = el }}
          role="tab"
          id={`screen-tab-${role.id}-${s.id}`}
          aria-selected={i === screenIndex}
          aria-controls="dash-panel"
          tabIndex={i === screenIndex ? 0 : -1}
          onClick={() => setScreenIndex(i)}
          className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition ${
            i === screenIndex ? 'bg-white/15 text-white' : 'text-earth-400 hover:text-white'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  )

  return (
    <figure data-animate className="mt-12 md:mt-16 max-w-5xl mx-auto">
      <div className="flex justify-center mb-4">
        <div role="tablist" aria-label="Who it's for" onKeyDown={onRoleKeys} className="flex gap-1 overflow-x-auto max-w-full rounded-full border border-white/10 bg-black/30 p-1">
          {ROLES.map((r, i) => (
            <button
              key={r.id}
              ref={(el) => { roleTabs.current[i] = el }}
              role="tab"
              id={`role-tab-${r.id}`}
              aria-selected={i === roleIndex}
              tabIndex={i === roleIndex ? 0 : -1}
              onClick={() => selectRole(i)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition ${
                i === roleIndex ? 'bg-brand-600 text-white' : 'text-earth-300 hover:text-white'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* On phones the window bar is hidden, so the screen menu sits above the
          frame. The row keeps its height for a one-screen role, so switching
          roles never moves the picture. */}
      {!wide && <div className="max-w-[280px] mx-auto mb-2 h-7">{screenMenu}</div>}

      <div
        id="dash-panel"
        role="tabpanel"
        aria-labelledby={hasMenu ? `screen-tab-${role.id}-${current.id}` : `role-tab-${role.id}`}
        className="max-w-[280px] sm:max-w-none mx-auto rounded-[1.75rem] sm:rounded-2xl border border-white/10 bg-black/40 shadow-2xl shadow-black/40 overflow-hidden"
      >
        <div className="hidden sm:flex items-center gap-3 px-4 h-10 border-b border-white/10 bg-white/5">
          <div className="flex items-center gap-1.5 shrink-0" aria-hidden="true">
            <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
            <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
            <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
          </div>
          {wide && screenMenu}
        </div>
        {/* Phones get the phone layout — a desktop shot shrunk to 280px is unreadable. */}
        <picture key={`${role.id}-${current.id}`}>
          <source media="(max-width: 639px)" srcSet={shot(current.phone)} width="780" height="1520" />
          <img
            src={shot(current.desktop)}
            alt={current.alt}
            width="1920"
            height="1200"
            loading="lazy"
            decoding="async"
            className="block w-full h-auto"
          />
        </picture>
      </div>
      <figcaption className="mt-3 text-center text-sm text-earth-400" aria-live="polite">
        {current.caption}
        {hasMenu && <span className="block text-xs text-earth-500 mt-1">Click the screens above to look around — this is a preview with sample data.</span>}
      </figcaption>
    </figure>
  )
}
