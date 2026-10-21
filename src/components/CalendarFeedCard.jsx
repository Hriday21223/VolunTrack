import { useState } from 'react'
import { CalendarDays, Copy, CheckCircle2, RefreshCw } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return token ? { Authorization: `Bearer ${token}` } : null
}

// A subscribable calendar of the tasks you signed up for or posted
// (GET /api/school/calendar/:token.ics). The link is the only key to it, so
// it's made only when asked for, and Reset replaces it, killing the old one.
export default function CalendarFeedCard() {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  if (!authHeaders()) return null

  const load = async (reset = false) => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/school/calendar/feed${reset ? '/reset' : ''}`, {
        method: reset ? 'POST' : 'GET',
        headers: authHeaders(),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) throw new Error(data.error || tr('Could not get your calendar link.'))
      setUrl(data.url)
      setCopied(false)
      setConfirmReset(false)
    } catch (e) {
      setError(e.message || tr('Could not get your calendar link.'))
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError(tr('Could not copy. Select the link and copy it yourself.'))
    }
  }

  const webcal = url.replace(/^https?:\/\//, 'webcal://')
  const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`

  return (
    <Card>
      <h3 className="font-display font-semibold mb-3 flex items-center gap-2">
        <CalendarDays className="w-4 h-4 text-brand-600" /> {tr('Calendar feed')}
      </h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">
        {tr('Subscribe once and the tasks you signed up for or posted show up in your phone or computer calendar, and stay up to date.')}
      </p>
      {!url ? (
        <button onClick={() => load(false)} disabled={busy} className="btn-primary inline-flex items-center gap-2">
          <CalendarDays className="w-4 h-4" /> {busy ? tr('Getting your link…') : tr('Get my calendar link')}
        </button>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input readOnly value={url} onFocus={(e) => e.target.select()} className="input flex-1 min-w-0 text-xs" aria-label={tr('Calendar feed link')} />
            <button onClick={copy} className="btn-secondary inline-flex items-center gap-1.5 shrink-0 text-sm">
              {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? tr('Copied') : tr('Copy link')}
            </button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <a href={webcal} className="btn-primary inline-flex items-center justify-center gap-2 text-sm">{tr('Subscribe in Apple Calendar')}</a>
            <a href={google} target="_blank" rel="noopener noreferrer" className="btn-secondary inline-flex items-center justify-center gap-2 text-sm">{tr('Subscribe in Google Calendar')}</a>
          </div>
          <p className="text-xs text-amber-500">{tr('Anyone with this link can see your task list. If you shared it by mistake, reset it.')}</p>
          {confirmReset ? (
            <div className="rounded-xl border border-white/10 p-3 space-y-2">
              <p className="text-sm">{tr('Reset the link? The old one stops working, so calendars subscribed to it stop updating.')}</p>
              <div className="flex gap-2">
                <button onClick={() => load(true)} disabled={busy} className="btn-danger flex-1 text-sm">{busy ? tr('Resetting…') : tr('Yes, reset')}</button>
                <button onClick={() => setConfirmReset(false)} disabled={busy} className="btn-ghost flex-1 text-sm">{tr('No')}</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmReset(true)} className="btn-ghost inline-flex items-center gap-2 text-sm">
              <RefreshCw className="w-4 h-4" /> {tr('Reset link')}
            </button>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-400 mt-2" role="alert">{error}</p>}
    </Card>
  )
}
