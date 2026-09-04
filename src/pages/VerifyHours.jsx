import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, XCircle, ShieldCheck, AlertTriangle, FileSignature } from 'lucide-react'
import Card from '@/components/Card.jsx'
import SignaturePad from '@/components/SignaturePad.jsx'
import { getVerificationStatus } from '@/lib/supervisorNotify.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// Rotating appreciation notes for the supervisor. Built as opener x closer
// combinations (10 x 10 = 100 unique notes per context) rather than 100 flat
// strings, so the pool stays reviewable while still rarely repeating.
const SUPERVISOR_THANKS_OPENERS = [
  (name) => `Thank you for taking the time to support ${name}'s volunteer work`,
  (name) => `${name} is lucky to have a supervisor who follows through on things like this`,
  (name) => `A quick thank you for verifying ${name}'s hours`,
  (name) => `Thanks for backing up ${name}'s hard work with your verification`,
  (name) => `We know your day is busy, so thank you for making time for ${name}'s verification`,
  (name) => `On behalf of ${name}, thank you for confirming this`,
  (name) => `Appreciate you taking a moment for ${name}'s hours`,
  (name) => `Thanks for standing behind ${name}'s work here`,
  (name) => `${name}'s record just got a little stronger, thanks to you`,
  (name) => `Big thanks for looking this over for ${name}`,
]
const SUPERVISOR_THANKS_CLOSERS = [
  'supervisors like you make programs like this possible.',
  "it's a small thing on your end, but it matters a lot on theirs.",
  'this kind of follow-through is what keeps student records trustworthy.',
  'volunteer work only counts for as much as someone is willing to vouch for it — and you just did.',
  "we don't take that for granted.",
  'that kind of support adds up over a school year.',
  'it genuinely helps more than a quick click might suggest.',
  'students notice when adults follow through like this.',
  "it's supervisors like you who make this program trustworthy.",
  'thanks for being part of how this works.',
]
const SUPERVISOR_STANDING_OPENERS = [
  (name) => `Thanks for taking a moment to verify ${name}'s hours`,
  (name) => `Your review helps keep ${name}'s record accurate and trusted`,
  (name) => `We know your time is limited, so thanks for spending some of it on ${name}'s work`,
  (name) => `${name} is counting on you here, and we appreciate you showing up for it`,
  (name) => `Reviewing this only takes a minute, but it matters a lot to ${name}`,
  (name) => `Thanks in advance for looking this over for ${name}`,
  (name) => `${name} listed you because they trust your word`,
  (name) => `Thanks for being the person ${name} can point to for this`,
  (name) => `A minute of your time helps ${name}'s record hold up`,
  (name) => `We appreciate supervisors like you making time for ${name}`,
]
const SUPERVISOR_STANDING_CLOSERS = [
  'it means a lot to have supervisors like you supporting student volunteers.',
  'thank you for making time for this.',
  "it's a small ask, but it counts for a lot.",
  'that trust is worth a lot to a student building a record.',
  'we appreciate it more than a quick click might suggest.',
  'thanks for helping keep this program credible.',
  'it genuinely helps.',
  'thank you for being someone students can rely on.',
  "we don't take it for granted.",
  'thanks for being part of how this works.',
]

function pickCombo(openers, closers, name) {
  const opener = openers[Math.floor(Math.random() * openers.length)](name)
  const closer = closers[Math.floor(Math.random() * closers.length)]
  return `${opener} — ${closer}`
}

export default function VerifyHours() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const [state, setState] = useState({ loading: true, data: null, error: '' })
  const [busy, setBusy] = useState(false)
  const [respondError, setRespondError] = useState('')
  // 'review' (approve/reject buttons) or 'signing' (approval needs a
  // signature first) — reject skips this step entirely.
  const [mode, setMode] = useState('review')
  const [signature, setSignature] = useState('')

  useEffect(() => {
    if (!token) {
      setState({ loading: false, data: null, error: 'Missing verification token.' })
      return
    }
    getVerificationStatus(token).then((data) => {
      if (!data) {
        setState({ loading: false, data: null, error: 'This verification link is invalid or has expired.' })
      } else {
        setState({ loading: false, data, error: '' })
      }
    })
  }, [token])

  const respond = async (action, sig) => {
    setBusy(true)
    setRespondError('')
    try {
      const response = await fetch(`${apiUrl}/verify-hours/${encodeURIComponent(token)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature: sig || null }),
      })
      const body = await response.json().catch(() => ({}))
      if (response.ok && body.status) {
        setState((s) => ({ ...s, data: { ...s.data, status: body.status } }))
      } else {
        setRespondError(body.error || 'Something went wrong — please try again.')
      }
    } catch {
      setRespondError('Something went wrong — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4 py-8 page-shell text-earth-900 dark:text-earth-100">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2.5 justify-center mb-6">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="VolunTrack" className="w-10 h-10 object-contain" />
          <span className="font-display font-bold text-2xl">VolunTrack</span>
        </Link>

        <Card padded={false} className="p-7">
          {state.loading ? (
            <div className="text-center text-sm text-earth-500 dark:text-earth-400">Loading…</div>
          ) : state.error ? (
            <div className="text-center">
              <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
              <p className="text-sm text-earth-500 dark:text-earth-400">{state.error}</p>
            </div>
          ) : (
            <VerifyCard
              data={state.data}
              busy={busy}
              error={respondError}
              mode={mode}
              signature={signature}
              onSign={setSignature}
              onStartApproval={() => setMode('signing')}
              onCancelApproval={() => { setMode('review'); setSignature('') }}
              onReject={() => respond('reject', null)}
              onConfirmApproval={() => respond('approve', signature)}
            />
          )}
        </Card>
      </div>
    </div>
  )
}

function VerifyCard({ data, busy, error, mode, signature, onSign, onStartApproval, onCancelApproval, onReject, onConfirmApproval }) {
  const thanksNote = useMemo(
    () => pickCombo(SUPERVISOR_THANKS_OPENERS, SUPERVISOR_THANKS_CLOSERS, data.studentName),
    [data.studentName],
  )
  const standingNote = useMemo(
    () => pickCombo(SUPERVISOR_STANDING_OPENERS, SUPERVISOR_STANDING_CLOSERS, data.studentName),
    [data.studentName],
  )

  if (data.status === 'approved') {
    return (
      <div className="text-center">
        <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
        <h1 className="text-xl font-bold">Hours approved</h1>
        <p className="text-sm text-earth-500 dark:text-earth-400 mt-2">
          You approved {data.hours} hour(s) logged by {data.studentName} for "{data.activity}".
        </p>
        <p className="text-sm text-brand-600 dark:text-brand-400 mt-4 font-medium">
          {thanksNote}
        </p>
      </div>
    )
  }
  if (data.status === 'rejected') {
    return (
      <div className="text-center">
        <XCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
        <h1 className="text-xl font-bold">Hours rejected</h1>
        <p className="text-sm text-earth-500 dark:text-earth-400 mt-2">
          You rejected {data.hours} hour(s) logged by {data.studentName} for "{data.activity}".
        </p>
      </div>
    )
  }
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <ShieldCheck className="w-6 h-6 text-brand-500 shrink-0" />
        <div>
          <h1 className="text-xl font-bold">Review these hours</h1>
          <p className="text-sm text-earth-500 dark:text-earth-400">You were listed as the supervisor.</p>
        </div>
      </div>
      <div className="rounded-2xl border border-earth-100 dark:border-[#1f2e25] p-4 mb-5">
        <p className="text-sm">
          <span className="font-semibold">{data.studentName}</span> logged{' '}
          <span className="font-semibold">{data.hours}</span> hour(s) for "{data.activity}".
        </p>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg mb-4">{error}</div>}

      {mode === 'signing' ? (
        <div>
          <label className="label flex items-center gap-1.5"><FileSignature className="w-4 h-4" /> Your signature</label>
          <SignaturePad value={signature} onChange={onSign} />
          <div className="hint mb-4">Sign to confirm this work was completed as described — this is what makes the approval count.</div>
          <div className="flex gap-3">
            <button onClick={onConfirmApproval} disabled={busy || !signature} className="btn-primary flex-1 justify-center">
              Confirm approval
            </button>
            <button onClick={onCancelApproval} disabled={busy} className="btn-ghost flex-1 justify-center border border-earth-200 dark:border-[#1f2e25]">
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-3">
          <button onClick={onStartApproval} disabled={busy} className="btn-primary flex-1 justify-center">
            Approve
          </button>
          <button onClick={onReject} disabled={busy} className="btn-ghost flex-1 justify-center border border-earth-200 dark:border-[#1f2e25]">
            Reject
          </button>
        </div>
      )}

      <p className="text-xs text-earth-500 dark:text-earth-400 text-center mt-4">
        {standingNote}
      </p>
    </div>
  )
}
