import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, XCircle, ShieldCheck, AlertTriangle } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { getVerificationStatus } from '@/lib/supervisorNotify.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

export default function VerifyHours() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const [state, setState] = useState({ loading: true, data: null, error: '' })
  const [busy, setBusy] = useState(false)

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

  const respond = async (action) => {
    setBusy(true)
    try {
      const response = await fetch(`${apiUrl}/verify-hours/${encodeURIComponent(token)}/${action}`, { method: 'POST' })
      const body = await response.json().catch(() => ({}))
      if (response.ok && body.status) {
        setState((s) => ({ ...s, data: { ...s.data, status: body.status } }))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4 py-8 bg-gradient-to-br from-brand-50 via-earth-50 to-earth-100 dark:from-[#0f1813] dark:via-[#0f1813] dark:to-[#14201a] text-earth-900 dark:text-earth-100">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2.5 justify-center mb-6">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="VolunTrack" className="w-10 h-10 object-contain" />
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
            <VerifyCard data={state.data} busy={busy} onRespond={respond} />
          )}
        </Card>
      </div>
    </div>
  )
}

function VerifyCard({ data, busy, onRespond }) {
  if (data.status === 'approved') {
    return (
      <div className="text-center">
        <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
        <h1 className="text-xl font-bold">Hours approved</h1>
        <p className="text-sm text-earth-500 dark:text-earth-400 mt-2">
          You approved {data.hours} hour(s) logged by {data.studentName} for "{data.activity}".
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
      <div className="flex gap-3">
        <button onClick={() => onRespond('approve')} disabled={busy} className="btn-primary flex-1 justify-center">
          Approve
        </button>
        <button onClick={() => onRespond('reject')} disabled={busy} className="btn-ghost flex-1 justify-center border border-earth-200 dark:border-[#1f2e25]">
          Reject
        </button>
      </div>
    </div>
  )
}
