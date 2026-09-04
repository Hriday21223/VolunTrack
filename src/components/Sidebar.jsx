import { Home, Clock, Calendar, Trophy, FileText, User, Settings, Shield, HelpCircle, ClipboardList, ClipboardCheck, School, Activity, Users, MapPin } from 'lucide-react'
import { NavLink, Link } from 'react-router-dom'
import { cn } from '@/utils/cn.js'
import { useAuth } from '@/hooks/useAuth.jsx'

const ROLE_ITEMS = {
  student: [
    { to: '/',             label: 'Dashboard',   icon: Home },
    { to: '/opportunities', label: 'Opportunities', icon: MapPin },
    { to: '/log',          label: 'Log Hours',   icon: Clock },
    { to: '/calendar',     label: 'Calendar',    icon: Calendar },
    { to: '/achievements', label: 'Achievements', icon: Trophy },
    { to: '/reports',      label: 'Reports',     icon: FileText },
    { to: '/profile',      label: 'Profile',     icon: User },
    { to: '/settings',     label: 'Settings',    icon: Settings },
    { to: '/help',         label: 'Help',        icon: HelpCircle },
    { to: '/status',       label: 'System Status',      icon: Activity },
  ],
  volunteer: [
    { to: '/my-tasks',     label: 'My Tasks',    icon: ClipboardList },
    { to: '/',             label: 'Dashboard',   icon: Home },
    { to: '/attendance',   label: 'Attendance',  icon: ClipboardCheck },
    { to: '/log',          label: 'Log Hours',   icon: Clock },
    { to: '/calendar',     label: 'Calendar',    icon: Calendar },
    { to: '/achievements', label: 'Achievements', icon: Trophy },
    { to: '/reports',      label: 'Reports',     icon: FileText },
    { to: '/profile',      label: 'Profile',     icon: User },
    { to: '/settings',     label: 'Settings',    icon: Settings },
    { to: '/help',         label: 'Help',             icon: HelpCircle },
    { to: '/status',       label: 'System Status',           icon: Activity },
  ],
  school: [
    { to: '/',             label: 'Dashboard',        icon: Home },
    { to: '/school/dashboard', label: 'School Dashboard', icon: School },
    { to: '/log',          label: 'Log Hours',        icon: Clock },
    { to: '/calendar',     label: 'Calendar',         icon: Calendar },
    { to: '/reports',      label: 'Reports',          icon: FileText },
    { to: '/profile',      label: 'Profile',          icon: User },
    { to: '/settings',     label: 'Settings',         icon: Settings },
    { to: '/help',         label: 'Help',             icon: HelpCircle },
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
    { to: '/status',       label: 'System Status',           icon: Activity },
  ],
  parent: [
    { to: '/parent',       label: 'Dashboard',  icon: Home },
    { to: '/settings',     label: 'Settings',   icon: Settings },
    { to: '/help',         label: 'Help',       icon: HelpCircle },
  ],
  org: [
    { to: '/organization/dashboard', label: 'Dashboard', icon: Home },
    { to: '/profile',      label: 'Profile',          icon: User },
    { to: '/settings',     label: 'Settings',         icon: Settings },
    { to: '/help',         label: 'Help',             icon: HelpCircle },
    { to: '/status',       label: 'System Status',           icon: Activity },
  ],
}
ROLE_ITEMS.school_staff = ROLE_ITEMS.school

export default function Sidebar() {
  const { user } = useAuth()
  const role = user?.role || 'student'
  const items = ROLE_ITEMS[role] || ROLE_ITEMS.student

  return (
    <aside className="hidden md:flex md:flex-col w-72 shrink-0 border-r border-earth-900/80 bg-[#06141a] text-earth-200 sticky top-0 h-screen">
      <div className="px-6 py-6">
        <div className="flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="VolunTrack" className="w-11 h-11 object-contain" />
          <div>
            <div className="font-display font-bold text-lg leading-none">VolunTrack</div>
            <div className="text-xs text-earth-400 mt-0.5">Volunteer hour tracker</div>
          </div>
        </div>
      </div>

      <nav className="px-4 py-3 flex-1 space-y-1">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium transition',
                isActive
                  ? 'bg-brand-700/10 text-white shadow-sm shadow-brand-500/10'
                  : 'text-earth-300 hover:bg-white/5 hover:text-white',
              )
            }
          >
            <Icon className="w-4 h-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-5 pb-6 pt-4 text-xs text-earth-400 border-t border-earth-900/80">
        <div className="rounded-3xl bg-white/5 p-3 text-earth-300">
          Your hours are stored on this device. Creating an account also stores some data (Family sharing, school linking, sync) on our server.
        </div>
        <div className="mt-4 flex gap-3">
          <Link to="/about" className="text-earth-300 hover:text-white">About</Link>
          <Link to="/contact" className="text-earth-300 hover:text-white">Contact</Link>
          <Link to="/status" className="text-earth-300 hover:text-white">System Status</Link>
        </div>
        <div className="mt-4 text-earth-500">© {new Date().getFullYear()} VolunTrack. All rights reserved.</div>
      </div>
    </aside>
  )
}
