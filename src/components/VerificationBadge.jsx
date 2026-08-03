import { Clock, CheckCircle2, XCircle } from 'lucide-react'

const VARIANTS = {
  pending: {
    icon: Clock,
    label: 'Pending supervisor approval',
    className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
  },
  approved: {
    icon: CheckCircle2,
    label: 'Approved by supervisor',
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  },
  rejected: {
    icon: XCircle,
    label: 'Rejected by supervisor',
    className: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30',
  },
}

export default function VerificationBadge({ status }) {
  const variant = VARIANTS[status]
  if (!variant) return null
  const Icon = variant.icon
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${variant.className}`}>
      <Icon className="w-3.5 h-3.5" /> {variant.label}
    </span>
  )
}
