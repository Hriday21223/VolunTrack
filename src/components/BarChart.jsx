import { useMemo } from 'react'
import { cn } from '@/utils/cn.js'

function fmt(v) {
  const r = Math.round((Number(v) || 0) * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

/**
 * A small bar chart in plain HTML, so the bars and labels keep their shape at
 * any card width (an SVG stretched with preserveAspectRatio="none" squashed
 * the letters flat and turned the bars into wide blocks).
 *
 * data: [{ label, value, title?, highlight? }]. `title` is the tooltip and
 * screen-reader name ("Tuesday: 3 hours"); `highlight` marks one bar (today).
 * `unit` is appended to the value shown above each bar; empty labels hide the
 * label row, for callers that draw their own.
 */
export default function BarChart({ data, height = 150, color, unit = 'h', showValues = true }) {
  const max = useMemo(() => Math.max(1, ...data.map((d) => d.value || 0)), [data])
  const hasLabels = data.some((d) => d.label)
  // Room above the tallest bar for its value.
  const barArea = height - (hasLabels ? 22 : 0) - (showValues ? 18 : 0)

  return (
    <div className="w-full" role="img" aria-label={data.map((d) => d.title || `${d.label}: ${fmt(d.value)}${unit}`).join(', ')}>
      <div className="flex items-end gap-1.5 sm:gap-3" style={{ height: barArea + (showValues ? 18 : 0) }}>
        {data.map((d, i) => {
          const value = d.value || 0
          const h = value ? Math.max(6, (value / max) * barArea) : 4
          return (
            <div key={`${d.label}-${i}`} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full" title={d.title}>
              {showValues && value > 0 && (
                <span className={cn('mb-1 text-[0.625rem] tabular-nums leading-none', d.highlight ? 'text-white font-semibold' : 'text-earth-400')}>
                  {fmt(value)}{unit}
                </span>
              )}
              <div
                className={cn(
                  'w-full max-w-[2.25rem] rounded-t-md rounded-b-sm transition-[height] duration-500',
                  value
                    ? (color ? '' : 'bg-gradient-to-t from-brand-700 to-brand-400')
                    : 'bg-earth-500/20',
                  d.highlight && value && 'ring-2 ring-brand-300/40',
                )}
                style={{ height: h, ...(value && color ? { background: color } : {}) }}
              />
            </div>
          )
        })}
      </div>
      {hasLabels && (
        <div className="mt-1.5 flex gap-1.5 sm:gap-3">
          {data.map((d, i) => (
            <span
              key={`${d.label}-${i}`}
              className={cn(
                'flex-1 min-w-0 text-center text-xs leading-none',
                d.highlight ? 'text-brand-400 font-semibold' : 'text-earth-500 dark:text-earth-400',
              )}
            >
              {d.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
