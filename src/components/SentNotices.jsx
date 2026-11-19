import { useEffect, useState } from 'react'
import { Bell, Trash2 } from 'lucide-react'
import Card from '@/components/Card.jsx'
import useEscapeKey from '@/hooks/useEscapeKey.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

const sentTo = (n) => {
  if (n.audience === 'all') return 'All schools'
  return n.name || (n.audience === 'organization' ? 'An organization' : 'A school')
}

// Admin: the payment notices sent so far, with a way to take one down (#946).
// Deleting removes it from dashboards; an email already delivered stays.
// Two clicks instead of a browser popup, like deleting an incident.
export default function SentNotices({ onClose }) {
  const [notices, setNotices] = useState(null)
  const [error, setError] = useState('')
  const [confirmId, setConfirmId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  useEscapeKey(onClose)

  useEffect(() => {
    let live = true
    fetch(`${apiUrl}/school/admin/notices`, { headers: authHeaders() })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Could not load the notices.')
        if (live) setNotices(data.notices)
      })
      .catch((e) => { if (live) { setError(e.message); setNotices([]) } })
    return () => { live = false }
  }, [])

  const remove = async (id) => {
    if (confirmId !== id) { setConfirmId(id); return }
    setDeletingId(id)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/school/admin/notices/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not delete the notice.')
      setNotices((list) => list.filter((n) => n.id !== id))
      setConfirmId(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="sent-notices-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="sent-notices-title" className="font-semibold mb-1 flex items-center gap-2"><Bell className="w-4 h-4 text-brand-400" /> Sent notices</h3>
        <p className="text-sm text-earth-400 mb-4">Deleting a notice removes it from their dashboard. Emails that already went out can&apos;t be taken back.</p>
        {error && <p role="alert" className="text-sm text-red-500 mb-3">{error}</p>}
        {notices === null ? (
          <p className="text-sm text-earth-400 py-4 text-center">Loading…</p>
        ) : notices.length === 0 ? (
          <p className="text-sm text-earth-400 py-4 text-center">No notices.</p>
        ) : (
          <ul className="space-y-2">
            {notices.map((n) => (
              <li key={n.id} className="p-2.5 rounded-lg bg-earth-500/5 text-sm flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap break-words">{n.message}</p>
                  <p className="text-xs text-earth-400 mt-1">{sentTo(n)} · {new Date(n.createdAt).toLocaleDateString()}</p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(n.id)}
                  onBlur={() => setConfirmId((id) => (id === n.id ? null : id))}
                  disabled={deletingId === n.id}
                  className="text-xs font-semibold px-2.5 py-1 rounded shrink-0 inline-flex items-center gap-1 border border-red-300 dark:border-red-800 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50"
                >
                  <Trash2 className="w-3 h-3" aria-hidden="true" />
                  {deletingId === n.id ? 'Deleting…' : confirmId === n.id ? 'Confirm delete?' : 'Delete'}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={onClose} className="btn-ghost w-full mt-4">Close</button>
      </Card>
    </div>
  )
}
