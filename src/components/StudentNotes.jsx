import { useEffect, useState } from 'react'
import { Lock, Trash2 } from 'lucide-react'
import { notesCall as call } from '@/lib/studentNotes.js'

// An adviser's private notes on one student (#567): only this school's
// advisers see them. server/routes/school.js.
export default function StudentNotes({ studentId, onCount }) {
  const [notes, setNotes] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    call(`/students/${encodeURIComponent(studentId)}/notes`)
      .then((d) => { if (live) setNotes(d.notes || []) })
      .catch((e) => { if (live) { setNotes([]); setError(e.message) } })
    return () => { live = false }
  }, [studentId])

  const add = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    setError('')
    try {
      const { note } = await call(`/students/${encodeURIComponent(studentId)}/notes`, { method: 'POST', body: { body: text } })
      const next = [note, ...(notes || [])]
      setNotes(next)
      onCount?.(next.length)
      setText('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id) => {
    try {
      await call(`/student-notes/${encodeURIComponent(id)}`, { method: 'DELETE' })
      const next = notes.filter((n) => n.id !== id)
      setNotes(next)
      onCount?.(next.length)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-earth-200 dark:border-white/10 p-3 space-y-3">
      <p className="flex items-center gap-1.5 text-xs text-earth-500"><Lock className="w-3 h-3" /> Only your school’s advisers can see these notes.</p>
      <form onSubmit={add} className="flex flex-col sm:flex-row gap-2">
        <textarea className="input flex-1" rows={2} maxLength={1000} placeholder="e.g. Talked to mom about missing hours" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn-primary btn-sm sm:self-start" disabled={busy || !text.trim()}>{busy ? 'Saving…' : 'Add note'}</button>
      </form>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {notes === null ? (
        <p className="text-xs text-earth-500">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="text-xs text-earth-500">No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="text-sm flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="whitespace-pre-line break-words">{n.body}</p>
                <p className="text-xs text-earth-500">{n.authorName} · {new Date(n.createdAt).toLocaleDateString()}</p>
              </div>
              {n.mine && (
                <button type="button" className="p-1 text-red-400 hover:text-red-300 shrink-0" onClick={() => remove(n.id)} aria-label="Delete note">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
