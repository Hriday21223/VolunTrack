import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import { tr } from '@/lib/i18n.js'
import { MAX_GUESTS, GUEST_NAME_MAX, guestSummary } from '@/lib/guests.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

const HOLDS_OR_WAITS = ['pending', 'approved', 'waitlisted']

// Group sign-ups (#439) on an Opportunities card, for a task whose organizer
// allows guests. Before signing up: "Bring guests" opens a picker (1–3
// guests, optional first names) and signs the group up through `onSignUp`
// (Opportunities' own sign-up, so age, invite and waitlist handling stay in
// one place). After: shows the guests and lets the student change or remove
// them (PATCH /api/school/public-tasks/:id/signup/guests). Under-13 students
// can't bring guests, and nothing is shown to them.
export default function GuestSignup({ task, user, onSignUp, onDone, onError }) {
  const status = task.my_signup_status
  const signedUp = HOLDS_OR_WAITS.includes(status)
  const current = Number(task.my_guest_count) || 0
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(signedUp ? current : 1)
  const [names, setNames] = useState(() => padNames(task.my_guest_names))
  const [busy, setBusy] = useState(false)

  if (user?.under13) return null
  // Turning guests off later keeps (and lets them remove) guests already added.
  if (!task.allow_guests && !(signedUp && current > 0)) return null
  if (status && !signedUp) return null
  if (!status && task.my_too_young) return null

  // Shifts (#589): sign up for a shift first, then add guests to it; the
  // spots are that shift's.
  const myShift = Array.isArray(task.shifts) && task.shifts.length ? task.shifts.find((sh) => sh.id === task.my_shift_id) : null
  if (Array.isArray(task.shifts) && task.shifts.length && !signedUp) return null
  const total = myShift ? Number(myShift.slots) || 0 : Number(task.slots_total) || 0
  const filled = myShift ? Number(myShift.filled) || 0 : Number(task.slots_filled) || 0
  // Spots this sign-up could use: the free ones, plus its own if it holds some.
  const holds = status === 'pending' || status === 'approved'
  const left = Math.max(0, total - filled + (holds ? 1 + current : 0))
  const size = 1 + count
  const fits = size <= left
  const maxChoice = task.allow_guests ? MAX_GUESTS : current
  const choices = Array.from({ length: maxChoice + 1 }, (_, i) => i).filter((n) => signedUp || n > 0)
  const guestNames = () => names.slice(0, count).map((n) => n.trim()).filter(Boolean)

  const signUpGroup = async () => {
    setBusy(true)
    try {
      await onSignUp(task, !fits, { guestCount: count, guestNames: guestNames() })
      setOpen(false)
    } finally { setBusy(false) }
  }

  const save = async () => {
    setBusy(true)
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${encodeURIComponent(task.id)}/signup/guests`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` },
        body: JSON.stringify({ guestCount: count, guestNames: guestNames() }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || tr('Could not change your guests.'))
      setOpen(false)
      onDone?.(count === 0 ? tr('Guests removed.') : tr('Guests updated.'))
    } catch (e) {
      onError?.(e.message)
    } finally { setBusy(false) }
  }

  if (!open) {
    const summary = guestSummary(current, task.my_guest_names)
    return (
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {signedUp && summary && <span className="text-brand-400">{tr('Bringing {guests}', { guests: summary })}</span>}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setCount(signedUp ? current : 1); setNames(padNames(task.my_guest_names)); setOpen(true) }}
          className="inline-flex items-center gap-1 text-earth-500 hover:text-brand-400"
        >
          <UserPlus className="w-3 h-3" />{' '}
          {!signedUp ? tr('Bring guests') : current > 0 ? tr('Change guests') : tr('Add guests')}
        </button>
      </div>
    )
  }

  return (
    <div className="mt-2 p-3 rounded-lg bg-white/5 border border-white/10 space-y-2 text-sm" onClick={(e) => e.stopPropagation()}>
      <label className="flex items-center gap-2">
        <span>{tr('Guests coming with you')}</span>
        <select className="input w-auto py-1" value={count} onChange={(e) => setCount(Number(e.target.value))}>
          {choices.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      {Array.from({ length: count }, (_, i) => (
        <input
          key={i}
          className="input py-1"
          maxLength={GUEST_NAME_MAX}
          aria-label={tr('Guest {n} first name (optional)', { n: i + 1 })}
          placeholder={tr('Guest {n} first name (optional)', { n: i + 1 })}
          value={names[i]}
          onChange={(e) => setNames((list) => list.map((v, j) => (j === i ? e.target.value : v)))}
        />
      ))}
      <p className="text-xs text-earth-500">
        {tr("Each guest takes a spot. Guests' hours aren't recorded in VolunTrack — only yours are.")}
      </p>
      {!fits && status !== 'waitlisted' && (
        <p className="text-xs text-amber-400">
          {signedUp
            ? tr('Only {n} spots left for your group — bring fewer guests.', { n: left })
            : left > 0
              ? tr('Only {n} spots left — your group of {size} would join the waitlist together.', { n: left, size })
              : tr('This task is full — your group would join the waitlist together.')}
        </p>
      )}
      <div className="flex gap-2">
        {signedUp ? (
          <button type="button" onClick={save} disabled={busy || (!fits && status !== 'waitlisted') || (count === current && sameNames(names, task.my_guest_names, count))} className="btn-primary btn-sm">
            {busy ? '…' : tr('Save')}
          </button>
        ) : (
          <button type="button" onClick={signUpGroup} disabled={busy} className={fits ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>
            {busy ? '…' : fits
              ? (count === 1 ? tr('Sign up with 1 guest') : tr('Sign up with {n} guests', { n: count }))
              : tr('Join waitlist together')}
          </button>
        )}
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className="btn-ghost btn-sm">{tr('Cancel')}</button>
      </div>
    </div>
  )
}

function padNames(list) {
  const names = Array.isArray(list) ? list.filter(Boolean) : []
  return Array.from({ length: MAX_GUESTS }, (_, i) => names[i] || '')
}

function sameNames(names, saved, count) {
  const a = names.slice(0, count).map((n) => n.trim()).filter(Boolean)
  const b = (Array.isArray(saved) ? saved : []).filter(Boolean)
  return a.length === b.length && a.every((n, i) => n === b[i])
}
