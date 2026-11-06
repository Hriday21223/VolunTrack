import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { CheckCircle, Clock, LogIn, AlertTriangle } from 'lucide-react'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import { useData } from '@/hooks/useData.jsx'
import { tr } from '@/lib/i18n.js'
import ScanCheckinButton from '@/components/ScanCheckinButton.jsx'
import CheckinJob, { hasJobs } from '@/components/CheckinJob.jsx'

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
  // The job pop-up (#759), shown once per check-in result.
  const [jobOpen, setJobOpen] = useState(false)
  const [error, setError] = useState('')
  const sent = useRef(null)
  // The volunteer's check-in PIN (#668), asked for after the scan.
  const [pinNeeded, setPinNeeded] = useState(false)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)

  const send = useCallback(async (pinValue) => {
    const res = await fetch(`${apiUrl}/school/public-tasks/${encodeURIComponent(taskId)}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` },
      body: JSON.stringify(pinValue ? { screenCode: pinValue } : { code }),
    })
    const body = await res.json().catch(() => ({}))
    if (body.screenCodeRequired) { setPinNeeded(true); if (pinValue) setError(body.error || ''); return }
    setPinNeeded(false)
    if (!res.ok) throw new Error(body.error || 'Could not check you in.')
    setError('')
    setResult(body)
    setJobOpen(body?.state === 'checked_in' && hasJobs(body.jobs))
  }, [code, taskId])

  const submitPin = async (e) => {
    e.preventDefault()
    setBusy(true)
    try { await send(pin) } catch (err) { setError(err.message) } finally { setBusy(false); setPin('') }
  }

  useEffect(() => {
    // Once per visit: React's development double-run must not scan twice, but
    // scanning again from this page (to check out) is a new visit.
    if (sent.current === visit) return
    sent.current = visit
    setResult(null)
    setError('')
    if (!code) { setError(tr("This link has no check-in code. Scan the QR code on the organizer's screen.")); return }
    setPinNeeded(false)
    send('').catch((e) => setError(e.message))
  }, [code, taskId, visit, send])

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
  if (pinNeeded) {
    icon = <LogIn className="w-10 h-10 text-brand-400" />
    heading = tr('Look at the organizer’s screen')
    lines = [tr('A 4-digit code is showing under your name. Type it here within 2 minutes.')]
  } else if (error) {
    icon = <AlertTriangle className="w-10 h-10 text-amber-400" />
    heading = tr("Couldn't check you in")
    lines = [error]
  } else if (result?.state === 'checked_in') {
    icon = <LogIn className="w-10 h-10 text-brand-400" />
    heading = result.tooSoon ? tr("You're already checked in") : tr("You're checked in")
    lines = [`${result.title} · ${tr('since {time}', { time: time(result.checkedInAt) })}`, tr('Scan the same QR code again when you leave. Your hours are then sent to the organizer to sign.')]
  } else if (result?.state === 'checked_out' || result?.state === 'done') {
    icon = <CheckCircle className="w-10 h-10 text-emerald-400" />
    heading = result.state === 'done' ? tr('Already checked out') : tr('Checked out — thank you!')
    lines = [
      `${result.title} · ${time(result.checkedInAt)}–${time(result.checkedOutAt)}`,
      result.leftEarly ? tr('You stayed {stayed} of the {minimum} minutes this event asks for, so the organizer will review your hours.', { stayed: result.leftEarly.stayed, minimum: result.leftEarly.minimum }) : '',
      !result.leftEarly && result.hours != null ? tr(result.logged === false
        ? (result.hours === 1 ? '1 hour was already logged for today.' : '{n} hours were already logged for today.')
        : (result.hours === 1 ? '1 hour sent to the organizer to sign.' : '{n} hours sent to the organizer to sign.'), { n: result.hours }) : '',
    ].filter(Boolean)
  }

  return (
    <AppLayout title={tr('Check-in')} subtitle={tr('Volunteer task')}>
      <div className="max-w-md mx-auto">
        <Card className="text-center py-8">
          <div className="grid place-items-center">{icon}</div>
          <h1 className="text-xl font-bold mt-3">{heading}</h1>
          {lines.map((l) => <p key={l} className="text-sm text-earth-400 mt-2">{l}</p>)}
          {pinNeeded && (
            <form onSubmit={submitPin} className="mt-4 flex flex-col items-center gap-3">
              <input
                className="input text-center text-2xl tracking-[0.4em] w-48"
                inputMode="numeric" autoComplete="one-time-code" maxLength={4} pattern="\d{4}" required autoFocus
                value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                aria-label={tr('Code from the organizer’s screen')}
              />
              {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
              <button type="submit" className="btn-primary" disabled={busy || pin.length !== 4}>{busy ? tr('Checking…') : tr('Check in')}</button>
            </form>
          )}
          {!pinNeeded && (result?.state === 'checked_in' || error) && (
            <div className="mt-5 flex justify-center">
              <ScanCheckinButton label={result?.state === 'checked_in' ? tr('Scan to check out') : tr('Scan again')} />
            </div>
          )}
          {result?.state === 'checked_in' && <CheckinJob jobs={result.jobs} tone="light" />}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link to="/" className="btn-primary">{tr('Go to dashboard')}</Link>
            <Link to="/attendance" className="btn-ghost">{tr('My sign-ups')}</Link>
          </div>
        </Card>
      </div>
      {jobOpen && (
        <div className="fixed inset-0 z-[120] bg-black/70 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={tr('Your job right now')}>
          <div className="w-full max-w-sm rounded-2xl bg-[#14241b] p-6 text-center text-white shadow-2xl">
            <CheckCircle className="w-10 h-10 mx-auto text-emerald-400" />
            <p className="mt-2 text-xl font-bold">{tr("You're checked in")}</p>
            <CheckinJob jobs={result.jobs} />
            <button type="button" className="btn-primary mt-5 w-full justify-center" autoFocus onClick={() => setJobOpen(false)}>{tr('Got it')}</button>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
