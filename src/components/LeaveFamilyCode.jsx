import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

// Family dashboard (#833): a child can leave the family link only with a
// one-time code made here. Shown once, works for 15 minutes.
export default function LeaveFamilyCode({ child }) {
  const [code, setCode] = useState(null) // { pin, until }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!code) return undefined
    const t = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(t)
  }, [code])
  const first = String(child.name || '').split(/\s+/)[0] || tr('your child')

  const make = async () => {
    setBusy(true); setError('')
    try {
      const res = await fetch(`${apiUrl}/parent/children/${encodeURIComponent(child.id)}/leave-pin`, { method: 'POST', headers: auth() })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || tr('Could not make a code.'))
      const t = Date.now()
      setNow(t)
      setCode({ pin: d.pin, until: t + (d.minutes || 15) * 60000 })
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const live = code && now < code.until
  return (
    <div className="mb-4 rounded-xl border border-white/10 p-3 text-sm">
      <p className="font-medium flex items-center gap-1.5"><KeyRound className="w-4 h-4 text-brand-600" aria-hidden="true" />{' '}{tr('Code to leave the family')}</p>
      <p className="text-xs text-earth-500 mt-0.5">{tr('{name} needs a one-time code from you to stop sharing their hours with you.', { name: first })}</p>
      {live ? (
        <div className="mt-2">
          <p className="font-mono text-2xl tracking-[0.3em]">{code.pin}</p>
          <p className="text-xs text-earth-500">{tr('Works once, for {n} more minutes. They enter it in Settings → Family.', { n: Math.max(1, Math.round((code.until - now) / 60000)) })}</p>
        </div>
      ) : (
        <button type="button" className="btn-ghost btn-sm mt-2" onClick={make} disabled={busy}>
          {busy ? tr('Making…') : code ? tr('Make a new code') : tr('Make a code')}
        </button>
      )}
      {error && <p className="text-sm text-red-400 mt-2" role="alert">{error}</p>}
    </div>
  )
}
