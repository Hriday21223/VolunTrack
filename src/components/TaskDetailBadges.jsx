import { Globe, Accessibility, UserCheck } from 'lucide-react'
import { tr } from '@/lib/i18n.js'

// The optional details an organizer sets on a task (#426): minimum age,
// online, and wheelchair access with a short note. Renders nothing for a task
// that has none of them. Shared by Opportunities and My Tasks.
export default function TaskDetailBadges({ task, className = '' }) {
  if (!task) return null
  const minAge = task.min_age != null ? Number(task.min_age) : null
  const wheelchair = task.wheelchair_accessible
  const note = String(task.accessibility_note || '').trim()
  if (!task.is_online && minAge == null && wheelchair !== 'yes' && wheelchair !== 'no' && !note) return null
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {task.is_online && (
        <span className="chip-brand"><Globe className="w-3 h-3" aria-hidden="true" />{tr('Online')}</span>
      )}
      {minAge != null && (
        <span className="chip-amber" title={tr('For volunteers {n} or older', { n: minAge })}>
          <UserCheck className="w-3 h-3" aria-hidden="true" />{tr('{n}+', { n: minAge })}
        </span>
      )}
      {wheelchair === 'yes' && (
        <span className="chip-earth"><Accessibility className="w-3 h-3" aria-hidden="true" />{tr('Wheelchair accessible')}</span>
      )}
      {wheelchair === 'no' && (
        <span className="chip-earth"><Accessibility className="w-3 h-3" aria-hidden="true" />{tr('Not wheelchair accessible')}</span>
      )}
      {note && <span className="text-xs text-earth-500 break-words">{note}</span>}
    </div>
  )
}

