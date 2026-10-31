import { useEffect, useState } from 'react'
import { Webhook, Copy, Check, Trash2, Send, RefreshCw } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

async function call(path = '', opts = {}) {
  let token = null
  try { token = localStorage.getItem('voluntrack:auth_token') } catch { /* storage blocked */ }
  const res = await fetch(`${apiUrl}/webhooks${path}`, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || tr('Something went wrong.'))
  return body
}

// Settings → Webhooks (#622): VolunTrack calls your own https address when
// something happens. Each call is signed with the secret shown once here.
export default function WebhooksCard() {
  const [state, setState] = useState(null)
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState([])
  const [secret, setSecret] = useState(null)
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(null) // endpoint id whose deliveries are shown
  const [deliveries, setDeliveries] = useState([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const load = () => call().then(setState).catch(() => setState(false))
  useEffect(() => { load() }, [])
  if (!state) return null

  const act = async (fn) => {
    setBusy(true); setError(''); setNote('')
    try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const create = (e) => {
    e.preventDefault()
    act(async () => {
      const out = await call('', { method: 'POST', body: JSON.stringify({ url, events }) })
      setSecret(out.secret); setUrl(''); setEvents([]); load()
    })
  }
  const showDeliveries = (id) => act(async () => {
    if (open === id) { setOpen(null); return }
    setDeliveries((await call(`/${id}/deliveries`)).deliveries); setOpen(id)
  })
  const test = (id) => act(async () => {
    const r = await call(`/${id}/test`, { method: 'POST' })
    setNote(r.ok ? tr('Test sent: your server answered {code}.', { code: r.status }) : tr('Test failed: {error}', { error: r.error || r.status }))
    if (open === id) setDeliveries((await call(`/${id}/deliveries`)).deliveries)
  })
  const resend = (id, endpointId) => act(async () => {
    const r = await call(`/deliveries/${id}/resend`, { method: 'POST' })
    setNote(r.ok ? tr('Sent again.') : tr('Still failing: {error}', { error: r.error || r.status }))
    setDeliveries((await call(`/${endpointId}/deliveries`)).deliveries)
  })
  const toggle = (ep) => act(async () => { await call(`/${ep.id}`, { method: 'PATCH', body: JSON.stringify({ active: !ep.active }) }); load() })
  const remove = (ep) => {
    if (!window.confirm(tr('Delete the webhook to {url}?', { url: ep.url }))) return
    act(async () => { await call(`/${ep.id}`, { method: 'DELETE' }); load() })
  }
  const copy = async () => { try { await navigator.clipboard.writeText(secret); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* on screen */ } }

  return (
    <Card>
      <h3 className="font-display font-semibold mb-1 flex items-center gap-2"><Webhook className="w-4 h-4 text-brand-600" />{' '}{tr('Webhooks')}</h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">{tr('VolunTrack calls your own https address when something happens, so your systems don’t have to keep asking. Each call is signed so you can check it came from us.')}</p>
      {secret && (
        <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-sm font-medium">{tr('Copy the signing secret now. It won’t be shown again.')}</p>
          <div className="mt-2 flex gap-2">
            <code className="flex-1 min-w-0 break-all rounded bg-black/20 px-2 py-1 text-xs">{secret}</code>
            <button type="button" className="btn-ghost btn-sm shrink-0" onClick={copy}>{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}</button>
          </div>
          <button type="button" className="text-xs underline mt-2" onClick={() => setSecret(null)}>{tr('I’ve saved it')}</button>
        </div>
      )}
      {state.endpoints.length > 0 && (
        <ul className="mb-3 divide-y divide-earth-100 dark:divide-white/10">
          {state.endpoints.map((ep) => (
            <li key={ep.id} className="py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-mono break-all">{ep.url}</p>
                  <p className="text-xs text-earth-500">{ep.events.join(' · ')}{!ep.active && ` · ${tr('Off')}`}{ep.failingSince && ep.active && ` · ${tr('failing')}`}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button type="button" className="btn-ghost btn-sm" onClick={() => test(ep.id)} disabled={busy} title={tr('Send test event')}><Send className="w-3.5 h-3.5" /></button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => toggle(ep)} disabled={busy}>{ep.active ? tr('Turn off') : tr('Turn on')}</button>
                  <button type="button" className="btn-ghost btn-sm text-red-400" onClick={() => remove(ep)} disabled={busy} aria-label={tr('Delete')}><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              <button type="button" className="text-xs underline mt-1" onClick={() => showDeliveries(ep.id)}>{open === ep.id ? tr('Hide recent deliveries') : tr('Recent deliveries')}</button>
              {open === ep.id && (
                <ul className="mt-2 space-y-1 text-xs">
                  {deliveries.length === 0 && <li className="text-earth-500">{tr('Nothing sent yet.')}</li>}
                  {deliveries.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">{d.event} · {d.status}{d.responseCode ? ` (${d.responseCode})` : ''}{d.error ? ` · ${d.error}` : ''} · {new Date(d.createdAt).toLocaleString()}</span>
                      {d.status !== 'delivered' && <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => resend(d.id, ep.id)} disabled={busy}><RefreshCw className="w-3 h-3 mr-1" />{tr('Resend')}</button>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={create} className="space-y-2">
        <input className="input w-full" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.org/voluntrack-webhook" required />
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          {state.events.map((ev) => (
            <label key={ev} className="flex items-center gap-1.5 text-sm font-mono">
              <input type="checkbox" checked={events.includes(ev)} onChange={() => setEvents((l) => (l.includes(ev) ? l.filter((x) => x !== ev) : [...l, ev]))} /> {ev}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="btn-primary btn-sm" disabled={busy || !url || events.length === 0}>{tr('Add webhook')}</button>
      </form>
      {note && <p className="text-sm text-brand-600 dark:text-brand-300 mt-2">{note}</p>}
      {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
    </Card>
  )
}
