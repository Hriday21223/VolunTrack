import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, MessageCircleQuestion } from 'lucide-react'
import { tr } from '@/lib/i18n.js'
import { fmtDate } from '@/utils/date.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const QUESTION_MAX = 300
const ANSWER_MAX = 1000

const token = () => {
  try { return localStorage.getItem('voluntrack:auth_token') } catch { return null }
}

async function call(path, options = {}) {
  const t = token()
  const res = await fetch(`${apiUrl}/school/public-tasks/${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || tr('Something went wrong.'))
  return data
}

// One question for the organizer: answer it, edit the answer, hide or delete.
function OrganizerQuestion({ taskId, q, readOnly, onChanged }) {
  const [draft, setDraft] = useState(q.answer || '')
  const [editing, setEditing] = useState(!q.answer)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const run = async (fn) => {
    setBusy(true)
    setError('')
    try { await fn(); await onChanged() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const base = `${encodeURIComponent(taskId)}/questions/${encodeURIComponent(q.id)}`
  const save = () => run(async () => {
    await call(`${base}/answer`, { method: 'PUT', body: JSON.stringify({ answer: draft }) })
    setEditing(false)
  })
  const toggleHidden = () => run(() => call(`${base}/answer`, { method: 'PUT', body: JSON.stringify({ hidden: !q.hidden }) }))
  const remove = () => run(() => call(base, { method: 'DELETE' }))

  return (
    <li className={`p-2 rounded-lg bg-earth-100 dark:bg-[#15211b] ${q.hidden ? 'opacity-60' : ''}`}>
      <p className="text-earth-500">
        {q.askerName} · {fmtDate(q.createdAt)}
        {q.hidden && <span className="ml-2 text-amber-400">{tr('Hidden')}</span>}
        {!q.answer && !q.hidden && <span className="ml-2 text-brand-400">{tr('Needs an answer')}</span>}
      </p>
      <p className="mt-1 text-earth-700 dark:text-earth-200 whitespace-pre-wrap break-words">{q.question}</p>
      {editing && !readOnly ? (
        <div className="mt-2 space-y-1">
          <textarea
            className="input text-xs"
            rows={2}
            maxLength={ANSWER_MAX}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={tr('Your answer — everyone who can see this task will see it')}
            aria-label={tr('Your answer')}
          />
          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={busy || !draft.trim()} className="btn-sm btn-primary">{q.answer ? tr('Save answer') : tr('Answer')}</button>
            {q.answer && <button type="button" onClick={() => { setDraft(q.answer); setEditing(false) }} className="btn-sm btn-ghost">{tr('Cancel')}</button>}
            <span className="text-earth-600 ml-auto">{draft.length}/{ANSWER_MAX}</span>
          </div>
        </div>
      ) : q.answer && (
        <p className="mt-1 pl-2 border-l-2 border-brand-500/40 text-earth-600 dark:text-earth-300 whitespace-pre-wrap break-words">{q.answer}</p>
      )}
      {!readOnly && (
        <div className="mt-1 flex flex-wrap items-center gap-3 text-earth-500">
          {q.answer && !editing && <button type="button" onClick={() => setEditing(true)} className="hover:text-brand-400">{tr('Edit answer')}</button>}
          <button type="button" onClick={toggleHidden} disabled={busy} className="hover:text-amber-400">{q.hidden ? tr('Unhide') : tr('Hide')}</button>
          {confirmDelete ? (
            <span className="flex items-center gap-2">
              {tr('Delete this question?')}
              <button type="button" onClick={remove} disabled={busy} className="text-red-400 font-medium">{tr('Yes')}</button>
              <button type="button" onClick={() => setConfirmDelete(false)}>{tr('No')}</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="hover:text-red-400">{tr('Delete')}</button>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-red-400" role="alert">{error}</p>}
    </li>
  )
}

/**
 * "Ask the organizer" on a task card (#436). Students see answered questions
 * and their own; the organizer sees every question with the asker's first
 * name and last initial, and answers inline. Loads only when opened.
 * `task.question_count` (and `open_question_count` on My Tasks) come from the
 * task list, so a closed section costs no request.
 */
export default function TaskQuestions({ task, organizer = false, className = '' }) {
  const openCount = Number(task.open_question_count) || 0
  const [open, setOpen] = useState(organizer && openCount > 0)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const load = useCallback(async () => {
    try {
      setError('')
      setData(await call(`${encodeURIComponent(task.id)}/questions`))
    } catch (e) {
      setError(e.message)
    }
  }, [task.id])

  useEffect(() => { if (open) load() }, [open, load])

  const count = data ? data.questions.length : Number(task.question_count) || 0
  // On My Tasks, a task nobody has asked about needs no section.
  if (organizer && !data && count === 0) return null

  const ask = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await call(`${encodeURIComponent(task.id)}/questions`, { method: 'POST', body: JSON.stringify({ question: draft }) })
      setDraft('')
      setSent(true)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const withdraw = async (q) => {
    try {
      await call(`${encodeURIComponent(task.id)}/questions/${encodeURIComponent(q.id)}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  const waiting = data?.isOrganizer ? data.questions.filter((q) => !q.answer && !q.hidden).length : openCount

  return (
    <div className={`text-xs ${className}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-earth-400 hover:text-brand-400"
      >
        <MessageCircleQuestion className="w-3.5 h-3.5" />
        {tr('Questions ({n})', { n: count })}
        {organizer && waiting > 0 && <span className="text-brand-400">· {tr('{n} unanswered', { n: waiting })}</span>}
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {!data && !error && <p className="text-earth-500">{tr('Loading…')}</p>}
          {data && data.questions.length === 0 && (
            <p className="text-earth-500">{data.isOrganizer ? tr('No questions yet.') : tr('No answered questions yet. Ask the organizer below.')}</p>
          )}
          {data?.isOrganizer ? (
            <ul className="space-y-2">
              {data.questions.map((q) => (
                <OrganizerQuestion key={`${q.id}:${q.answer || ''}`} taskId={task.id} q={q} readOnly={data.readOnly} onChanged={load} />
              ))}
            </ul>
          ) : data && (
            <ul className="space-y-2">
              {data.questions.map((q) => (
                <li key={q.id} className="p-2 rounded-lg bg-earth-100 dark:bg-[#15211b]">
                  <p className="text-earth-700 dark:text-earth-200 whitespace-pre-wrap break-words">{q.question}</p>
                  {q.answer ? (
                    <p className="mt-1 pl-2 border-l-2 border-brand-500/40 text-earth-600 dark:text-earth-300 whitespace-pre-wrap break-words">
                      <span className="font-medium">{tr('Organizer')}:</span> {q.answer}
                    </p>
                  ) : (
                    <p className="mt-1 text-earth-500">{tr('Waiting for an answer. Only you and the organizer can see this.')}</p>
                  )}
                  {q.mine && (
                    <button type="button" onClick={() => withdraw(q)} className="mt-1 text-earth-500 hover:text-red-400">{tr('Delete my question')}</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {data?.canAsk && (
            <form onSubmit={ask} className="space-y-1">
              <textarea
                className="input text-xs"
                rows={2}
                maxLength={QUESTION_MAX}
                value={draft}
                onChange={(e) => { setDraft(e.target.value); setSent(false) }}
                placeholder={tr('Ask the organizer a question')}
                aria-label={tr('Ask the organizer a question')}
              />
              <div className="flex items-center gap-2">
                <button type="submit" disabled={busy || !draft.trim()} className="btn-sm btn-secondary">{tr('Ask')}</button>
                <span className="text-earth-600">{draft.length}/{QUESTION_MAX}</span>
              </div>
              <p className="text-earth-600">{tr('Other students never see your name. Once answered, your question and the answer are shown to everyone who can see this task.')}</p>
            </form>
          )}
          {sent && <p className="text-emerald-400">{tr('Question sent. You’ll get a notification when the organizer answers.')}</p>}
          {data?.readOnly && <p className="text-earth-500">{tr('This task was cancelled, so questions are closed.')}</p>}
          {error && <p className="text-red-400" role="alert">{error}</p>}
        </div>
      )}
    </div>
  )
}
