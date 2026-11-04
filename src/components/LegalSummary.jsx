import { Link } from 'react-router-dom'
import { ScrollText } from 'lucide-react'
import { tr } from '@/lib/i18n.js'
import { LEGAL_SUMMARY, LEGAL_SUMMARY_SCHOOL } from '@/lib/legal.js'

// "The short version" of the Terms and Privacy Policy (#689), shown above
// the "I agree" box so the key points are read, not skipped.
export default function LegalSummary({ audience = 'person', points }) {
  const list = points || (audience === 'school' ? LEGAL_SUMMARY_SCHOOL : LEGAL_SUMMARY)
  return (
    <div className="rounded-xl border border-earth-200 dark:border-white/10 bg-earth-50 dark:bg-white/5 p-3 text-sm">
      <p className="font-semibold flex items-center gap-1.5"><ScrollText className="w-4 h-4 text-brand-600" aria-hidden="true" />{tr('The short version')}</p>
      <ul className="mt-2 space-y-1.5 list-disc pl-5 text-earth-700 dark:text-earth-300">
        {list.map((p) => <li key={p}>{tr(p)}</li>)}
      </ul>
      <p className="mt-2 text-xs text-earth-500 dark:text-earth-400">
        {tr('The full')}{' '}
        <Link to="/terms" target="_blank" className="text-brand-700 dark:text-brand-300 font-medium hover:underline">{tr('Terms of Service')}</Link>
        {' '}{tr('and')}{' '}
        <Link to="/privacy" target="_blank" className="text-brand-700 dark:text-brand-300 font-medium hover:underline">{tr('Privacy Policy')}</Link>
        {' '}{tr('are what count.')}
      </p>
    </div>
  )
}
