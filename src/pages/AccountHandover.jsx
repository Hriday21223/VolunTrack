import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { fetchHandover, acceptHandover } from '@/lib/handover.js'

// The new principal's or director's side of a handover (#550), opened from
// the emailed link. No sign-in: the one-time link is the key.
export default function AccountHandover() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [info, setInfo] = useState({ loading: true, data: null, error: '' })
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) { setInfo({ loading: false, data: null, error: 'This link is missing its code. Open it from the email again.' }); return }
    fetchHandover(token)
      .then((data) => setInfo({ loading: false, data, error: '' }))
      .catch((e) => setInfo({ loading: false, data: null, error: e.message }))
  }, [token])

  const accept = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await acceptHandover(token, info.data.hasAccount ? undefined : password)
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const d = info.data
  const closed = d && (d.used || d.expired)
  const what = d?.kind === 'organization' ? 'organization' : 'school'
  return (
    <div className="min-h-screen grid place-items-center px-4 py-8 page-shell text-earth-900 dark:text-earth-100">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2.5 justify-center mb-6">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="" className="w-10 h-10 object-contain" />
          <span className="font-display font-bold text-2xl">VolunTrack</span>
        </Link>
        <Card padded={false} className="p-6">
          {info.loading ? (
            <p className="text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></p>
          ) : info.error || closed ? (
            <div className="text-center">
              <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
              <p className="text-sm text-earth-500 dark:text-earth-400">
                {info.error || (d.used ? 'This invite was already accepted. Sign in instead.' : 'This invite has expired. Ask for a new one.')}
              </p>
              {d?.used && <Link to="/login" className="btn-primary btn-sm mt-4 inline-flex">Sign in</Link>}
            </div>
          ) : done ? (
            <div className="text-center space-y-3">
              <CheckCircle2 className="w-10 h-10 text-brand-500 mx-auto" />
              <p className="font-semibold">You’re now the main admin of {d.place}</p>
              <p className="text-sm text-earth-500 dark:text-earth-400">Sign in with {d.email}{d.hasAccount ? '' : ' and the password you just chose'}.</p>
              <Link to="/login" className="btn-primary inline-flex">Sign in</Link>
            </div>
          ) : (
            <form onSubmit={accept} className="space-y-4">
              <div>
                <h1 className="font-display font-bold text-xl">Take over {d.place}</h1>
                <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">
                  Hi {d.name}, you’ve been invited to become the main admin of this {what}’s VolunTrack account.
                  {what === 'school' ? ' The current main admin stays on as a co-admin until you remove them.' : ' The current main account will be removed from the organization.'}
                </p>
              </div>
              <div>
                <label className="label">Email</label>
                <input className="input" value={d.email} disabled />
              </div>
              {d.hasAccount ? (
                <p className="text-sm text-earth-500 dark:text-earth-400">You already have an account with this email. Accept, then sign in as usual.</p>
              ) : (
                <div>
                  <label className="label">Choose a password</label>
                  <input className="input" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
              )}
              {error && <p className="text-sm text-red-500">{error}</p>}
              <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? 'Accepting…' : 'Accept'}</button>
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}
