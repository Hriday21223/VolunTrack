import { useMemo, useState } from 'react'
import { Sparkles, Copy, Check } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { hoursBySkill } from '@/lib/skills.js'
import { countedLogs } from '@/lib/achievements.js'
import { fmtHours } from '@/utils/date.js'
import { tr } from '@/lib/i18n.js'

// Reports → Skills (#605): hours per skill tagged on Log Hours, most first,
// with a line to paste into a résumé. Built on this device from counted logs.
export default function SkillsCard({ logs }) {
  const skills = useMemo(() => hoursBySkill(countedLogs(logs)), [logs])
  const [copied, setCopied] = useState(false)
  if (skills.length === 0) return null
  const top = skills[0].hours || 1

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(skills.slice(0, 8).map((s) => tr(s.skill)).join(', '))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked: the list is on screen */ }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-600" />{' '}{tr('My skills')}
          </h3>
          <p className="text-sm text-earth-500 dark:text-earth-400 mt-0.5">{tr('Hours spent using each skill. Handy for a résumé.')}</p>
        </div>
        <button type="button" className="btn-sm btn-ghost shrink-0" onClick={copy}>
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{' '}{copied ? tr('Copied') : tr('Copy list')}
        </button>
      </div>
      <ul className="mt-3 space-y-2">
        {skills.slice(0, 10).map((s) => (
          <li key={s.skill}>
            <div className="flex justify-between gap-3 text-sm">
              <span>{tr(s.skill)}</span>
              <span className="font-medium tabular-nums">{fmtHours(s.hours)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-earth-100 dark:bg-[#1f2e25] mt-1 overflow-hidden">
              <div className="h-full bg-brand-500" style={{ width: `${Math.max(3, (s.hours / top) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
