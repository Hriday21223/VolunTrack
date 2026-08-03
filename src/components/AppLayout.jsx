import { useNavigate } from 'react-router-dom'
import { LogOut, Menu } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth.jsx'
import { cn } from '@/utils/cn.js'
import Sidebar from './Sidebar.jsx'
import ReviewPopup from './ReviewPopup.jsx'

export default function AppLayout({ children, title, subtitle, action }) {
  const { user, logout } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const navigate = useNavigate()

  return (
    <div className="relative min-h-screen bg-[#071117] text-earth-100">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-10%] top-0 h-[420px] w-[420px] rounded-full bg-brand-500/20 blur-3xl" />
        <div className="absolute right-0 top-20 h-[360px] w-[360px] rounded-full bg-sky-500/10 blur-3xl" />
      </div>

      <div className="relative flex min-h-screen">
        <Sidebar />

        {/* mobile drawer */}
        <div
          className={cn(
            'md:hidden fixed inset-0 z-40 transition',
            drawerOpen ? 'pointer-events-auto' : 'pointer-events-none',
          )}
          aria-hidden={!drawerOpen}
        >
          <div
            className={cn('absolute inset-0 bg-black/30 transition-opacity', drawerOpen ? 'opacity-100' : 'opacity-0')}
            onClick={() => setDrawerOpen(false)}
          />
          <div
            className={cn(
              'absolute left-0 top-0 bottom-0 w-72 bg-[#071117] shadow-soft transition-transform',
              drawerOpen ? 'translate-x-0' : '-translate-x-full',
            )}
          >
            <div onClick={() => setDrawerOpen(false)}><Sidebar /></div>
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <header className="sticky top-0 z-20 border-b border-earth-900/80 bg-[#071117]/90 backdrop-blur md:px-8">
            <div className="px-4 md:px-8 py-4 flex flex-wrap items-center gap-3">
              <button
                className="md:hidden p-2 -ml-2 rounded-lg text-earth-200 hover:bg-white/10"
                onClick={() => setDrawerOpen(true)}
                aria-label="Open menu"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="min-w-0 flex-1">
                {title && <h1 className="text-xl md:text-2xl font-bold truncate">{title}</h1>}
                {subtitle && <p className="text-sm text-earth-400 truncate">{subtitle}</p>}
              </div>
              {action}
              <div className="hidden sm:flex items-center gap-3 pl-2 border-l border-earth-900/80">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 grid place-items-center text-white text-sm font-bold">
                  {user?.name?.[0]?.toUpperCase() || 'V'}
                </div>
                <div className="text-sm">
                  <div className="font-medium leading-tight">{user?.name || 'Volunteer'}</div>
                  <div className="text-xs text-earth-400 leading-tight">{user?.school || '—'}</div>
                </div>
              </div>
              <button
                onClick={() => { logout(); navigate('/login') }}
                className="p-2 rounded-lg text-earth-200 hover:text-red-400 hover:bg-red-500/10"
                title="Log out"
                aria-label="Log out"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </header>

          <main className="flex-1 px-4 md:px-8 py-8 pb-24 w-full mx-auto">
            {children}
          </main>
        </div>
      </div>

      <ReviewPopup />
    </div>
  )
}
