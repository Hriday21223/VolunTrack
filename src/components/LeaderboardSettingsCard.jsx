import { useEffect, useState } from 'react'
import { Trophy } from 'lucide-react'
import Card from '@/components/Card.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}`,
})

// The school's switch for the student leaderboard (#485). Staff can see it;
// only the school admin can change it (the server enforces that too).
export default function LeaderboardSettingsCard({ canEdit }) {
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    fetch(`${apiUrl}/school/leaderboard/settings`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setState(d))
      .catch(() => {})
  }, [])

  if (!state) return null

  const toggle = async () => {
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`${apiUrl}/school/leaderboard/settings`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ enabled: !state.enabled }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not save the setting.')
      setState((s) => ({ ...s, enabled: d.enabled }))
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold mb-1 flex items-center gap-2"><Trophy className="w-4 h-4 text-brand-600" /> Student leaderboard</h3>
          <p className="text-sm text-earth-500 dark:text-earth-400">
            {state.enabled
              ? `On. Students who join see a top-10 of your school by approved hours (first name and last initial only). Under-13s never appear. ${state.joined} ${state.joined === 1 ? 'student has' : 'students have'} joined.`
              : 'Off. Your students don’t see a leaderboard.'}
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={toggle} disabled={busy} aria-pressed={state.enabled}
            className={`btn-sm shrink-0 ${state.enabled ? 'btn-ghost' : 'btn-primary'}`}>
            {busy ? 'Saving…' : state.enabled ? 'Turn off' : 'Turn on'}
          </button>
        )}
      </div>
      {err && <p className="text-sm text-red-500 mt-2">{err}</p>}
    </Card>
  )
}
