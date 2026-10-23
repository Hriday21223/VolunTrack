import { tr } from '@/lib/i18n.js'

// Day-of details (#438) on My Tasks' post and edit forms: where to meet and
// who to call on the day. Only the organizer and approved volunteers ever see
// them (the server filters). `value` holds meetingPoint and dayOfContact.
export default function DayOfFields({ value, onChange }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-earth-400">{tr('Day-of details — only approved volunteers see these')}</p>
      <input
        className="input"
        maxLength={200}
        aria-label={tr('Meeting point (optional)')}
        placeholder={tr('Meeting point (optional), e.g. side door by the parking lot')}
        value={value.meetingPoint || ''}
        onChange={(e) => onChange({ meetingPoint: e.target.value })}
      />
      <input
        className="input"
        maxLength={100}
        aria-label={tr('Day-of contact (optional)')}
        placeholder={tr('Day-of contact (optional), e.g. Sam, 555-010-0100')}
        value={value.dayOfContact || ''}
        onChange={(e) => onChange({ dayOfContact: e.target.value })}
      />
    </div>
  )
}
