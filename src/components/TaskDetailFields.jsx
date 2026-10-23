import { tr } from '@/lib/i18n.js'
import DayOfFields from '@/components/DayOfFields.jsx'

const AGE_CHOICES = [10, 12, 13, 14, 16, 18, 21]

// The optional task details (#426) on My Tasks' post and edit forms: online,
// minimum age, wheelchair access and a short note, plus outdoor (#435) and
// whether volunteers may bring guests (#439). `value` holds minAge ('' for
// none), isOnline, wheelchairAccessible, accessibilityNote, isOutdoor and
// allowGuests;
// `onChange` gets the fields that changed.
export default function TaskDetailFields({ value, onChange, idPrefix = 'task' }) {
  const ages = value.minAge && !AGE_CHOICES.includes(Number(value.minAge)) ? [...AGE_CHOICES, Number(value.minAge)].sort((a, b) => a - b) : AGE_CHOICES
  return (
    <div className="space-y-2">
      {!value.isOnline && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={Boolean(value.isOutdoor)} onChange={(e) => onChange({ isOutdoor: e.target.checked })} />
          {tr('Outdoor task — volunteers see the weather forecast')}
        </label>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="label text-xs" htmlFor={`${idPrefix}-min-age`}>{tr('Minimum age')}</label>
          <select id={`${idPrefix}-min-age`} className="input" value={value.minAge} onChange={(e) => onChange({ minAge: e.target.value })}>
            <option value="">{tr('Any age')}</option>
            {ages.map((n) => <option key={n} value={String(n)}>{tr('{n}+', { n })}</option>)}
          </select>
        </div>
        <div>
          <label className="label text-xs" htmlFor={`${idPrefix}-wheelchair`}>{tr('Wheelchair accessible')}</label>
          <select id={`${idPrefix}-wheelchair`} className="input" value={value.wheelchairAccessible} onChange={(e) => onChange({ wheelchairAccessible: e.target.value })}>
            <option value="unknown">{tr("Don't know")}</option>
            <option value="yes">{tr('Yes')}</option>
            <option value="no">{tr('No')}</option>
          </select>
        </div>
      </div>
      <input
        className="input"
        maxLength={200}
        aria-label={tr('Accessibility note')}
        placeholder={tr('Accessibility note (optional), e.g. step-free entrance at the side')}
        value={value.accessibilityNote}
        onChange={(e) => onChange({ accessibilityNote: e.target.value })}
      />
      <DayOfFields value={value} onChange={onChange} />
      {/* Group sign-ups (#439). */}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={Boolean(value.allowGuests)} onChange={(e) => onChange({ allowGuests: e.target.checked })} />
        <span>
          {tr('Volunteers can bring up to 3 guests')}
          <span className="block text-xs text-earth-500">{tr("Each guest takes a spot. Guests' hours aren't recorded in VolunTrack.")}</span>
        </span>
      </label>
    </div>
  )
}

// The "Online task" checkbox, kept separate so the form can put it next to
// the location (which it makes optional).
export function OnlineToggle({ checked, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {tr('Online task — no address needed')}
    </label>
  )
}
