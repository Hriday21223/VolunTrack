import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import Card from '@/components/Card.jsx'
import PasswordInput from '@/components/PasswordInput.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// /admin-invite?token= (#909): someone invited to the admin team picks their
// password. Admin pages are English only, like the admin dashboard.
export default function AdminInvite() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  useEffect(() => {
    if (!token) { setError('This link is missing its code.'); return }
    fetch(`${apiUrl}/admin/team/invite/${encodeURIComponent(token)}`)
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Could not open the invite.'); setInfo(d) })
      .catch((e) => setError(e.message))
  }, [token])

  const submit = async (e) => {
    e.preventDefault()
    if (password !== again) { setError('The two passwords are different.'); return }
    setBusy(true); setError('')
    try {
      const r = await fetch(`${apiUrl}/admin/team/invite/${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not set up your account.')
      setDone(d)
    } catch (e2) { setError(e2.message) } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen page-shell flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <h1 className="font-display text-xl font-semibold mb-2 flex items-center gap-2"><ShieldCheck className="w-5 h-5" aria-hidden="true" /> Join the VolunTrack admin team</h1>
        {done ? (
          <>
            <p className="text-sm text-earth-400 mb-4">Your admin account is ready. Sign in as <strong>{done.email}</strong>. The first time, you’ll set up two-step sign-in with an authenticator app.</p>
            <Link to="/login" className="btn-primary w-full">Sign in</Link>
          </>
        ) : info ? (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-sm text-earth-400">Hi {info.name.split(' ')[0]}, choose a password for <strong>{info.email}</strong>. Use at least 12 characters, and don’t reuse a password from another site.</p>
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password" autoComplete="new-password" aria-label="New password" />
            <PasswordInput value={again} onChange={(e) => setAgain(e.target.value)} placeholder="Type it again" autoComplete="new-password" aria-label="Type the password again" />
            {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
            <button type="submit" disabled={busy || password.length < 12 || !again} className="btn-primary w-full">{busy ? 'Setting up…' : 'Create my admin account'}</button>
          </form>
        ) : (
          <p className={`text-sm ${error ? 'text-red-500' : 'text-earth-400'}`} role={error ? 'alert' : undefined}>{error || 'Opening your invite…'}</p>
        )}
      </Card>
    </div>
  )
}
