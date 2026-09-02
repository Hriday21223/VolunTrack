import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { Loader2, ShieldAlert } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth.jsx'

// Landing page for the redirect back from the school's identity provider.
// The backend hands over a single-use code (never the JWT itself), which we
// trade for a real session here.
export default function SsoReturn() {
  const { ssoExchange } = useAuth()
  const [params] = useSearchParams()
  const nav = useNavigate()
  const [err, setErr] = useState('')
  // React 18 StrictMode double-invokes effects in dev; the code is single-use,
  // so a second exchange would always fail and clobber a successful sign-in.
  const claimed = useRef(false)

  useEffect(() => {
    if (claimed.current) return
    claimed.current = true

    const code = params.get('code')
    const returnTo = params.get('returnTo') || '/dashboard'
    if (!code) {
      setErr('This sign-in link is missing its code. Please try signing in again.')
      return
    }

    ssoExchange(code)
      .then(() => nav(returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/dashboard', { replace: true }))
      .catch((e) => setErr(e.message))
  }, [params, ssoExchange, nav])

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4 text-white">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/70 p-8 text-center shadow-soft">
        {err ? (
          <>
            <ShieldAlert className="mx-auto mb-4 h-10 w-10 text-red-400" />
            <h1 className="text-xl font-semibold">Sign-in didn&apos;t complete</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">{err}</p>
            <Link to="/login" className="btn-primary mt-6 inline-flex px-5 py-2.5 text-sm font-semibold">
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-brand-300" />
            <h1 className="text-xl font-semibold">Signing you in…</h1>
            <p className="mt-3 text-sm text-slate-400">Finishing up with your school&apos;s login.</p>
          </>
        )}
      </div>
    </div>
  )
}
