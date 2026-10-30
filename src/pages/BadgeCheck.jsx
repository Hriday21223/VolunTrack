import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const fmt = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : '')

const WHY = {
  unknown: "This badge isn't one VolunTrack knows.",
  cancelled: 'This event was cancelled.',
  not_approved: "This volunteer's sign-up isn't approved (any more).",
  over: 'This event is over.',
}

// /badge/:code (#597): what event staff see when they scan a volunteer's
// badge. No sign-in. Only a first name and last initial, the event, and
// whether the badge is valid.
export default function BadgeCheck() {
  const { code } = useParams()
  const [state, setState] = useState({ loading: true, data: null })

  useEffect(() => {
    let alive = true
    fetch(`${apiUrl}/school/badge/${encodeURIComponent(code)}`)
      .then((res) => res.json().catch(() => ({ valid: false, reason: 'unknown' })))
      .then((data) => alive && setState({ loading: false, data }))
      .catch(() => alive && setState({ loading: false, data: { valid: false, reason: 'network' } }))
    return () => { alive = false }
  }, [code])

  const d = state.data
  const ok = d?.valid
  return (
    <div className={`min-h-screen grid place-items-center px-4 py-10 ${state.loading ? 'bg-earth-900' : ok ? 'bg-emerald-700' : 'bg-red-800'} text-white`}>
      <div className="w-full max-w-sm text-center">
        {state.loading ? (
          <Loader2 className="w-10 h-10 animate-spin mx-auto" />
        ) : (
          <>
            {ok ? <CheckCircle2 className="w-20 h-20 mx-auto" /> : <XCircle className="w-20 h-20 mx-auto" />}
            <h1 className="mt-4 font-display text-4xl font-extrabold">{ok ? 'Valid volunteer' : 'Not valid'}</h1>
            {d?.name && <p className="mt-3 text-2xl font-semibold">{d.name}</p>}
            {d?.event && (
              <div className="mt-4 rounded-2xl bg-black/20 p-4 text-left text-sm space-y-1">
                <p className="font-semibold text-base">{d.event.title}</p>
                <p>{fmt(d.event.date)}{d.event.time ? ` · ${d.event.time}` : ''}</p>
                {d.event.organizer && <p className="text-white/80">Organized by {d.event.organizer}</p>}
                {ok && <p className="pt-1 font-medium">{d.checkedIn ? 'Checked in ✓' : 'Not checked in yet'}</p>}
              </div>
            )}
            {!ok && <p className="mt-4 text-white/90">{d?.reason === 'network' ? "Couldn't reach VolunTrack. Check the connection and try again." : WHY[d?.reason] || WHY.unknown}</p>}
            <p className="mt-6 text-xs text-white/70">Checked {new Date().toLocaleString()} on <Link to="/" className="underline">VolunTrack</Link></p>
          </>
        )}
      </div>
    </div>
  )
}
