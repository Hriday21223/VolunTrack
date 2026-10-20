import { useReminderRunner } from '@/hooks/useReminders.js'
import { Bell, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { tr } from '@/lib/i18n.js'
import { useAuth } from '@/hooks/useAuth.jsx'
import { canOpen } from '@/lib/roleAccess.js'

/** Renders toasts for reminders that just fired in this session. */
export default function ReminderToasts() {
  const { fired, dismiss } = useReminderRunner()
  const nav = useNavigate()
  const { user } = useAuth()
  const canLog = canOpen(user?.role, '/log')
  if (!fired.length) return null
  return (
    <div className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-50 space-y-2 animate-slide-up">
      {fired.map((r) => (
        <div
          key={r.id}
          className="flex items-center gap-3 pl-3 pr-2 py-3 rounded-2xl shadow-soft bg-gradient-to-br from-brand-50 to-brand-100 border border-brand-200 dark:from-brand-900/30 dark:to-brand-800/20 dark:border-brand-700/40"
        >
          <div className="w-10 h-10 rounded-xl bg-brand-600 text-white grid place-items-center animate-pop">
            <Bell className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-brand-700 dark:text-brand-300">{tr('Reminder')}</div>
            <div className="text-sm font-semibold text-brand-900 dark:text-brand-100 truncate">{r.title}</div>
            {r.body && <div className="text-xs text-brand-800/80 dark:text-brand-200/80 truncate">{r.body}</div>}
          </div>
          {canLog && <button
            onClick={() => { dismiss(r.id); nav('/log') }}
            className="text-xs font-medium text-brand-700 dark:text-brand-200 px-2 py-1 rounded-lg hover:bg-brand-200/50"
          >
            {tr('Log now')}
          </button>}
          <button
            onClick={() => dismiss(r.id)}
            className="p-1 rounded-md text-brand-700/70 hover:bg-brand-200/50"
            aria-label={tr('Dismiss')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
