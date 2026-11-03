import { Clock, CheckCircle2, XCircle, CloudOff } from 'lucide-react'
import { tr } from '@/lib/i18n.js'

const VARIANTS = {
  pending: {
    icon: Clock,
    label: tr('Pending supervisor approval'),
    className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
  },
  approved: {
    icon: CheckCircle2,
    label: tr('Approved by supervisor'),
    schoolLabel: tr('Approved by your school'),
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  },
  rejected: {
    icon: XCircle,
    label: tr('Rejected by supervisor'),
    schoolLabel: tr('Sent back by your school'),
    className: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30',
  },
}

// `bySchool`: the student's school decided, not a supervisor (#591). `note`:
// what the school said, shown under the badge when it sent the entry back.
/** An entry saved on this device that hasn't reached the server yet (#635). */
export function UnsentBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30"
      title={tr('Saved on this device. It sends by itself when you’re back online.')}
    >
      <CloudOff className="w-3.5 h-3.5" aria-hidden="true" /> {tr('Waiting to send')}
    </span>
  )
}

// `unsent`: saved here but not on the server yet; shown instead of the status.
export default function VerificationBadge({ status, bySchool = false, note = '', unsent = false }) {
  if (unsent) return <UnsentBadge />
  const variant = VARIANTS[status]
  if (!variant) return null
  const Icon = variant.icon
  const badge = (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${variant.className}`}>
      <Icon className="w-3.5 h-3.5" /> {bySchool && variant.schoolLabel ? variant.schoolLabel : variant.label}
    </span>
  )
  if (!note) return badge
  return (
    <span className="inline-flex flex-col items-start gap-1">
      {badge}
      <span className="text-xs text-earth-600 dark:text-earth-300">
        <span className="font-medium">{status === 'rejected' ? tr('Why:') : tr('Note:')}</span>{' '}{note}
        {status === 'rejected' && <span className="block text-earth-500 dark:text-earth-400">{tr("Doesn't count for now. Edit the entry to fix it, and it goes back to your school.")}</span>}
      </span>
    </span>
  )
}
