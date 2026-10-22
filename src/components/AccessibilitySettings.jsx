import { Contrast, Type } from 'lucide-react'
import { useDisplayPrefs, TEXT_SIZES } from '@/hooks/useDisplayPrefs.js'
import { tr } from '@/lib/i18n.js'
import { cn } from '@/utils/cn.js'

const SIZE_LABELS = {
  default: () => tr('Default'),
  large: () => tr('Large'),
  xlarge: () => tr('Extra large'),
}

function Switch({ checked, onChange, label, className }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1813]',
        checked ? 'bg-brand-500 border-brand-500' : 'bg-earth-700/40 border-earth-400',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')}
      />
    </button>
  )
}

// Text size + high contrast. Both are kept on this device only and apply the
// moment they change. `compact` is the one-line version for the signed-out
// screens, next to the language picker.
export default function AccessibilitySettings({ compact = false, className = '' }) {
  const { textSize, highContrast, setTextSize, setHighContrast } = useDisplayPrefs()

  if (compact) {
    return (
      <div className={cn('inline-flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm', className)}>
        <label className="inline-flex items-center gap-2">
          <Type className="w-4 h-4 text-earth-400" aria-hidden="true" />
          <span className="sr-only">{tr('Text size')}</span>
          <select
            value={textSize}
            onChange={(e) => setTextSize(e.target.value)}
            className="input py-1 px-2 text-sm w-auto"
            aria-label={tr('Text size')}
          >
            {TEXT_SIZES.map((s) => <option key={s} value={s}>{SIZE_LABELS[s]()}</option>)}
          </select>
        </label>
        <span className="inline-flex items-center gap-2">
          <Contrast className="w-4 h-4 text-earth-400" aria-hidden="true" />
          <span className="text-earth-300">{tr('High contrast')}</span>
          <Switch checked={highContrast} onChange={setHighContrast} label={tr('High contrast')} />
        </span>
      </div>
    )
  }

  return (
    <div className={className}>
      <h3 className="font-display font-semibold mb-1 flex items-center gap-2">
        <Type className="w-4 h-4 text-brand-600 dark:text-brand-400" aria-hidden="true" /> {tr('Accessibility')}
      </h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
        {tr('Make VolunTrack easier to read. These settings are saved on this device only.')}
      </p>

      <div className="mb-4">
        <div className="label" id="a11y-text-size">{tr('Text size')}</div>
        <div role="group" aria-labelledby="a11y-text-size" className="flex flex-wrap gap-1 p-1 rounded-xl border border-earth-200 dark:border-[#243529] w-full sm:w-fit">
          {TEXT_SIZES.map((s) => {
            const active = textSize === s
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() => setTextSize(s)}
                className={cn(
                  'flex-1 sm:flex-none min-w-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
                  active ? 'bg-brand-600 text-white' : 'text-earth-700 dark:text-earth-200 hover:bg-earth-100 dark:hover:bg-white/10',
                )}
              >
                {SIZE_LABELS[s]()}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-medium text-sm">{tr('High contrast')}</div>
          <p className="hint">{tr('Brighter text, stronger borders and focus outlines, and underlined links.')}</p>
        </div>
        <Switch checked={highContrast} onChange={setHighContrast} label={tr('High contrast')} className="mt-0.5" />
      </div>
    </div>
  )
}
