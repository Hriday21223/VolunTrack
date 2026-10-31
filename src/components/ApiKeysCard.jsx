import { useEffect, useState } from 'react'
import { KeyRound, Copy, Check, Trash2 } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { tr } from '@/lib/i18n.js'
import { fmtDate } from '@/utils/date.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

const SCOPE_LABELS = {
  'students:read': () => tr('Students (name, email, grade)'),
  'hours:read': () => tr('Hours logged'),
  'progress:read': () => tr('Progress toward the requirement'),
  'reports:read': () => tr('Impact report numbers'),
  'events:read': () => tr('Your events, sign-ups and attendance'),
}

async function call(path = '', opts = {}) {
  let token = null
  try { token = localStorage.getItem('voluntrack:auth_token') } catch { /* storage blocked */ }
  const res = await fetch(`${apiUrl}/api-keys${path}`, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || tr('Something went wrong.'))
  return body
}

// Settings → API keys (#622): read-only keys for a school's, an organization's
// or an organizer's own systems. The key is shown once, right after it's made.
export default function ApiKeysCard() {
  const [state, setState] = useState(null)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState([])
  const [mode, setMode] = useState('live')
  const [fresh, setFresh] = useState(null) // the new key, shown once
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = () => call().then(setState).catch(() => setState(false))
  useEffect(() => { load() }, [])
  if (!state) return null

  const create = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const out = await call('', { method: 'POST', body: JSON.stringify({ name, scopes, mode }) })
      setFresh(out.key)
      setName('')
      setScopes([])
      load()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const revoke = async (k) => {
    if (!window.confirm(tr('Revoke “{name}”? Anything using it stops working at once.', { name: k.name }))) return
    try { await call(`/${encodeURIComponent(k.id)}`, { method: 'DELETE' }); load() } catch (err) { setError(err.message) }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(fresh); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* shown on screen */ }
  }
  const toggle = (s) => setScopes((list) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]))
  const active = state.keys.filter((k) => !k.revokedAt)

  return (
    <Card>
      <h3 className="font-display font-semibold mb-1 flex items-center gap-2"><KeyRound className="w-4 h-4 text-brand-600" />{' '}{tr('API keys')}</h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">
        {tr('Let your own systems (a student information system, a spreadsheet, a dashboard) read your VolunTrack data. Keys are read-only. Treat a key like a password: anyone who has it can read what it allows.')}
      </p>

      {fresh && (
        <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-sm font-medium">{tr('Copy your new key now. It won’t be shown again.')}</p>
          <div className="mt-2 flex gap-2">
            <code className="flex-1 min-w-0 break-all rounded bg-black/20 px-2 py-1 text-xs">{fresh}</code>
            <button type="button" className="btn-ghost btn-sm shrink-0" onClick={copy}>{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}</button>
          </div>
          <button type="button" className="text-xs underline mt-2" onClick={() => setFresh(null)}>{tr('I’ve saved it')}</button>
        </div>
      )}

      {active.length > 0 && (
        <ul className="mb-3 divide-y divide-earth-100 dark:divide-white/10">
          {active.map((k) => (
            <li key={k.id} className="py-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{k.name}{k.mode === 'test' && <span className="chip ml-2 text-xs">{tr('Test')}</span>}</p>
                <p className="text-xs text-earth-500 font-mono">{k.prefix}_…</p>
                <p className="text-xs text-earth-500">
                  {k.scopes.map((s) => SCOPE_LABELS[s]?.() || s).join(' · ')}
                  {' · '}{k.lastUsedAt ? tr('last used {date}', { date: fmtDate(String(k.lastUsedAt).slice(0, 10)) }) : tr('never used')}
                </p>
              </div>
              <button type="button" className="btn-ghost btn-sm text-red-400 shrink-0" onClick={() => revoke(k)}><Trash2 className="w-3.5 h-3.5 mr-1" />{tr('Revoke')}</button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={create} className="space-y-2">
        <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={tr('Key name, like “PowerSchool sync”')} required />
        <fieldset className="space-y-1">
          <legend className="text-xs font-medium text-earth-500 uppercase tracking-wide mb-1">{tr('What it can read')}</legend>
          {state.scopes.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggle(s)} /> {SCOPE_LABELS[s]?.() || s}
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mode === 'test'} onChange={(e) => setMode(e.target.checked ? 'test' : 'live')} /> {tr('Test key (returns sample data only)')}
        </label>
        <button type="submit" className="btn-primary btn-sm" disabled={busy || !name.trim() || scopes.length === 0}>{busy ? tr('Creating…') : tr('Create key')}</button>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </form>
    </Card>
  )
}
