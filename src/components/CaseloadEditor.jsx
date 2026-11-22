import { X } from 'lucide-react'
import { tr } from '@/lib/i18n.js'
import { ALL_GRADES } from '@/lib/caseload.js'

const MAX_RANGES = 5

// The students a counselor helps (#972): one or more last-name ranges, and
// optionally grades. `value` is { ranges: [{ from, to }], grades: [] }; the
// server cleans and checks it (server/nameRange.js).
export default function CaseloadEditor({ value, onChange, gradeOptions, idPrefix = 'caseload' }) {
  const ranges = value.ranges?.length ? value.ranges : [{ from: '', to: '' }]
  const grades = value.grades || []
  const options = gradeOptions?.length ? gradeOptions : ALL_GRADES
  const setRange = (i, key, v) => onChange({ ...value, ranges: ranges.map((r, j) => (j === i ? { ...r, [key]: v } : r)) })
  const toggleGrade = (g) => onChange({ ...value, grades: grades.includes(g) ? grades.filter((x) => x !== g) : [...grades, g] })

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <p className="text-sm font-medium">{tr('Last names')}</p>
        {ranges.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor={`${idPrefix}-from-${i}`} className="sr-only">{tr('From')}</label>
            <input id={`${idPrefix}-from-${i}`} className="input w-28" maxLength={20} placeholder="A" value={r.from} onChange={(e) => setRange(i, 'from', e.target.value)} />
            <span className="text-earth-500">{tr('to')}</span>
            <label htmlFor={`${idPrefix}-to-${i}`} className="sr-only">{tr('To')}</label>
            <input id={`${idPrefix}-to-${i}`} className="input w-28" maxLength={20} placeholder="Chaw" value={r.to} onChange={(e) => setRange(i, 'to', e.target.value)} />
            {ranges.length > 1 && (
              <button type="button" className="p-1 text-earth-400 hover:text-red-400" aria-label={tr('Remove this range')} onClick={() => onChange({ ...value, ranges: ranges.filter((_, j) => j !== i) })}>
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
        {ranges.length < MAX_RANGES && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => onChange({ ...value, ranges: [...ranges, { from: '', to: '' }] })}>{tr('+ Add another range')}</button>
        )}
        <p className="text-xs text-earth-500">{tr('A name matches by its start: A to Chaw includes Chawla. Leave a box empty to mean from A or through Z.')}</p>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">{tr('Grades (optional)')}</p>
        <div className="flex flex-wrap gap-1.5">
          {options.map((g) => (
            <button key={g} type="button" onClick={() => toggleGrade(g)} aria-pressed={grades.includes(g)}
              className={`text-xs rounded-full border px-2.5 py-1 ${grades.includes(g) ? 'border-brand-400 bg-brand-500/15' : 'border-earth-300 dark:border-white/15'}`}>
              {g}
            </button>
          ))}
        </div>
        <p className="text-xs text-earth-500">{tr('None picked means every grade.')}</p>
      </div>
    </div>
  )
}
