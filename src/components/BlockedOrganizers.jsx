import { useEffect, useState } from 'react'
import { Ban } from 'lucide-react'
import Card from '@/components/Card.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return token ? { Authorization: `Bearer ${token}` } : null
}

// Organizers this person blocked from a task report (ReportTaskDialog.jsx):
// their tasks are hidden and their messages don't arrive. Unblocking undoes both.
export default function BlockedOrganizers() {
  const [blocks, setBlocks] = useState(null)
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    const headers = authHeaders()
    if (!headers) return
    fetch(`${apiUrl}/reports/blocks`, { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setBlocks(d?.blocks || []))
      .catch(() => setBlocks([]))
  }, [])

  if (!authHeaders() || blocks === null) return null

  const unblock = async (id) => {
    setBusy(id)
    try {
      const res = await fetch(`${apiUrl}/reports/blocks/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() })
      if (res.ok) setBlocks((list) => list.filter((b) => b.id !== id))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <div className="flex items-center gap-2 mb-2">
        <Ban className="w-4 h-4 text-brand-600" />
        <h3 className="font-display font-semibold">Blocked organizers</h3>
      </div>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">
        You don't see these organizers' volunteer tasks, and their messages don't reach you.
      </p>
      {blocks.length === 0 ? (
        <p className="text-sm text-earth-500 dark:text-earth-400">You haven't blocked anyone. You can block an organizer when you report one of their tasks.</p>
      ) : (
        <ul className="space-y-2">
          {blocks.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-2">
              <span className="text-sm font-medium truncate">{b.name}</span>
              <button onClick={() => unblock(b.id)} disabled={busy === b.id} className="btn-ghost text-sm shrink-0">
                {busy === b.id ? 'Unblocking…' : 'Unblock'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
