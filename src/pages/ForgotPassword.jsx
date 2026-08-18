import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, ArrowRight, CheckCircle2, AlertTriangle, Inbox, RefreshCw, Settings } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { useAuth } from '@/hooks/useAuth.jsx'
import { sendRecoveryEmail, getRecoveryStatus, fetchDevRecoveryCode } from '@/lib/recovery.js'

export default function ForgotPassword() {
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [delivery, setDelivery] = useState({ status: 'idle', reason: '', missingVars: [] })
  const [serverInfo, setServerInfo] = useState({ ok: false, smtpConfigured: false, missingVars: [], backendAvailable: false })
  const [retrying, setRetrying] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { getRecoveryStatus().then(setServerInfo) }, [])

  const attemptDelivery = async ({ email, code, type }) => {
    const status = await getRecoveryStatus()
    setServerInfo(status)
    if (!status.backendAvailable) {
      return { ok: false, reason: 'no-backend', backendAvailable: false }
    }
    const result = await sendRecoveryEmail({ email, code, type })
    if (!result.ok && result.missingVars?.length) {
      const dev = await fetchDevRecoveryCode(email)
      if (dev.ok) return { ok: true, code: dev.code, viaDev: true }
    }
    return result
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    setErr('')
    setDelivery({ status: 'sending', reason: '', missingVars: [] })

    try {
      const generated = await requestPasswordReset(email)
      setCode(generated)

      const result = await attemptDelivery({ email, code: generated, type: 'password' })
      if (result.ok && result.code) setCode(result.code)

      setDelivery(
        result.ok
          ? { status: 'sent', reason: '', missingVars: [] }
          : { status: 'fallback', reason: result.reason, missingVars: result.missingVars || [] }
      )
    } catch (error) {
      setDelivery({ status: 'idle', reason: '', missingVars: [] })
      setErr(error.message)
    }
  }

  const resend = async () => {
    setRetrying(true)
    const result = await attemptDelivery({ email, code, type: 'password' })
    if (result.ok && result.code) setCode(result.code)
    setDelivery(
      result.ok
        ? { status: 'sent', reason: '', missingVars: [] }
        : { status: 'fallback', reason: result.reason, missingVars: result.missingVars || serverInfo.missingVars || [] }
    )
    setRetrying(false)
  }

  const delivered = delivery.status === 'sent' || delivery.status === 'fallback'

  return (
    <div className="min-h-screen grid place-items-center px-4 bg-gradient-to-br from-brand-50 via-earth-50 to-earth-100 dark:from-[#0f1813] dark:via-[#0f1813] dark:to-[#14201a]">
      <div className="w-full max-w-md">
        <Link to="/login" className="flex items-center gap-2.5 justify-center mb-6 animate-fade-in-up">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="VolunTrack" className="w-10 h-10 object-contain" />
          <span className="font-display font-bold text-2xl">VolunTrack</span>
        </Link>

        <Card padded={false} className="p-7 animate-scale-in">
          {code && !delivered && (
            <div className="mb-6 rounded-2xl border border-brand-500/20 bg-brand-500/10 p-3 text-sm text-brand-900 dark:text-brand-100">
              Password recovery code: <span className="font-semibold">{code}</span>
            </div>
          )}

          {delivered ? (
            <div className="animate-fade-in-up">
              <div className="w-12 h-12 rounded-full bg-brand-100 dark:bg-brand-900/30 grid place-items-center text-brand-700 mx-auto animate-bounce-in">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h1 className="text-2xl font-bold mt-3 text-center animate-fade-in-up" style={{ animationDelay: '100ms' }}>Password recovery code ready</h1>

              {delivery.status === 'sent' ? (
                <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200 flex items-start gap-2 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
                  <Inbox className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    A password recovery code has been emailed to <span className="font-semibold">{email}</span>. It expires in 15 minutes.
                    Don't see it? Check the Spam folder and Promotions/Updates tab.
                  </span>
                </div>
              ) : (
                <div className="space-y-3 mt-4 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                      <div className="flex-1">
                        {delivery.reason === 'no-backend' ? (
                          <div>
                            This deployment is a static site, so there&rsquo;s no email server reachable from here.
                            The password recovery code is shown below &mdash; only you can see this screen.
                          </div>
                        ) : (
                          <div>
                            Email delivery is not available right now{delivery.reason && delivery.reason !== 'no-backend' ? ` (${delivery.reason})` : ''}.
                            Use the code below to continue.
                          </div>
                        )}
                        {delivery.missingVars?.length > 0 && (
                          <div className="mt-1 text-xs">
                            Add <code className="font-mono">{delivery.missingVars.join(', ')}</code> to your <code className="font-mono">.env</code> and restart the backend to enable real email.
                          </div>
                        )}
                        {delivery.reason !== 'no-backend' && (
                          <button
                            type="button"
                            onClick={resend}
                            disabled={retrying}
                            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-2 disabled:opacity-50"
                          >
                            <RefreshCw className={`w-3 h-3 ${retrying ? 'animate-spin' : ''}`} /> {retrying ? 'Retrying…' : 'Try again'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-brand-500/20 bg-brand-500/10 p-3 text-sm text-brand-900 dark:text-brand-100">
                    Password recovery code: <span className="font-semibold">{code}</span>
                  </div>
                </div>
              )}

              <Link to="/reset-password" state={{ email }} className="btn-primary mt-6 inline-flex w-full justify-center animate-fade-in-up" style={{ animationDelay: '300ms' }}>
                Continue to reset <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <div className="animate-fade-in-up">
              <h1 className="text-2xl font-bold mb-1">Forgot password?</h1>
              <p className="text-sm text-earth-500 dark:text-earth-400 mb-6">
                Enter the email on your account and we&rsquo;ll email a password recovery code.
              </p>
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="animate-fade-in-up" style={{ animationDelay: '100ms' }}>
                  <label className="label">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400" />
                    <input
                      type="email"
                      required
                      className="input pl-9"
                      placeholder="you@school.edu"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>

                {serverInfo.ok && !serverInfo.smtpConfigured && (
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
                    <div className="flex items-start gap-2">
                      <Settings className="w-4 h-4 mt-0.5 shrink-0" />
                      <div>
                        SMTP isn&rsquo;t configured. Add{' '}
                        {serverInfo.missingVars.length ? (
                          <code className="font-mono">{serverInfo.missingVars.join(', ')}</code>
                        ) : (
                          'your email credentials'
                        )}{' '}
                        to <code className="font-mono">.env</code> and restart <code className="font-mono">npm run backend</code>.
                      </div>
                    </div>
                  </div>
                )}

                {err && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg animate-shake">{err}</div>}

                <button className="btn-primary w-full animate-fade-in-up" style={{ animationDelay: '300ms' }} type="submit" disabled={delivery.status === 'sending'}>
                  {delivery.status === 'sending' ? 'Sending email… code below' : 'Email me a password recovery code'}
                </button>
              </form>
              <div className="text-center text-sm text-earth-500 dark:text-earth-400 mt-6 animate-fade-in-up" style={{ animationDelay: '400ms' }}>
                Remembered it?{' '}
                <Link to="/login" className="text-brand-700 dark:text-brand-300 font-medium hover:underline">Back to sign in</Link>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
