import { useCallback, useEffect, useState } from 'react'
import { Trophy, Medal } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const token = () => { try { return localStorage.getItem('voluntrack:auth_token') } catch { return null } }

const RANK_COLORS = { 1: 'text-amber-400', 2: 'text-slate-300', 3: 'text-orange-400' }

// The school leaderboard on the student dashboard (#485). Only classmates
// ever see it, and only students who joined are on it, as "First L." with
// approved hours. Hidden entirely when there's no school, the school turned
// it off, or the student is under 13 (the server decides; see school.js).
export default function LeaderboardCard({ className = '' }) {
  const [period, setPeriod] = useState('month')
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (p) => {
    const t = token()
    if (!t) return
    try {
      const res = await fetch(`${apiUrl}/school/leaderboard?period=${p}`, { headers: { Authorization: `Bearer ${t}` } })
      const d = await res.json().catch(() => null)
      if (res.ok && d) setData(d)
    } catch { /* the dashboard works without it */ }
  }, [])

  useEffect(() => { load(period) }, [load, period])

  if (!data?.available) return null

  const setOptIn = async (optIn) => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/school/leaderboard/opt-in`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ optIn }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || tr('Could not save that.'))
      await load(period)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const meOnList = data.top.some((r) => r.isMe)

  return (
    <Card className={`p-4 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="font-display font-semibold text-sm flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-400" />
          {data.schoolName ? tr('Top volunteers at {school}', { school: data.schoolName }) : tr('Top volunteers at your school')}
        </div>
        <div className="flex gap-1" role="group" aria-label={tr('Leaderboard period')}>
          {[['month', tr('This month')], ['year', tr('This school year')]].map(([p, label]) => (
            <button key={p} type="button" onClick={() => setPeriod(p)} aria-pressed={period === p}
              className={`btn-sm ${period === p ? 'btn-primary' : 'btn-ghost'}`}>{label}</button>
          ))}
        </div>
      </div>

      {data.top.length === 0 ? (
        <p className="text-sm text-earth-400 py-2">
          {data.optedIn
            ? tr('No approved hours yet for this period. Yours could be first!')
            : tr('Nobody is on the leaderboard yet. Join and be the first!')}
        </p>
      ) : (
        <ol className="space-y-1">
          {data.top.map((r, i) => (
            <li key={`${r.rank}-${i}`} className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-sm ${r.isMe ? 'bg-brand-500/15 ring-1 ring-brand-500/40' : ''}`}>
              <span className="flex items-center gap-2 min-w-0">
                <span className={`w-6 text-right font-semibold ${RANK_COLORS[r.rank] || 'text-earth-400'}`}>
                  {r.rank <= 3 ? <Medal className="w-4 h-4 inline" aria-label={`#${r.rank}`} /> : `#${r.rank}`}
                </span>
                <span className="truncate text-earth-100">{r.name}{r.isMe ? ` (${tr('you')})` : ''}</span>
              </span>
              <span className="shrink-0 font-semibold text-earth-100">{r.hours} h</span>
            </li>
          ))}
        </ol>
      )}

      {data.optedIn && data.me && !meOnList && (
        <p className="mt-2 text-sm text-earth-300">{tr("You're #{rank} with {hours} approved hours.", { rank: data.me.rank, hours: data.me.hours })}</p>
      )}

      <div className="mt-3 pt-3 border-t border-white/5">
        {data.optedIn ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-earth-400">
            <span>{tr("You're on the leaderboard. Classmates see your first name, last initial and approved hours.")}</span>
            <button type="button" className="btn-sm btn-ghost" onClick={() => setOptIn(false)} disabled={busy}>{tr('Leave')}</button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-earth-400">{tr('Join to appear here. Only students at your school see it: your first name, last initial and approved hours.')}</span>
            <button type="button" className="btn-sm btn-primary" onClick={() => setOptIn(true)} disabled={busy}>{tr('Join the leaderboard')}</button>
          </div>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
      </div>
    </Card>
  )
}
