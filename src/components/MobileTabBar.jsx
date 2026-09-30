import { NavLink, useLocation, useSearchParams, Link } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import { Home, Clock, Calendar, Trophy, FileText, User, Settings, Plus, Shield, HelpCircle, ClipboardList, ClipboardCheck, School, Activity, MapPin, X, ChevronRight } from 'lucide-react'
import { cn } from '@/utils/cn.js'
import { useAuth } from '@/hooks/useAuth.jsx'
import { isNativeApp, APP_BACK_EVENT } from '@/lib/platform.js'

// Labels here match Sidebar.jsx exactly (same route, same label) so the
// nav doesn't appear to rename itself between desktop and mobile. "Log"
// also lives in the floating FAB below for quick access, but still gets a
// labeled entry here since the FAB alone has no room for text.
const CORE_ITEMS = {
  student: [
    { to: '/',             label: 'Dashboard',     icon: Home },
    { to: '/opportunities', label: 'Opportunities', icon: MapPin },
    { to: '/log',          label: 'Log Hours',           icon: Clock },
    { to: '/profile',      label: 'Profile',       icon: User },
    { to: '/settings',     label: 'Settings',      icon: Settings },
  ],
  volunteer: [
    { to: '/my-tasks',     label: 'Tasks',     icon: ClipboardList },
  ],
  school: [
    { to: '/school/dashboard', label: 'School', icon: School },
    { to: '/profile',      label: 'Profile',   icon: User },
    { to: '/settings',     label: 'Settings',  icon: Settings },
  ],
  admin: [
    { to: '/',             label: 'Dashboard', icon: Home },
    { to: '/admin',        label: 'Admin',     icon: Shield },
    { to: '/log',          label: 'Log Hours',       icon: Clock },
    { to: '/profile',      label: 'Profile',   icon: User },
    { to: '/settings',     label: 'Settings',  icon: Settings },
  ],
  parent: [
    { to: '/parent',       label: 'Dashboard', icon: Home },
    { to: '/settings',     label: 'Settings',  icon: Settings },
  ],
  org: [
    { to: '/organization/dashboard', label: 'Dashboard', icon: Home },
    { to: '/profile',      label: 'Profile',   icon: User },
    { to: '/settings',     label: 'Settings',  icon: Settings },
  ],
}
CORE_ITEMS.school_staff = CORE_ITEMS.school

const MORE_ITEMS = {
  student: [
    { to: '/calendar',     label: 'Calendar',      icon: Calendar },
    { to: '/achievements', label: 'Achievements',  icon: Trophy },
    { to: '/reports',      label: 'Reports',       icon: FileText },
    { to: '/help',         label: 'Help',          icon: HelpCircle },
    { to: '/status',       label: 'System Status', icon: Activity },
  ],
  volunteer: [
    { to: '/',             label: 'Dashboard',     icon: Home },
    { to: '/attendance',   label: 'Attendance',    icon: ClipboardCheck },
    { to: '/log',          label: 'Log Hours',     icon: Clock },
    { to: '/profile',      label: 'Profile',       icon: User },
    { to: '/settings',     label: 'Settings',      icon: Settings },
    { to: '/calendar',     label: 'Calendar',      icon: Calendar },
    { to: '/achievements', label: 'Achievements',  icon: Trophy },
    { to: '/reports',      label: 'Reports',       icon: FileText },
    { to: '/help',         label: 'Help',          icon: HelpCircle },
    { to: '/status',       label: 'System Status', icon: Activity },
  ],
  school: [
    { to: '/help',         label: 'Help',          icon: HelpCircle },
    { to: '/status',       label: 'System Status', icon: Activity },
  ],
  admin: [
    { to: '/calendar',     label: 'Calendar',      icon: Calendar },
    { to: '/reports',      label: 'Reports',       icon: FileText },
    { to: '/help',         label: 'Help',          icon: HelpCircle },
    { to: '/status',       label: 'System Status', icon: Activity },
  ],
  parent: [
    { to: '/help',         label: 'Help',     icon: HelpCircle },
  ],
  org: [
    { to: '/help',         label: 'Help',          icon: HelpCircle },
    { to: '/status',       label: 'System Status', icon: Activity },
  ],
}
MORE_ITEMS.school_staff = MORE_ITEMS.school

// Inside the apps the tab bar uses app-style names, keeps Log Hours only as
// the raised centre button, and moves Settings into the More sheet (where
// apps keep it) to make room.
const NATIVE_LABELS = { Dashboard: 'Home', Opportunities: 'Events', Profile: 'Me' }
function nativeTabs(core, more) {
  const settings = core.find((i) => i.to === '/settings')
  const tabs = core
    .filter((i) => i.to !== '/settings' && i.to !== '/log')
    .map((i) => ({ ...i, label: NATIVE_LABELS[i.label] || i.label }))
  const sheet = [...(settings ? [settings] : []), ...more.filter((i) => i.to !== '/log')]
  return { tabs, sheet }
}

const NO_KEYBOARD_INPUTS = new Set(['checkbox', 'radio', 'file', 'date', 'time', 'datetime-local', 'month', 'week', 'color', 'range', 'button', 'submit', 'reset', 'image', 'hidden'])
function opensKeyboard(el) {
  if (!el) return false
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true
  return el.tagName === 'INPUT' && !NO_KEYBOARD_INPUTS.has(el.type)
}

export default function MobileTabBar() {
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const [moreOpen, setMoreOpen] = useState(false)
  const sheetRef = useRef(null)
  const role = user?.role || 'student'
  const baseCore = CORE_ITEMS[role] || CORE_ITEMS.student
  const baseMore = MORE_ITEMS[role] || MORE_ITEMS.student
  const native = isNativeApp ? nativeTabs(baseCore, baseMore) : null
  const coreItems = native ? native.tabs : baseCore
  const moreItems = native ? native.sheet : baseMore
  const showLogFab = !!user && role !== 'parent'

  const isActive = (to) => {
    if (to.includes('?')) {
      const [path, query] = to.split('?')
      const params = new URLSearchParams(query)
      const pathMatch = path === '/' ? pathname === '/' : pathname.startsWith(path)
      if (!pathMatch) return false
      for (const [key, val] of params) {
        if (searchParams.get(key) !== val) return false
      }
      return true
    }
    return to === '/' ? pathname === '/' : pathname.startsWith(to)
  }

  const moreActive = moreItems.some((item) => isActive(item.to))

  useEffect(() => {
    if (moreOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [moreOpen])

  // Android's Back button closes the sheet rather than leaving the page.
  useEffect(() => {
    if (!moreOpen) return
    const onBack = (e) => { e.preventDefault(); setMoreOpen(false) }
    window.addEventListener(APP_BACK_EVENT, onBack)
    return () => window.removeEventListener(APP_BACK_EVENT, onBack)
  }, [moreOpen])

  // In the apps the WebView shrinks to make room for the keyboard, which
  // carries this fixed bar up on top of it — over the very field being typed
  // in. So the bar steps aside while a text field has focus. (Date, time and
  // select fields open a dialog, not the keyboard, so they don't count.)
  const [typing, setTyping] = useState(false)
  useEffect(() => {
    if (!isNativeApp) return
    const update = () => setTyping(opensKeyboard(document.activeElement))
    const onFocusOut = () => setTimeout(update, 0)
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) setMoreOpen(false)
  }

  // Logged-out visitors get no bottom nav — its icons all point at
  // <Protected> routes that would just bounce them back to /login, and it
  // was covering the login/register/reset forms with no clearance for it.
  // (Placed after all hooks above so hook call order stays unconditional.)
  function renderMoreSheet() {
    return (
        <div
          className={cn('fixed inset-0 z-50 bg-black/50 backdrop-blur-sm', !native && 'md:hidden')}
          onClick={handleBackdropClick}
        >
          <div
            ref={sheetRef}
            className="absolute bottom-0 inset-x-0 bg-white dark:bg-[#1a1a1a] rounded-t-[1.75rem] border-t border-earth-200/50 dark:border-white/10 shadow-2xl max-h-[70vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white/80 dark:bg-[#1a1a1a]/80 backdrop-blur-xl border-b border-earth-200/50 dark:border-white/10 px-5 py-4 flex items-center justify-between z-10">
              <h3 className="font-display font-semibold text-lg">More</h3>
              <button
                onClick={() => setMoreOpen(false)}
                className="w-8 h-8 rounded-full bg-earth-100 dark:bg-white/10 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="p-3 pb-8">
              {moreItems.map(({ to, label, icon: Icon }) => {
                const active = isActive(to)
                return (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-150',
                      active
                        ? 'bg-brand-500/10 text-brand-600 dark:text-brand-400'
                        : 'text-earth-700 dark:text-earth-300 hover:bg-earth-100 dark:hover:bg-white/5',
                    )}
                  >
                    <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 2} />
                    <span className="font-medium text-sm flex-1">{label}</span>
                    <ChevronRight className="w-4 h-4 opacity-40" />
                  </NavLink>
                )
              })}
            </nav>
          </div>
        </div>
    )
  }

  if (!user) return null

  const moreButton = (
    <button
      onClick={() => setMoreOpen(true)}
      className={cn(
        'flex w-full flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium',
        moreActive ? 'text-brand-400' : 'text-earth-400',
      )}
    >
      <div className="flex h-6 w-6 flex-col items-center justify-center gap-1">
        <span className="block h-0.5 w-5 rounded-full bg-current" />
        <span className="block h-0.5 w-5 rounded-full bg-current" />
        <span className="block h-0.5 w-5 rounded-full bg-current" />
      </div>
      More
    </button>
  )

  if (native) {
    if (typing) return null
    const tabLink = ({ to, label, icon: Icon }) => {
      const active = isActive(to)
      return (
        <li key={to}>
          <NavLink
            to={to}
            end={to === '/'}
            className={cn(
              'flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium',
              active ? 'text-brand-400' : 'text-earth-400',
            )}
          >
            <Icon className="h-6 w-6" strokeWidth={active ? 2.4 : 1.8} />
            {label}
          </NavLink>
        </li>
      )
    }
    // The raised Log button sits in the middle slot.
    const half = Math.ceil(coreItems.length / 2)
    const columns = coreItems.length + 1 + (showLogFab ? 1 : 0)
    return (
      <>
        <nav
          className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#0b161c]/95 backdrop-blur-xl"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <ul className="grid items-end px-2" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
            {coreItems.slice(0, half).map(tabLink)}
            {showLogFab && (
              <li className="flex justify-center">
                <Link
                  to="/log"
                  aria-label="Log hours"
                  className="-mt-5 mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lg shadow-brand-900/60 ring-4 ring-[#0b161c] active:scale-90 transition-transform"
                >
                  <Plus className="h-7 w-7" strokeWidth={2.6} />
                </Link>
              </li>
            )}
            {coreItems.slice(half).map(tabLink)}
            <li>{moreButton}</li>
          </ul>
        </nav>
        {moreOpen && renderMoreSheet()}
      </>
    )
  }

  return (
    <>
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-4 mb-4 rounded-[1.5rem] bg-white/80 dark:bg-[#1a1a1a]/80 backdrop-blur-xl border border-earth-200/50 dark:border-white/10 shadow-2xl shadow-black/5 dark:shadow-black/20">
          <ul className="grid px-1 pt-1" style={{ gridTemplateColumns: `repeat(${coreItems.length + 1}, 1fr)` }}>
            {coreItems.map(({ to, label, icon: Icon }) => {
              const active = isActive(to)
              return (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={to === '/'}
                    className={cn(
                      'flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium relative transition-all duration-200',
                      active
                        ? 'text-brand-600 dark:text-brand-400 scale-105'
                        : 'text-earth-500 dark:text-earth-400 hover:text-earth-800 dark:hover:text-earth-200',
                    )}
                  >
                    {active && (
                      <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-4 h-1 rounded-full bg-brand-500 dark:bg-brand-400" />
                    )}
                    <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 2} />
                    {label}
                  </NavLink>
                </li>
              )
            })}
            <li>
              <button
                onClick={() => setMoreOpen(true)}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium relative transition-all duration-200 w-full',
                  moreActive
                    ? 'text-brand-600 dark:text-brand-400 scale-105'
                    : 'text-earth-500 dark:text-earth-400 hover:text-earth-800 dark:hover:text-earth-200',
                )}
              >
                {moreActive && (
                  <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-4 h-1 rounded-full bg-brand-500 dark:bg-brand-400" />
                )}
                <div className="w-5 h-5 flex flex-col items-center justify-center gap-0.5">
                  <span className="block w-4 h-0.5 rounded-full bg-current" />
                  <span className="block w-4 h-0.5 rounded-full bg-current" />
                  <span className="block w-4 h-0.5 rounded-full bg-current" />
                </div>
                More
              </button>
            </li>
          </ul>
        </div>
        {showLogFab && (
          <Link
            to="/log"
            className="absolute -top-10 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lg shadow-brand-500/40 flex items-center justify-center active:scale-90 transition-transform"
          >
            <Plus className="w-6 h-6" strokeWidth={3} />
          </Link>
        )}
      </nav>

      {moreOpen && renderMoreSheet()}
    </>
  )
}
