import { Clock3 } from 'lucide-react'
import { lateLabel } from '@/components/DayOfPanel.jsx'

// "Running late (~20 min)" next to a volunteer on My Tasks (#438). The server
// sends late_at only on the task's day.
export default function LateBadge({ signup }) {
  if (!signup?.late_at || signup.status !== 'approved' || signup.checked_in_at) return null
  return (
    <p className="text-xs text-amber-400 mt-0.5 flex items-center gap-1">
      <Clock3 className="w-3 h-3" aria-hidden="true" />{' '}{lateLabel(signup.late_eta_minutes)}
    </p>
  )
}
