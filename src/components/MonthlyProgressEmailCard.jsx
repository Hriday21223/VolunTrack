import { useEffect, useState } from 'react'
import { CalendarCheck } from 'lucide-react'
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

// The student's switch for the monthly progress email (server/monthlyProgress.js,
// #483): on the 1st, what they logged last month and how close they are to
// their goal. Same shape as ComebackEmailCard; the email's own unsubscribe
// link can only turn it off, this turns it back on.
export default function MonthlyProgressEmailCard() {
  const [enabled, setEnabled] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const headers = authHeaders()
    if (!headers) return
    let cancelled = false
    fetch(`${apiUrl}/progress/preference`, { headers })
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
      const res = await fetch(`${apiUrl}/progress/preference`, {
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
            <CalendarCheck className="w-4 h-4 text-brand-600" /> {tr('Monthly progress email')}
          </h3>
          <p className="text-sm text-earth-500 dark:text-earth-400">
            {enabled
              ? tr("On. After a month you logged hours, we'll email you on the 1st with what you logged and how close you are to your goal.")
              : tr("Off. We won't email you a monthly summary of your hours.")}
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
