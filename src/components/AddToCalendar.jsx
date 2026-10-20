import { CalendarPlus } from 'lucide-react'
import { googleCalendarUrl } from '@/lib/calendarLinks.js'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// Two ways to put a volunteer task in a calendar: the .ics file our server
// makes (Apple Calendar, Outlook, most Android calendars) and Google
// Calendar's own "new event" page. Both are free and need no account here.
export default function AddToCalendar({ task, className = '' }) {
  const link = 'inline-flex items-center gap-1 hover:text-brand-400 hover:underline'
  return (
    <p className={`text-xs text-earth-500 flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      <span className="flex items-center gap-1"><CalendarPlus className="w-3.5 h-3.5" />{' '}{tr('Add to calendar:')}</span>
      <a href={`${apiUrl}/school/public-tasks/${encodeURIComponent(task.id)}/calendar.ics`} className={link} onClick={(e) => e.stopPropagation()}>{tr('Apple / Outlook')}</a>
      <a href={googleCalendarUrl(task)} target="_blank" rel="noopener noreferrer" className={link} onClick={(e) => e.stopPropagation()}>Google</a>
    </p>
  )
}
