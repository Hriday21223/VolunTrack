import { useState } from 'react'
import { Star } from 'lucide-react'
import { tr } from '@/lib/i18n.js'
import { useAuth } from '@/hooks/useAuth.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const COMMENT_MAX = 500

function Stars({ value, onPick, size = 'w-6 h-6' }) {
  return (
    <div className="flex items-center gap-1" role={onPick ? 'radiogroup' : undefined} aria-label={tr('Stars')}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value
        const icon = <Star className={`${size} ${filled ? 'fill-amber-400 text-amber-400' : 'text-earth-500'}`} />
        if (!onPick) return <span key={n}>{icon}</span>
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={n === 1 ? tr('1 star') : tr('{n} stars', { n })}
            onClick={() => onPick(n)}
            className="p-1 -m-0.5 rounded hover:scale-110 transition-transform"
          >
            {icon}
          </button>
        )
      })}
    </div>
  )
}

// "Rate this task" on Attendance, for a past task the student attended
// (PUT /api/school/public-tasks/:id/rating). The comment goes only to the
// organizer, without the student's name. Saved ratings can be changed.
export default function RateTask({ task, onSaved, onError }) {
  const { user } = useAuth()
  // Under 13: stars only (#606); the server drops a comment too.
  const noComment = Boolean(user?.under13)
  const mine = task.my_rating
  const [editing, setEditing] = useState(false)
  const [stars, setStars] = useState(mine?.stars || 0)
  const [comment, setComment] = useState(mine?.comment || '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!stars) return
    setBusy(true)
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${encodeURIComponent(task.id)}/rating`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` },
        body: JSON.stringify({ stars, comment: noComment ? '' : comment }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || tr('Could not save your rating.'))
      setEditing(false)
      onSaved?.(tr('Thanks — your rating was saved.'))
    } catch (e) {
      onError?.(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (mine && !editing) {
    return (
      <div className="mt-3 pt-3 border-t border-earth-200 dark:border-[#22352b] flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="text-earth-500">{tr('Your rating')}</span>
        <Stars value={mine.stars} size="w-4 h-4" />
        {mine.comment && <span className="text-earth-500 italic break-words min-w-0">“{mine.comment}”</span>}
        <button
          type="button"
          onClick={() => { setStars(mine.stars); setComment(mine.comment || ''); setEditing(true) }}
          className="text-brand-400 hover:underline"
        >
          {tr('Edit')}
        </button>
      </div>
    )
  }

  if (!mine && !editing) {
    return (
      <div className="mt-3 pt-3 border-t border-earth-200 dark:border-[#22352b]">
        <button type="button" onClick={() => setEditing(true)} className="text-sm text-brand-400 hover:underline inline-flex items-center gap-1.5">
          <Star className="w-4 h-4" />{' '}{tr('Rate this task')}
        </button>
      </div>
    )
  }

  return (
    <div className="mt-3 pt-3 border-t border-earth-200 dark:border-[#22352b] space-y-2">
      <p className="text-sm font-medium">{tr('How was it?')}</p>
      <Stars value={stars} onPick={setStars} />
      {!noComment && (
        <>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX))}
            maxLength={COMMENT_MAX}
            rows={2}
            placeholder={tr('Anything the organizer should know? (optional)')}
            className="input w-full text-sm min-h-[64px] resize-y"
          />
          <p className="text-xs text-earth-500">{tr('Only the organizer sees your comment, and not your name.')}</p>
        </>
      )}
      <div className="flex items-center gap-2">
        <button type="button" onClick={save} disabled={!stars || busy} className="btn-sm btn-primary disabled:opacity-50">
          {busy ? tr('Saving…') : tr('Save')}
        </button>
        <button type="button" onClick={() => setEditing(false)} disabled={busy} className="btn-sm btn-ghost">
          {tr('Cancel')}
        </button>
      </div>
    </div>
  )
}
