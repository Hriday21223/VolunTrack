import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { CheckCircle, Clock, LogIn, AlertTriangle } from 'lucide-react'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import { useData } from '@/hooks/useData.jsx'
import { tr } from '@/lib/i18n.js'
import ScanCheckinButton from '@/components/ScanCheckinButton.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '')

// Where a volunteer lands after scanning an organizer's check-in QR code
// (CheckinQrModal). The first scan checks in; the second, at least ten minutes
// later, checks out and logs the hours, approved by the organizer.
export default function CheckIn() {
  const { taskId } = useParams()
  const [params] = useSearchParams()
  // Each visit or in-app scan is a new history entry with its own key, even
  // when the code hasn't changed.
  const { key: visit } = useLocation()
  const code = params.get('c') || ''
  const { refreshLogs } = useData()
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const sent = useRef(null)

  useEffect(() => {
    // Once per visit: React's development double-run must not scan twice, but
    // scanning again from this page (to check out) is a new visit.
    if (sent.current === visit) return
    sent.current = visit
    setResult(null)
    setError('')
    if (!code) { setError(tr("This link has no check-in code. Scan the QR code on the organizer's screen.")); return }
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
  }, [code, taskId, visit])

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
  let heading = tr('Checking you in…')
  let lines = []
  if (error) {
    icon = <AlertTriangle className="w-10 h-10 text-amber-400" />
    heading = tr("Couldn't check you in")
    lines = [error]
  } else if (result?.state === 'checked_in') {
    icon = <LogIn className="w-10 h-10 text-brand-400" />
    heading = result.tooSoon ? tr("You're already checked in") : tr("You're checked in")
    lines = [`${result.title} · ${tr('since {time}', { time: time(result.checkedInAt) })}`, tr('Scan the same QR code again when you leave, and your hours will be logged and approved.')]
  } else if (result?.state === 'checked_out' || result?.state === 'done') {
    icon = <CheckCircle className="w-10 h-10 text-emerald-400" />
    heading = result.state === 'done' ? tr('Already checked out') : tr('Checked out — thank you!')
    lines = [
      `${result.title} · ${time(result.checkedInAt)}–${time(result.checkedOutAt)}`,
      result.hours != null ? tr(result.logged === false
        ? (result.hours === 1 ? '1 hour was already logged for today.' : '{n} hours were already logged for today.')
        : (result.hours === 1 ? '1 hour logged and approved.' : '{n} hours logged and approved.'), { n: result.hours }) : '',
    ].filter(Boolean)
  }

  return (
    <AppLayout title={tr('Check-in')} subtitle={tr('Volunteer task')}>
      <div className="max-w-md mx-auto">
        <Card className="text-center py-8">
          <div className="grid place-items-center">{icon}</div>
          <h1 className="text-xl font-bold mt-3">{heading}</h1>
          {lines.map((l) => <p key={l} className="text-sm text-earth-400 mt-2">{l}</p>)}
          {(result?.state === 'checked_in' || error) && (
            <div className="mt-5 flex justify-center">
              <ScanCheckinButton label={result?.state === 'checked_in' ? tr('Scan to check out') : tr('Scan again')} />
            </div>
          )}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link to="/" className="btn-primary">{tr('Go to dashboard')}</Link>
            <Link to="/attendance" className="btn-ghost">{tr('My sign-ups')}</Link>
          </div>
        </Card>
      </div>
    </AppLayout>
  )
}
