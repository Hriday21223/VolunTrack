import { useEffect, useState } from 'react'
import { RefreshCw, GraduationCap, Unplug } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

async function call(path, opts = {}) {
  let token = null
  try { token = localStorage.getItem('voluntrack:auth_token') } catch { /* storage blocked */ }
  const res = await fetch(`${apiUrl}/roster-sync${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || tr('Something went wrong.'))
  return body
}

// Students → Add → Import from Google Classroom or Clever (#608). Each class's
// students get the same invite as "Invite a whole class": nobody is linked
// until they accept. Saved classes re-sync nightly; anyone who left is listed
// here, never removed.
export default function RosterSyncCard({ onDone }) {
  const [status, setStatus] = useState(null)
  const [provider, setProvider] = useState(null) // 'google' | 'clever' while picking
  const [classes, setClasses] = useState(null)
  const [picked, setPicked] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState(null)

  const load = () => call('/status').then(setStatus).catch(() => setStatus(false))
  useEffect(() => {
    load()
    // Back from Google's consent screen: ?roster=google | error | cancelled.
    const q = new URLSearchParams(window.location.search)
    const r = q.get('roster')
    if (r === 'error') setError(q.get('msg') || tr('Could not connect Google Classroom.'))
    if (r === 'google') openPicker('google')
    if (r) window.history.replaceState({}, '', window.location.pathname)
  }, [])

  if (!status || (!status.google.available && !status.clever.available)) return null

  async function openPicker(which) {
    setBusy(true)
    setError('')
    setResults(null)
    try {
      const body = which === 'google' ? await call('/google/courses') : await call('/clever/sections')
      setClasses(which === 'google' ? body.courses : body.sections)
      setPicked(new Set())
      setProvider(which)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const connectGoogle = async () => {
    setBusy(true)
    setError('')
    try {
      const { url } = await call('/google/start', { method: 'POST' })
      window.location.assign(url)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  const disconnectGoogle = async () => {
    await call('/google', { method: 'DELETE' }).catch(() => {})
    setProvider(null)
    load()
  }

  const sync = async (which, sections) => {
    setBusy(true)
    setError('')
    try {
      const body = await call('/sync', { method: 'POST', body: JSON.stringify({ provider: which, sections }) })
      setResults(body.results)
      setProvider(null)
      load()
      onDone?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const saved = status.sections || []
  const togglePick = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <Card className="mb-4">
      <h3 className="font-semibold mb-1 flex items-center gap-2"><GraduationCap className="w-4 h-4 text-brand-600" /> {tr('Import from Google Classroom or Clever')}</h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">
        {tr('Pick your classes and every student gets an invite, like Invite a whole class. Nobody is linked until they accept. Imported classes are checked again every night for new students.')}
      </p>
      <div className="flex flex-wrap gap-2">
        {status.google.available && (status.google.connected ? (
          <>
            <button type="button" className="btn-secondary btn-sm" onClick={() => openPicker('google')} disabled={busy}>{tr('Pick Google Classroom classes')}</button>
            <button type="button" className="btn-ghost btn-sm" onClick={disconnectGoogle} disabled={busy}><Unplug className="w-3.5 h-3.5 mr-1" />{tr('Disconnect Google')}</button>
          </>
        ) : (
          <button type="button" className="btn-secondary btn-sm" onClick={connectGoogle} disabled={busy}>{tr('Connect Google Classroom')}</button>
        ))}
        {status.clever.available && (
          <button type="button" className="btn-secondary btn-sm" onClick={() => openPicker('clever')} disabled={busy}>{tr('Pick Clever sections')}</button>
        )}
      </div>
      {error && <p className="text-sm text-red-500 mt-2">{error}</p>}

      {provider && classes && (
        <div className="mt-3 rounded-xl border border-earth-200 dark:border-white/10 p-3">
          {classes.length === 0 ? (
            <p className="text-sm text-earth-500">{provider === 'google' ? tr('No active classes where you are a teacher.') : tr('No Clever sections found for your email. Your district needs to share its data with VolunTrack in Clever first.')}</p>
          ) : (
            <>
              <ul className="space-y-1.5 max-h-64 overflow-y-auto">
                {classes.map((c) => (
                  <li key={c.id}>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={picked.has(c.id)} onChange={() => togglePick(c.id)} disabled={!picked.has(c.id) && picked.size >= 10} />
                      {c.name || c.id}
                    </label>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn-primary btn-sm mt-3" disabled={busy || picked.size === 0}
                onClick={() => sync(provider, classes.filter((c) => picked.has(c.id)).map((c) => ({ id: c.id, name: c.name })))}>
                {busy ? tr('Importing…') : tr('Import {n} classes', { n: picked.size })}
              </button>
            </>
          )}
        </div>
      )}

      {results && (
        <ul className="mt-3 space-y-2 text-sm">
          {results.map((r, i) => (
            <li key={i} className="rounded-lg bg-brand-500/5 px-3 py-2">
              <strong>{r.section}</strong>: {tr('{found} students found · {invited} invited in the app · {emailed} emailed · {here} already here', { found: r.found, invited: r.invited || 0, emailed: r.emailed || 0, here: r.alreadyHere || 0 })}
              {r.leftClass?.length > 0 && (
                <p className="text-amber-500 mt-1">{tr('No longer in this class: {names}. They are still linked to your school; remove them from the student list if they left.', { names: r.leftClass.map((s) => s.name || s.email).join(', ') })}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {saved.length > 0 && (
        <div className="mt-4 border-t border-earth-200 dark:border-white/10 pt-3">
          <p className="text-xs font-medium text-earth-500 uppercase tracking-wide mb-2">{tr('Imported classes')}</p>
          <ul className="space-y-1.5">
            {saved.map((s) => (
              <li key={`${s.provider}:${s.id}`} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{s.name || s.id} <span className="text-earth-500">· {s.provider === 'google' ? 'Google Classroom' : 'Clever'} · {tr('{n} students', { n: s.student_count })}</span></span>
                <button type="button" className="btn-ghost btn-sm shrink-0" disabled={busy} onClick={() => sync(s.provider, [{ id: s.id, name: s.name }])}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />{tr('Sync now')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
