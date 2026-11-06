import { ClipboardList } from 'lucide-react'
import { tr } from '@/lib/i18n.js'

// "Your job right now" (#759): the job a volunteer claimed or was given, and
// the organizer's note for everyone, shown when they check in.
export const hasJobs = (jobs) => Boolean(jobs?.job || jobs?.everyone)

export default function CheckinJob({ jobs, tone = 'dark' }) {
  if (!hasJobs(jobs)) return null
  const box = tone === 'dark' ? 'bg-white/10 text-white' : 'bg-brand-50 text-earth-900 dark:bg-brand-900/30 dark:text-white'
  return (
    <div className={`mt-4 rounded-xl p-4 text-left ${box}`}>
      {jobs.job && (
        <>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide opacity-80"><ClipboardList className="w-4 h-4" />{' '}{tr('Your job right now')}</p>
          <p className="mt-1 text-lg font-bold">{jobs.job}</p>
        </>
      )}
      {jobs.everyone && (
        <p className={`${jobs.job ? 'mt-3' : ''} text-sm`}><span className="font-semibold">{tr('For everyone:')}</span>{' '}{jobs.everyone}</p>
      )}
    </div>
  )
}
