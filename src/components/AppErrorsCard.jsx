import { useCallback, useEffect, useState } from 'react'
import { Bug, Trash2 } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { fromNow } from '@/utils/date.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

// Admin → Incidents: errors from people's browsers and the apps
// (src/lib/errorReporting.js), grouped, newest first.
export default function AppErrorsCard() {
  const [errors, setErrors] = useState(null)
  const [open, setOpen] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/client-errors/admin`, { headers: headers() })
      const data = await res.json().catch(() => ({}))
      setErrors(res.ok ? data.errors || [] : [])
    } catch {
      setErrors([])
    }
  }, [])
  useEffect(() => { load() }, [load])

  const clear = async (fingerprint) => {
    await fetch(`${apiUrl}/client-errors/admin${fingerprint ? `/${fingerprint}` : ''}`, { method: 'DELETE', headers: headers() }).catch(() => {})
    load()
  }

  if (errors === null) return null
  return (
    <Card>
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 className="font-display font-semibold flex items-center gap-2"><Bug className="w-4 h-4 text-brand-600" /> App errors</h3>
        {errors.length > 0 && <button onClick={() => clear(null)} className="btn-sm btn-ghost">Clear all</button>}
      </div>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">Errors in people's browsers and the apps, grouped. No names or emails are recorded.</p>
      {errors.length === 0 ? (
        <p className="text-sm text-earth-500 dark:text-earth-400">No errors reported.</p>
      ) : (
        <ul className="space-y-2">
          {errors.map((e) => (
            <li key={e.fingerprint} className="rounded-xl border border-white/10 p-3">
              <div className="flex items-start justify-between gap-3">
                <button onClick={() => setOpen(open === e.fingerprint ? null : e.fingerprint)} className="text-left min-w-0">
                  <p className="text-sm font-medium break-words">{e.message}</p>
                  <p className="text-xs text-earth-500 mt-0.5">
                    {e.count}× · last {fromNow(e.last_seen)} · {e.path || 'unknown page'}{e.app_version ? ` · v${e.app_version}` : ''}
                  </p>
                </button>
                <button onClick={() => clear(e.fingerprint)} className="btn-ghost p-1 shrink-0" aria-label="Clear this error"><Trash2 className="w-4 h-4" /></button>
              </div>
              {open === e.fingerprint && (
                <pre className="mt-2 text-xs whitespace-pre-wrap break-words text-earth-400 max-h-60 overflow-auto">{e.stack || 'No stack trace.'}{e.user_agent ? `\n\n${e.user_agent}` : ''}</pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
