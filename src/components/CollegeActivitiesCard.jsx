import { useMemo, useState } from 'react'
import { GraduationCap, Copy, Check, ChevronDown } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { buildActivities, activityText, LIMITS } from '@/lib/collegeActivities.js'
import { tr } from '@/lib/i18n.js'

// Reports → College applications (#508). Drafts a Common App activity entry
// per organization from the student's own logs. Edits stay on this page.
export default function CollegeActivitiesCard({ logs }) {
  const activities = useMemo(() => buildActivities(logs), [logs])
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)

  if (activities.length === 0) return null
  const shown = showAll ? activities : activities.slice(0, 3)

  return (
    <Card>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-start justify-between gap-3 text-left" aria-expanded={open}>
        <span>
          <span className="font-display font-semibold flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-brand-600" />{' '}{tr('College applications')}
          </span>
          <span className="block text-sm text-earth-500 dark:text-earth-400 mt-0.5">
            {tr('Your hours as Common App activity entries, ready to copy.')}
          </span>
        </span>
        <ChevronDown className={`w-5 h-5 mt-0.5 shrink-0 text-earth-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-earth-500 dark:text-earth-400">
            {tr('One entry per organization, most hours first. Hours per week and weeks per year are averaged over the weeks you volunteered, so check them before you submit, and pick your grade levels on the form.')}
          </p>
          {shown.map((a) => <ActivityEntry key={a.key} activity={a} />)}
          {activities.length > 3 && (
            <button type="button" className="btn-ghost btn-sm w-full" onClick={() => setShowAll((s) => !s)}>
              {showAll ? tr('Show fewer') : tr('Show all {n} organizations', { n: activities.length })}
            </button>
          )}
        </div>
      )}
    </Card>
  )
}

function ActivityEntry({ activity }) {
  const [position, setPosition] = useState(activity.position)
  const [description, setDescription] = useState(activity.description)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(activityText({ ...activity, position, description }))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked: the text is still on screen to copy by hand */ }
  }

  return (
    <div className="rounded-xl border border-earth-200 dark:border-earth-700 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold truncate">{activity.organization}</p>
          <p className="text-xs text-earth-500 dark:text-earth-400">
            {tr('{h} hours · {s} sessions', { h: Math.round(activity.totalHours * 10) / 10, s: activity.sessions })}
          </p>
        </div>
        <button type="button" onClick={copy} className="btn-secondary btn-sm shrink-0">
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{' '}{copied ? tr('Copied') : tr('Copy')}
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <Fact label={tr('Activity type')} value={tr('Community Service (Volunteer)')} wide />
        <Fact label={tr('Hours per week')} value={activity.hoursPerWeek} />
        <Fact label={tr('Weeks per year')} value={activity.weeksPerYear} />
        <Fact label={tr('When')} value={tr(activity.timing)} />
        <Fact label={tr('School years')} value={activity.schoolYears.join(', ')} />
      </dl>

      <Field label={tr('Position / leadership')} value={position} max={LIMITS.position} onChange={setPosition} />
      <Field label={tr('Description')} value={description} max={LIMITS.description} onChange={setDescription} multiline />
    </div>
  )
}

function Fact({ label, value, wide }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-xs text-earth-500 dark:text-earth-400">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}

function Field({ label, value, max, onChange, multiline }) {
  const Tag = multiline ? 'textarea' : 'input'
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="label mb-1">{label}</label>
        <span className={`text-xs tabular-nums ${value.length > max ? 'text-red-500' : 'text-earth-400'}`}>{value.length}/{max}</span>
      </div>
      <Tag
        className="input"
        rows={multiline ? 3 : undefined}
        maxLength={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
