import { CalendarPlus } from 'lucide-react'
import { googleCalendarUrl } from '@/lib/calendarLinks.js'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// Two ways to put a volunteer task in a calendar: the .ics file our server
// makes (Apple Calendar, Outlook, most Android calendars) and Google
// Calendar's own "new event" page. Both are free and need no account here.
export default function AddToCalendar({ task, className = '' }) {
  const link = 'inline-flex items-center gap-1 hover:text-brand-400 hover:underline'
  // Signed up for a shift (#589): the calendar gets that shift's times.
  const shift = Array.isArray(task.shifts) ? task.shifts.find((sh) => sh.id === (task.my_shift_id || task.shift_id)) : null
  const forCalendar = shift ? { ...task, time: shift.start, end_time: shift.end, title: shift.label ? `${task.title} (${shift.label})` : task.title } : task
  const ics = `${apiUrl}/school/public-tasks/${encodeURIComponent(task.id)}/calendar.ics${shift ? `?shift=${encodeURIComponent(shift.id)}` : ''}`
  return (
    <p className={`text-xs text-earth-500 flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      <span className="flex items-center gap-1"><CalendarPlus className="w-3.5 h-3.5" />{' '}{tr('Add to calendar:')}</span>
      <a href={ics} className={link} onClick={(e) => e.stopPropagation()}>{tr('Apple / Outlook')}</a>
      <a href={googleCalendarUrl(forCalendar)} target="_blank" rel="noopener noreferrer" className={link} onClick={(e) => e.stopPropagation()}>Google</a>
    </p>
  )
}
