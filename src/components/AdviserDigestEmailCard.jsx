import { useEffect, useState } from 'react'
import { Mail } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  try {
    const token = localStorage.getItem('voluntrack:auth_token')
    return token ? { Authorization: `Bearer ${token}` } : null
  } catch {
    return null
  }
}

// An adviser's switch for the weekly summary email (server/adviserDigest.js,
// #527). Same shape as MonthlyProgressEmailCard; the email's own unsubscribe
// link can only turn it off, this turns it back on.
export default function AdviserDigestEmailCard() {
  const [enabled, setEnabled] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const headers = authHeaders()
    if (!headers) return
    let cancelled = false
    fetch(`${apiUrl}/adviser-digest/preference`, { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data) setEnabled(data.enabled) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (enabled === null) return null

  const toggle = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/adviser-digest/preference`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !enabled }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || tr('Could not save your email preference.'))
      setEnabled(data.enabled)
    } catch (e) {
      setError(e.message || tr('Could not save your email preference.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display font-semibold mb-1 flex items-center gap-2">
            <Mail className="w-4 h-4 text-brand-600" /> {tr('Weekly adviser email')}
          </h3>
          <p className="text-sm text-earth-500 dark:text-earth-400">
            {enabled
              ? tr('On. Every Monday we email you what needs your review, who is behind on hours and what students logged that week.')
              : tr("Off. We won't email you a weekly summary.")}
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          aria-pressed={enabled}
          className={`btn-sm shrink-0 ${enabled ? 'btn-ghost' : 'btn-primary'} disabled:opacity-50`}
        >
          {busy ? tr('Saving…') : enabled ? tr('Turn off') : tr('Turn on')}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-500 mt-2">{error}</p>}
    </Card>
  )
}
