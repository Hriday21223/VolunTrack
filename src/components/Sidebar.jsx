import { Home, Clock, Calendar, Trophy, FileText, User, Settings, Shield, HelpCircle, Sparkles, Star, ClipboardList, ClipboardCheck, School, Activity, Users, MapPin, ShieldCheck, Megaphone, Download, Handshake, UserPlus } from 'lucide-react'
import { schoolLock } from '@/lib/schoolLock.js'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { cn } from '@/utils/cn.js'
import { useAuth } from '@/hooks/useAuth.jsx'
import { tr } from '@/lib/i18n.js'
import LanguagePicker from '@/components/LanguagePicker.jsx'
import { OPERATOR_NAME } from '@/lib/business.js'
import { useWhatsNewDot } from '@/hooks/useWhatsNewDot.js'

// The sections of the school and organization dashboards, each its own menu
// entry like a student's pages. The address picks the tab (dashboardTabs.js);
// `home` also counts the dashboard's plain address, and `tour` is what their
// welcome tours point at on a computer.
const SCHOOL_BASE = '/school/dashboard'
const ORG_BASE = '/organization/dashboard'
const SCHOOL_SECTIONS = [
  { to: SCHOOL_BASE, section: `${SCHOOL_BASE}/reports`, home: true, label: 'Reports', icon: FileText, tour: 'tab-reports' },
  { to: `${SCHOOL_BASE}/students`, section: `${SCHOOL_BASE}/students`, label: 'Students', icon: Users, tour: 'tab-students' },
  { to: `${SCHOOL_BASE}/volunteer`, section: `${SCHOOL_BASE}/volunteer`, label: 'Volunteer', icon: ClipboardList },
  { to: `${SCHOOL_BASE}/setup`, section: `${SCHOOL_BASE}/setup`, label: 'School setup', icon: ShieldCheck, tour: 'tab-staff', mainAdminOnly: true },
  { to: `${SCHOOL_BASE}/messages`, section: `${SCHOOL_BASE}/messages`, label: 'Announcements', icon: Megaphone, tour: 'tab-chat' },
]
const ORG_SECTIONS = [
  { to: ORG_BASE, section: `${ORG_BASE}/schools`, home: true, label: 'Schools', icon: School, tour: 'org-schools-tab' },
  { to: `${ORG_BASE}/hours`, section: `${ORG_BASE}/hours`, label: 'Hours', icon: Download },
  { to: `${ORG_BASE}/requirements`, section: `${ORG_BASE}/requirements`, label: 'Requirements', icon: ClipboardList },
  { to: `${ORG_BASE}/partners`, section: `${ORG_BASE}/partners`, label: 'Partners', icon: Handshake, tour: 'org-partners-tab' },
  { to: `${ORG_BASE}/announcements`, section: `${ORG_BASE}/announcements`, label: 'Announcements', icon: Megaphone },
  { to: `${ORG_BASE}/invites`, section: `${ORG_BASE}/invites`, label: 'Invites', icon: UserPlus, tour: 'org-invites-tab' },
]

// A locked school sees only the payment screen, so it keeps the single entry.
function menuFor(user, role) {
  const items = ROLE_ITEMS[role] || ROLE_ITEMS.student
  if (role === 'org') return [...ORG_SECTIONS, ...items.filter((i) => i.to !== ORG_BASE)]
  if (role !== 'school' && role !== 'school_staff') return items
  const locked = Boolean(schoolLock(user))
  if (locked) return items
  return [
    ...SCHOOL_SECTIONS.filter((i) => !i.mainAdminOnly || role === 'school'),
    ...items.filter((i) => i.to !== SCHOOL_BASE),
  ]
}

const ROLE_ITEMS = {
  student: [
    { to: '/',             label: 'Dashboard',   icon: Home },
    { to: '/opportunities', label: 'Opportunities', icon: MapPin },
    { to: '/log',          label: 'Log Hours',   icon: Clock },
    { to: '/attendance',   label: 'Attendance',  icon: ClipboardCheck },
    { to: '/calendar',     label: 'Calendar',    icon: Calendar },
    { to: '/achievements', label: 'Achievements', icon: Trophy },
    { to: '/reports',      label: 'Reports',     icon: FileText },
    { to: '/profile',      label: 'Profile',     icon: User },
    { to: '/settings',     label: 'Settings',    icon: Settings },
    { to: '/help',         label: 'Help',        icon: HelpCircle },
    { to: '/whats-new',    label: "What's new", icon: Sparkles },
    { to: '/review',       label: 'Review us',  icon: Star },
    { to: '/status',       label: 'System Status',      icon: Activity },
  ],
  // An account that runs events, not one that tracks its own volunteering:
  // organizers log hours for their team from inside My Tasks. Log Hours,
  // Calendar, Achievements and Reports are student pages (roleAccess.js).
  volunteer: [
    { to: '/my-tasks',     label: 'My Tasks',    icon: ClipboardList },
    { to: '/profile',      label: 'Profile',     icon: User },
    { to: '/settings',     label: 'Settings',    icon: Settings },
    { to: '/help',         label: 'Help',             icon: HelpCircle },
    { to: '/whats-new',    label: "What's new", icon: Sparkles },
    { to: '/review',       label: 'Review us',  icon: Star },
    { to: '/status',       label: 'System Status',           icon: Activity },
  ],
  // A school account never logs its own hours, so the personal Dashboard /
  // Log Hours / Calendar / Reports entries don't apply — the school's own
  // reporting lives inside School Dashboard. Mirrors the org list below.
  school: [
    { to: '/school/dashboard', label: 'School Dashboard', icon: School },
    { to: '/profile',      label: 'Profile',          icon: User },
    { to: '/settings',     label: 'Settings',         icon: Settings },
    { to: '/help',         label: 'Help',             icon: HelpCircle },
    { to: '/whats-new',    label: "What's new", icon: Sparkles },
    { to: '/review',       label: 'Review us',  icon: Star },
    { to: '/status',       label: 'System Status',           icon: Activity },
  ],
  admin: [
    { to: '/',             label: 'Dashboard',   icon: Home },
    { to: '/admin',        label: 'Admin',       icon: Shield },
    { to: '/log',          label: 'Log Hours',   icon: Clock },
    { to: '/calendar',     label: 'Calendar',    icon: Calendar },
    { to: '/reports',      label: 'Reports',     icon: FileText },
    { to: '/profile',      label: 'Profile',     icon: User },
    { to: '/settings',     label: 'Settings',    icon: Settings },
    { to: '/help',         label: 'Help',             icon: HelpCircle },
    { to: '/whats-new',    label: "What's new", icon: Sparkles },
    { to: '/review',       label: 'Review us',  icon: Star },
    { to: '/status',       label: 'System Status',           icon: Activity },
  ],
  parent: [
    { to: '/parent',       label: 'Dashboard',  icon: Home },
    { to: '/settings',     label: 'Settings',   icon: Settings },
    { to: '/help',         label: 'Help',       icon: HelpCircle },
    { to: '/whats-new',    label: "What's new", icon: Sparkles },
    { to: '/review',       label: 'Review us',  icon: Star },
  ],
  org: [
    { to: '/organization/dashboard', label: 'Dashboard', icon: Home },
    { to: '/my-tasks',     label: 'Events',           icon: ClipboardList },
    { to: '/profile',      label: 'Profile',          icon: User },
    { to: '/settings',     label: 'Settings',         icon: Settings },
    { to: '/help',         label: 'Help',             icon: HelpCircle },
    { to: '/whats-new',    label: "What's new", icon: Sparkles },
    { to: '/review',       label: 'Review us',  icon: Star },
    { to: '/status',       label: 'System Status',           icon: Activity },
  ],
}
ROLE_ITEMS.school_staff = ROLE_ITEMS.school

// The default blurb describes device-local hour tracking, which is only true
// for accounts that log their own hours. An institution or parent account
// stores everything server-side, so it gets copy that matches what it holds.
const STORAGE_NOTE = {
  school: tr("Your students' uploads and hour records are stored on our servers, visible only to your school's admins and co-admins."),
  org: tr("Your organization's schools, invites and billing records are stored on our servers."),
  parent: tr("Your linked children's hour records are stored on our servers so you can follow their progress."),
}
STORAGE_NOTE.school_staff = STORAGE_NOTE.school
// Students and volunteers: a signed-in account keeps its hours on our servers
// (synced to every device); an account that exists only on this device
// (no server connection when it was made) keeps them here.
const ACCOUNT_STORAGE_NOTE = tr('Your hours are saved to your account and synced across your devices. A copy stays on this device so the app works offline.')
const DEVICE_STORAGE_NOTE = tr('This account and its hours are stored only on this device.')

// The school's own logo and colour (#930), from School setup → Branding, so
// the app feels like theirs. Only logos the server accepted (http(s) or a
// small data image) and plain hex colours are drawn.
function SchoolBadge({ user }) {
  if (!user?.schoolName || !(user.schoolLogoUrl || user.schoolBrandColor)) return null
  const logo = /^(https?:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(user.schoolLogoUrl || '') ? user.schoolLogoUrl : null
  const color = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(user.schoolBrandColor || '') ? user.schoolBrandColor : null
  return (
    <div className="mt-4 flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2" style={color ? { borderLeft: `4px solid ${color}` } : undefined}>
      {logo && <img src={logo} alt="" className="h-7 w-7 rounded object-contain bg-white" />}
      <span className="text-sm font-medium truncate">{user.schoolName}</span>
    </div>
  )
}

export default function Sidebar() {
  const { user } = useAuth()
  const unseen = useWhatsNewDot()
  const role = user?.role || 'student'
  const items = menuFor(user, role)
  const { pathname } = useLocation()

  return (
    <aside className="hidden md:flex md:flex-col w-72 shrink-0 border-r border-earth-900/80 bg-[#06141a] text-earth-200 sticky top-[var(--test-banner,0px)] h-[calc(100vh-var(--test-banner,0px))]">
      <div className="px-6 py-6">
        <div className="flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="" className="w-11 h-11 object-contain" />
          <div>
            <div className="font-display font-bold text-lg leading-none">VolunTrack</div>
            <div className="text-xs text-earth-400 mt-0.5">{tr('Volunteer hour tracker')}</div>
          </div>
        </div>
        <SchoolBadge user={user} />
      </div>

      <nav className="px-4 py-3 flex-1 space-y-1">
        {items.map(({ to, label, icon: Icon, section, home, tour }) => (
          <NavLink
            key={to}
            to={to}
            data-tour={tour || `nav${to.replace(/\//g, '-')}`}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium transition',
                (section ? (home && pathname === to) || pathname.startsWith(section) : isActive)
                  ? 'bg-brand-700/10 text-white shadow-sm shadow-brand-500/10'
                  : 'text-earth-300 hover:bg-white/5 hover:text-white',
              )
            }
          >
            <Icon className="w-4 h-4" />
            {tr(label)}
            {to === '/whats-new' && unseen && <span className="ml-auto w-2 h-2 rounded-full bg-brand-400" aria-label={tr('New')} />}
          </NavLink>
        ))}
      </nav>

      <div className="px-5 pb-6 pt-4 text-xs text-earth-400 border-t border-earth-900/80">
        <div className="rounded-3xl bg-white/5 p-3 text-earth-300">
          {tr(STORAGE_NOTE[role] || (localStorage.getItem('voluntrack:auth_token') ? ACCOUNT_STORAGE_NOTE : DEVICE_STORAGE_NOTE))}
        </div>
        <LanguagePicker compact className="mt-4" />
        <div className="mt-4 flex gap-3">
          <Link to="/contact" className="text-earth-300 hover:text-white">{tr('Contact')}</Link>
          <Link to="/status" className="text-earth-300 hover:text-white">{tr('System Status')}</Link>
        </div>
        <div className="mt-4 text-earth-500">© {new Date().getFullYear()} VolunTrack · {OPERATOR_NAME}{OPERATOR_NAME.endsWith('.') ? '' : '.'}{' '}{tr('All rights reserved.')}</div>
      </div>
    </aside>
  )
}
