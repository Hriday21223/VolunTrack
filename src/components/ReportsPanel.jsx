import { useCallback, useEffect, useState } from 'react'
import { Flag, Trash2, Ban, Check, RotateCcw, ImageOff } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { fmtDate, fromNow } from '@/utils/date.js'
import { taskPhotoUrl } from '@/lib/taskPhoto.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

const REASONS = {
  unsafe: 'Unsafe or inappropriate',
  spam: 'Spam or a scam',
  misleading: 'Misleading or not a real event',
  other: 'Something else',
}
const OUTCOMES = {
  dismissed: 'Dismissed',
  task_removed: 'Task removed',
  poster_suspended: 'Organizer suspended',
}

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` }
}

// Admin → Reports: volunteer tasks people reported (server/routes/reports.js).
// Apple expects reports on content minors see to be acted on within a day.
export default function ReportsPanel() {
  const [reports, setReports] = useState(null)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(null) // { id, action }
  const [busy, setBusy] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/reports/admin`, { headers: authHeaders() })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not load reports.')
      setReports(data.reports || [])
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const act = async (id, action) => {
    setBusy(id)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/reports/admin/${encodeURIComponent(id)}/resolve`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ action }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not update the report.')
      setConfirming(null)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  const unsuspend = async (userId) => {
    setBusy(userId)
    try {
      await fetch(`${apiUrl}/reports/admin/users/${encodeURIComponent(userId)}/unsuspend`, { method: 'POST', headers: authHeaders() })
      await load()
    } finally {
      setBusy(null)
    }
  }

  if (reports === null) return <Card><p className="text-sm text-earth-500">{error || 'Loading reports…'}</p></Card>

  const pending = reports.filter((r) => r.status === 'pending')
  const done = reports.filter((r) => r.status !== 'pending')

  const row = (r) => (
    <Card key={r.id} padded={false} className="p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium flex items-center gap-2"><Flag className="w-4 h-4 text-red-400 shrink-0" /> {r.task_title || 'Task deleted'}</p>
          <p className="text-xs text-earth-500 mt-0.5">
            {r.task_location}{r.task_date ? ` · ${fmtDate(r.task_date)}` : ''}{r.task_status === 'cancelled' ? ' · removed/cancelled' : ''}
          </p>
        </div>
        <span className="text-xs text-earth-500 shrink-0">{fromNow(r.created_at)}</span>
      </div>
      {r.task_cover_photo_id && (
        <img src={taskPhotoUrl(r.task_cover_photo_id)} alt={r.task_title || 'Task photo'} loading="lazy" className="w-40 aspect-video object-cover rounded-lg bg-earth-100 dark:bg-white/5" />
      )}
      <p className="text-sm"><span className="font-medium">{REASONS[r.reason] || r.reason}</span>{r.details ? ` — ${r.details}` : ''}</p>
      <p className="text-xs text-earth-500">
        Posted by {r.poster_name || 'a deleted account'}{r.poster_email ? ` (${r.poster_email})` : ''}
        {r.posting_suspended_at ? ' · suspended from posting' : ''}
        {' · '}reported by {r.reporter_name || 'a deleted account'}{r.reporter_role ? ` (${r.reporter_role})` : ''}
        {r.reports_on_task > 1 ? ` · ${r.reports_on_task} reports on this task` : ''}
      </p>
      {r.status === 'pending' ? (
        confirming?.id === r.id ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-sm">{confirming.action === 'remove_task' ? 'Remove this task for everyone?' : confirming.action === 'remove_photo' ? 'Remove the photo and keep the task?' : 'Stop this organizer posting, and hide all their tasks?'}</span>
            <button onClick={() => act(r.id, confirming.action)} disabled={busy === r.id} className="btn-sm btn-danger">{busy === r.id ? 'Working…' : 'Yes, do it'}</button>
            <button onClick={() => setConfirming(null)} disabled={busy === r.id} className="btn-sm btn-ghost">Cancel</button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={() => act(r.id, 'dismiss')} disabled={busy === r.id} className="btn-sm btn-ghost"><Check className="w-3.5 h-3.5 mr-1" /> Dismiss</button>
            {r.task_status !== 'cancelled' && (
              <button onClick={() => setConfirming({ id: r.id, action: 'remove_task' })} className="btn-sm btn-ghost text-red-400"><Trash2 className="w-3.5 h-3.5 mr-1" /> Remove task</button>
            )}
            {r.task_cover_photo_id && (
              <button onClick={() => setConfirming({ id: r.id, action: 'remove_photo' })} className="btn-sm btn-ghost text-red-400"><ImageOff className="w-3.5 h-3.5 mr-1" /> Remove photo</button>
            )}
            {!r.posting_suspended_at && r.poster_id && (
              <button onClick={() => setConfirming({ id: r.id, action: 'suspend' })} className="btn-sm btn-ghost text-red-400"><Ban className="w-3.5 h-3.5 mr-1" /> Suspend organizer</button>
            )}
          </div>
        )
      ) : (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-earth-400">{OUTCOMES[r.status] || r.status}</span>
          {r.posting_suspended_at && r.poster_id && (
            <button onClick={() => unsuspend(r.poster_id)} disabled={busy === r.poster_id} className="btn-sm btn-ghost"><RotateCcw className="w-3.5 h-3.5 mr-1" /> Let them post again</button>
          )}
        </div>
      )}
    </Card>
  )

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-400">{error}</p>}
      <h3 className="font-display font-semibold">Waiting for a decision ({pending.length})</h3>
      {pending.length === 0 ? <Card><p className="text-sm text-earth-500">No open reports.</p></Card> : pending.map(row)}
      {done.length > 0 && (
        <>
          <h3 className="font-display font-semibold pt-2">Decided</h3>
          {done.map(row)}
        </>
      )}
    </div>
  )
}
