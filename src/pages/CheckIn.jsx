import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { CheckCircle, Clock, LogIn, AlertTriangle } from 'lucide-react'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import { useData } from '@/hooks/useData.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '')

// Where a volunteer lands after scanning an organizer's check-in QR code
// (CheckinQrModal). The first scan checks in; the second, at least ten minutes
// later, checks out and logs the hours, approved by the organizer.
export default function CheckIn() {
  const { taskId } = useParams()
  const [params] = useSearchParams()
  const code = params.get('c') || ''
  const { refreshLogs } = useData()
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const sent = useRef(false)

  useEffect(() => {
    // Once per page: React's development double-run must not scan twice.
    if (sent.current) return
    sent.current = true
    if (!code) { setError('This link has no check-in code. Scan the QR code on the organizer\'s screen.'); return }
    ;(async () => {
      try {
        const res = await fetch(`${apiUrl}/school/public-tasks/${encodeURIComponent(taskId)}/checkin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` },
          body: JSON.stringify({ code }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error || 'Could not check you in.')
        setResult(body)
      } catch (e) {
        setError(e.message)
      }
    })()
  }, [code, taskId])

  // The new entry is on the server; bring it to this device.
  useEffect(() => {
    if (result?.state === 'checked_out') {
      import('@/lib/logSync.js').then(({ syncPullLogs }) => {
        const user = JSON.parse(localStorage.getItem('voluntrack:user::session') || 'null')
        if (user?.id) syncPullLogs(user.id).then(() => refreshLogs?.())
      }).catch(() => {})
    }
  }, [result, refreshLogs])

  let icon = <Clock className="w-10 h-10 text-earth-400" />
  let heading = 'Checking you in…'
  let lines = []
  if (error) {
    icon = <AlertTriangle className="w-10 h-10 text-amber-400" />
    heading = "Couldn't check you in"
    lines = [error]
  } else if (result?.state === 'checked_in') {
    icon = <LogIn className="w-10 h-10 text-brand-400" />
    heading = result.tooSoon ? "You're already checked in" : "You're checked in"
    lines = [`${result.title} · since ${time(result.checkedInAt)}`, 'Scan the same QR code again when you leave, and your hours will be logged and approved.']
  } else if (result?.state === 'checked_out' || result?.state === 'done') {
    icon = <CheckCircle className="w-10 h-10 text-emerald-400" />
    heading = result.state === 'done' ? 'Already checked out' : 'Checked out — thank you!'
    lines = [
      `${result.title} · ${time(result.checkedInAt)}–${time(result.checkedOutAt)}`,
      result.hours != null ? `${result.hours} hour${result.hours === 1 ? '' : 's'} ${result.logged === false ? 'were already logged for today' : 'logged and approved'}.` : '',
    ].filter(Boolean)
  }

  return (
    <AppLayout title="Check-in" subtitle="Volunteer task">
      <div className="max-w-md mx-auto">
        <Card className="text-center py-8">
          <div className="grid place-items-center">{icon}</div>
          <h1 className="text-xl font-bold mt-3">{heading}</h1>
          {lines.map((l) => <p key={l} className="text-sm text-earth-400 mt-2">{l}</p>)}
          <div className="mt-6 flex justify-center gap-2">
            <Link to="/" className="btn-primary">Go to dashboard</Link>
            <Link to="/attendance" className="btn-ghost">My sign-ups</Link>
          </div>
        </Card>
      </div>
    </AppLayout>
  )
}
