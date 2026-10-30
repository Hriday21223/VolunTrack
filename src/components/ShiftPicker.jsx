import { useState } from 'react'
import { Clock, Check } from 'lucide-react'
import { tr } from '@/lib/i18n.js'
import { shiftText, shiftTime, shiftLeft, shiftLeftText } from '@/lib/taskShifts.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const SIGNED_UP = ['pending', 'approved', 'waitlisted', 'parent_pending']

// Shifts within an event (#589), on an Opportunities card: each shift with its
// time and spots left. Before signing up, each has its own Sign up (or Join
// waitlist) button, through Opportunities' own `onSignUp` so age, invite and
// parent handling stay in one place. After, the volunteer's shift is marked
// and they can switch to another (PATCH .../signup/shift).
export default function ShiftPicker({ task, onSignUp, onDone, onError, className = '' }) {
  const [busy, setBusy] = useState(null)
  const shifts = Array.isArray(task.shifts) ? task.shifts : []
  if (shifts.length === 0) return null
  const status = task.my_signup_status
  const signedUp = SIGNED_UP.includes(status)
  const closed = status && !signedUp && status !== 'parent_declined'
  const canAct = !closed && !task.my_too_young

  const pick = async (shift) => {
    setBusy(shift.id)
    try {
      if (!signedUp) {
        await onSignUp(task, shiftLeft(shift) === 0, { shiftId: shift.id })
        return
      }
      const full = shiftLeft(shift) === 0
      const res = await fetch(`${apiUrl}/school/public-tasks/${encodeURIComponent(task.id)}/signup/shift`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` },
        body: JSON.stringify({ shiftId: shift.id, ...(full ? { waitlist: true } : {}) }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || tr('Could not change your shift.'))
      onDone?.(d.status === 'waitlisted'
        ? tr("Moved to {shift}. It's full, so you're on its waitlist.", { shift: shiftText(shift) })
        : tr('Moved to {shift}.', { shift: shiftText(shift) }))
    } catch (e) {
      onError?.(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={className}>
      <p className="text-xs font-medium text-earth-500 dark:text-earth-400 mb-1.5">
        {signedUp ? tr('Your shift') : tr('Pick a shift')}
      </p>
      <ul className="space-y-1.5">
        {shifts.map((sh) => {
          const mine = signedUp && task.my_shift_id === sh.id
          const full = shiftLeft(sh) === 0
          return (
            <li
              key={sh.id}
              className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm ${mine ? 'border-brand-400 bg-brand-500/10' : 'border-earth-200 dark:border-white/10'}`}
            >
              <span className="min-w-0 flex items-start gap-1.5">
                {mine ? <Check className="w-3.5 h-3.5 mt-1 text-brand-400 shrink-0" /> : <Clock className="w-3.5 h-3.5 mt-1 text-earth-400 shrink-0" />}
                <span className="min-w-0">
                {sh.label && <span className="block font-medium break-words">{sh.label}</span>}
                <span className={`block ${sh.label ? 'text-xs text-earth-500 dark:text-earth-400' : 'font-medium'}`}>{shiftTime(sh)}</span>
                <span className={`block text-xs ${full ? 'text-earth-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {shiftLeftText(sh)}{full && sh.waitlist > 0 ? ` · ${tr('{n} waiting', { n: sh.waitlist })}` : ''}
                </span>
                </span>
              </span>
              {mine ? (
                <span className="text-xs font-medium text-brand-400 shrink-0">{status === 'waitlisted' ? `${tr('Waitlist #')}${task.my_waitlist_position || 1}` : tr('Yours')}</span>
              ) : canAct && (
                <button
                  type="button"
                  className={`${full ? 'btn-secondary' : signedUp ? 'btn-ghost' : 'btn-primary'} btn-sm text-xs shrink-0`}
                  disabled={busy !== null}
                  onClick={() => pick(sh)}
                >
                  {busy === sh.id ? '…' : signedUp ? (full ? tr('Wait for this one') : tr('Switch')) : (full ? tr('Join waitlist') : tr('Sign up'))}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
