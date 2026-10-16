import { useState, useEffect, useCallback } from 'react'
import { Bot, CheckCircle2, XCircle, RefreshCw, ExternalLink } from 'lucide-react'
import Card from '@/components/Card.jsx'

// The live-site test robot's results (#315): scripts/live-check.mjs runs from
// GitHub Actions every 6 hours and reports to GET/POST /api/status/live-checks.
// Admin-only, unlike the public incidents listed below it.
export default function LiveChecksCard() {
  const apiUrl = import.meta.env.VITE_API_URL || '/api'
  const [runs, setRuns] = useState(null)
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/status/live-checks`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Could not load the live checks.')
      setRuns(data)
    } catch (e) {
      setError(e.message)
    }
  }, [apiUrl])

  useEffect(() => { load() }, [load])

  const latest = runs?.[0]
  const failing = latest ? latest.results.filter((r) => !r.ok) : []

  return (
    <Card className="mb-6">
      <div className="flex items-center gap-2 mb-1">
        <Bot className="w-4 h-4 text-brand-600" />
        <h3 className="font-display font-semibold flex-1">Live checks</h3>
        <button type="button" onClick={load} className="btn-ghost btn-sm" aria-label="Refresh live checks">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
      <p className="text-xs text-earth-500 dark:text-earth-400 mb-4">
        A robot tests the live site every 6 hours and emails you when a check fails twice in a row. Only admins see this.
      </p>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : runs === null ? (
        <p className="text-sm text-earth-400">Loading…</p>
      ) : !latest ? (
        <p className="text-sm text-earth-500">No runs yet. The first one reports within 6 hours of deploying.</p>
      ) : (
        <>
          <div className={`flex items-center gap-2 text-sm font-medium mb-3 ${latest.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {latest.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {latest.ok
              ? `All ${latest.results.length} checks passed`
              : `${failing.length} of ${latest.results.length} checks failing`}
            <span className="text-earth-400 font-normal">· {new Date(latest.ranAt).toLocaleString()}</span>
            {latest.runUrl && (
              <a href={latest.runUrl} target="_blank" rel="noopener noreferrer" className="text-brand-600 dark:text-brand-400 font-normal inline-flex items-center gap-1">
                Run <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          <ul className="space-y-1.5">
            {[...failing, ...latest.results.filter((r) => r.ok)].map((r) => (
              <li key={r.name} className="flex items-start gap-2 text-sm">
                {r.ok
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                  : <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />}
                <span className="min-w-0">
                  <span className="font-medium text-earth-800 dark:text-earth-200">{r.name}</span>
                  {r.detail && <span className={`block text-xs break-words ${r.ok ? 'text-earth-400' : 'text-red-600 dark:text-red-400'}`}>{r.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
          {runs.length > 1 && (
            <div className="mt-4">
              <button type="button" onClick={() => setShowHistory((v) => !v)} className="text-xs text-brand-700 dark:text-brand-300 font-medium hover:underline">
                {showHistory ? 'Hide history' : `Show the last ${runs.length} runs`}
              </button>
              {showHistory && (
                <ul className="mt-2 space-y-1 text-xs text-earth-500 dark:text-earth-400">
                  {runs.map((run) => (
                    <li key={run.ranAt} className="flex items-center gap-2">
                      {run.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <XCircle className="w-3.5 h-3.5 text-red-500" />}
                      {new Date(run.ranAt).toLocaleString()}
                      {!run.ok && <span className="truncate">— {run.results.filter((r) => !r.ok).map((r) => r.name).join(', ')}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  )
}
