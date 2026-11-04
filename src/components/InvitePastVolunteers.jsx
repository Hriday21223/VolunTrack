import { useEffect, useState } from 'react'
import { UserPlus } from 'lucide-react'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

// Invite past volunteers (#705): one tap sends a bell to everyone who came
// to this organizer's earlier events, once per event.
export default function InvitePastVolunteers({ task, onDone }) {
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    fetch(`${apiUrl}/school/public-tasks/${task.id}/invite-past`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : null)).then(setInfo).catch(() => {})
  }, [task.id])
  if (!info || (info.count === 0 && !info.invitedAt)) return null
  if (info.invitedAt) return <span className="text-xs text-earth-500 self-center">{tr('Past volunteers invited')}</span>
  const send = async () => {
    if (!window.confirm(tr('Send a notice about this event to {n} people who came to your earlier events?', { n: info.count }))) return
    setBusy(true)
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${task.id}/invite-past`, { method: 'POST', headers: auth() })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || tr('Could not send the invitations.'))
      setInfo({ count: 0, invitedAt: new Date().toISOString() })
      onDone?.(tr('Invited {n} past volunteers.', { n: d.invited }))
    } catch (e) {
      onDone?.(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" onClick={send} disabled={busy} className="btn-sm btn-ghost">
      <UserPlus className="w-3.5 h-3.5 mr-1" /> {tr('Invite past volunteers ({n})', { n: info.count })}
    </button>
  )
}
