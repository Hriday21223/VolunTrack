import { useCallback, useEffect, useState } from 'react'
import { UserPlus, X, LogOut } from 'lucide-react'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const authHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}`,
})

// Co-hosts of one task, in the expanded task on My Tasks (#440). The creator
// adds up to three other Task Makers by email and can remove them; a co-host
// sees the list and can leave. What a co-host may do is decided by the server
// (canManageTask in server/taskCohosts.js), never here.
export default function TaskCohosts({ task, userId, onLeft, onMessage }) {
  const [cohosts, setCohosts] = useState(null)
  const [max, setMax] = useState(3)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isCreator = !task.is_cohost
  const cancelled = task.status === 'cancelled'

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${task.id}/cohosts`, { headers: authHeaders() })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || tr('Could not load the co-hosts.'))
      setCohosts(body.cohosts || [])
      if (body.max) setMax(body.max)
    } catch (e) {
      setError(e.message)
    }
  }, [task.id])

  useEffect(() => { load() }, [load])

  const add = async (e) => {
    e.preventDefault()
    if (!email.trim()) return
    setBusy(true); setError('')
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${task.id}/cohosts`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ email: email.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || tr('Could not add the co-host.'))
      setCohosts(body.cohosts || [])
      setEmail('')
      onMessage?.(tr('Co-host added'))
    } catch (e) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  const remove = async (id, leaving) => {
    if (leaving && !window.confirm(tr('Stop co-hosting “{title}”? You will lose access to its volunteers.', { title: task.title }))) return
    setBusy(true); setError('')
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${task.id}/cohosts/${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: authHeaders(),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || tr('Could not remove the co-host.'))
      if (leaving) { onMessage?.(tr('You left this task')); onLeft?.(); return }
      setCohosts((list) => (list || []).filter((c) => c.id !== id))
      onMessage?.(tr('Co-host removed'))
    } catch (e) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  const list = cohosts || []
  return (
    <section className="mb-4 p-3 rounded-lg bg-earth-100 dark:bg-[#15211b]" aria-labelledby={`cohosts-${task.id}`}>
      <h4 id={`cohosts-${task.id}`} className="text-sm font-semibold">{tr('Co-hosts')}</h4>
      <p className="text-xs text-earth-500 mt-0.5">
        {isCreator
          ? tr('Co-hosts can approve sign-ups, take attendance, run check-in, verify hours and message volunteers. Only you can edit or cancel the task.')
          : tr('You are co-hosting this task for {name}.', { name: task.creator_name || tr('the organizer') })}
      </p>
      {cohosts === null && !error ? (
        <p className="text-xs text-earth-500 mt-2">{tr('Loading…')}</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {list.length === 0 && <li className="text-xs text-earth-500">{tr('No co-hosts yet.')}</li>}
          {list.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                {c.name || c.email}
                {c.id === userId && <span className="text-earth-500"> ({tr('you')})</span>}
                {c.name && <span className="block text-xs text-earth-500 truncate">{c.email}</span>}
              </span>
              {isCreator && (
                <button type="button" onClick={() => remove(c.id, false)} className="btn-sm btn-ghost text-red-400" disabled={busy} aria-label={tr('Remove {name} as co-host', { name: c.name || c.email })}>
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              {!isCreator && c.id === userId && (
                <button type="button" onClick={() => remove(c.id, true)} className="btn-sm btn-ghost text-red-400" disabled={busy}>
                  <LogOut className="w-3.5 h-3.5 mr-1" /> {tr('Leave')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {isCreator && !cancelled && cohosts !== null && list.length < max && (
        <form onSubmit={add} className="mt-2 flex flex-wrap gap-2">
          <label htmlFor={`cohost-email-${task.id}`} className="sr-only">{tr('Co-host email')}</label>
          <input
            id={`cohost-email-${task.id}`}
            type="email"
            className="input flex-1 min-w-[12rem]"
            maxLength={254}
            placeholder={tr('Task Maker’s email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" className="btn-sm btn-primary" disabled={busy || !email.trim()}>
            <UserPlus className="w-3.5 h-3.5 mr-1" /> {busy ? tr('Adding…') : tr('Add co-host')}
          </button>
        </form>
      )}
      {isCreator && list.length >= max && (
        <p className="text-xs text-earth-500 mt-2">{tr('A task can have up to {n} co-hosts.', { n: max })}</p>
      )}
      {error && <p role="alert" className="text-xs text-red-400 mt-2">{tr(error)}</p>}
    </section>
  )
}
