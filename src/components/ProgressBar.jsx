import { cn } from '@/utils/cn.js'
import { fmtHours } from '@/utils/date.js'
import { tr } from '@/lib/i18n.js'

/** A horizontal progress bar with current/target labels. */
export default function ProgressBar({ value, target, className }) {
  const percent = target > 0 ? Math.min(100, (value / target) * 100) : 0
  return (
    <div className={cn('w-full', className)}>
      <div className="flex justify-between text-xs font-medium text-earth-600 dark:text-earth-300 mb-1.5">
        <span>{fmtHours(value)}{' '}{tr('logged')}</span>
        <span>{tr('Goal:')}{' '}{fmtHours(target)}</span>
      </div>
      <div className="h-3 w-full rounded-full bg-earth-100 dark:bg-[#1b2a22] overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="text-right text-xs text-earth-500 dark:text-earth-400 mt-1">
        {percent.toFixed(0)}%
      </div>
    </div>
  )
}
