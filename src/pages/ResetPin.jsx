import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Mail, Lock, CheckCircle2, Shield, AlertTriangle, Inbox, RefreshCw, Settings } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { useAuth } from '@/hooks/useAuth.jsx'
import { sendRecoveryEmail, getRecoveryStatus, fetchDevRecoveryCode } from '@/lib/recovery.js'

export default function ResetPin() {
  const { requestPinReset, completePinReset } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [stage, setStage] = useState('request')
  const [sentCode, setSentCode] = useState('')
  const [delivery, setDelivery] = useState({ status: 'idle', reason: '', missingVars: [] })
  const [serverInfo, setServerInfo] = useState({ ok: false, smtpConfigured: false, missingVars: [], backendAvailable: false })
  const [retrying, setRetrying] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  // Probe the email backend so the page can show setup hints up front.
  useEffect(() => { getRecoveryStatus().then(setServerInfo) }, [])

  const sendCode = async (e) => {
    e.preventDefault()
    setErr('')
    setDelivery({ status: 'sending', reason: '', missingVars: [] })
    try {
      const generated = await requestPinReset(email)
      setSentCode(generated)

      // If the backend isn't reachable at all (e.g. static GitHub Pages host),
      // skip the email + dev-code round trips and just show the code locally.
      const status = await getRecoveryStatus()
      setServerInfo(status)
      if (!status.backendAvailable) {
        setDelivery({ status: 'fallback', reason: 'no-backend', missingVars: [] })
        setStage('verify')
        return
      }

      const result = await sendRecoveryEmail({ email, code: generated, type: 'pin' })

      let finalResult = result
      if (!result.ok && result.missingVars?.length) {
        const dev = await fetchDevRecoveryCode(email)
        if (dev.ok) {
          setSentCode(dev.code)
          finalResult = { ok: true, viaDev: true }
        }
      }

      setDelivery(
        finalResult.ok
          ? { status: 'sent', reason: '', missingVars: [] }
          : { status: 'fallback', reason: finalResult.reason, missingVars: finalResult.missingVars || [] }
      )
      setStage('verify')
    } catch (error) {
      setDelivery({ status: 'idle', reason: '', missingVars: [] })
      setErr(error.message)
    }
  }

  const resend = async () => {
    setRetrying(true)
    const status = await getRecoveryStatus()
    setServerInfo(status)
    if (!status.backendAvailable) {
      setDelivery({ status: 'fallback', reason: 'no-backend', missingVars: [] })
      setRetrying(false)
      return
    }
    const result = await sendRecoveryEmail({ email, code: sentCode, type: 'pin' })
    if (result.ok) {
      setDelivery({ status: 'sent', reason: '', missingVars: [] })
    } else {
      setDelivery({ status: 'fallback', reason: result.reason, missingVars: result.missingVars || [] })
    }
    setRetrying(false)
  }

  const resetPin = async (e) => {
    e.preventDefault()
    setErr('')
    if (!/^[0-9]{4}$/.test(pin)) {
      setErr('PIN must be exactly 4 digits.')
      return
    }
    if (pin !== confirm) {
      setErr('PIN confirmation does not match.')
      return
    }

    try {
      await completePinReset(email, code, pin)
      setDone(true)
      setTimeout(() => nav('/login', { replace: true }), 1200)
    } catch (error) {
      setErr(error.message)
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4 py-8 page-shell text-earth-900 dark:text-earth-100">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2.5 justify-center mb-6 animate-fade-in-up">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="VolunTrack" className="w-10 h-10 object-contain" />
          <span className="font-display font-bold text-2xl">VolunTrack</span>
        </Link>

        <Card padded={false} className="p-7 animate-scale-in">
          {done ? (
            <div className="text-center animate-fade-in-up">
              <div className="w-12 h-12 rounded-full bg-brand-100 dark:bg-brand-900/30 grid place-items-center text-brand-700 mx-auto animate-bounce-in">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h1 className="text-2xl font-bold mt-3">PIN reset complete</h1>
              <p className="text-sm text-earth-500 dark:text-earth-400 mt-2">
                Your new PIN has been saved. Return to login and unlock with your 4-digit PIN.
              </p>
            </div>
          ) : (
            <div className="animate-fade-in-up">
              <div className="flex items-center gap-3 mb-4">
                <Shield className="w-6 h-6 text-brand-500" />
                <div>
                  <h1 className="text-2xl font-bold">Reset your PIN</h1>
                  <p className="text-sm text-earth-500 dark:text-earth-400">We&rsquo;ll email a PIN recovery code to confirm it&rsquo;s really you.</p>
                </div>
              </div>

              {stage === 'request' ? (
                <form onSubmit={sendCode} className="space-y-4">
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
                          The recovery server is up, but SMTP isn&rsquo;t configured. Add{' '}
                          {serverInfo.missingVars.length ? (
                            <code className="font-mono">{serverInfo.missingVars.join(', ')}</code>
                          ) : (
                            'your email credentials'
                          )}{' '}
                          to <code className="font-mono">.env</code> and restart <code className="font-mono">npm run backend</code>.
                          For now, the PIN recovery code will appear on screen so you can finish.
                        </div>
                      </div>
                    </div>
                  )}

                  {err && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg animate-shake">{err}</div>}

                  <button className="btn-primary w-full animate-fade-in-up" style={{ animationDelay: '300ms' }} type="submit" disabled={delivery.status === 'sending'}>
                    {delivery.status === 'sending' ? 'Sending code…' : 'Send PIN recovery code'}
                  </button>
                </form>
              ) : (
                <form onSubmit={resetPin} className="space-y-4 animate-fade-in-up">
                  <DeliveryBanner delivery={delivery} email={email} sentCode={sentCode} onResend={resend} retrying={retrying} />

                  <div className="animate-fade-in-up" style={{ animationDelay: '100ms' }}>
                    <label className="label">PIN recovery code</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400" />
                      <input
                        type="password"
                        required
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        className="input pl-9"
                        placeholder="123456"
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
                        maxLength={6}
                      />
                    </div>
                  </div>

                  <div className="animate-fade-in-up" style={{ animationDelay: '200ms' }}>
                    <label className="label">New 4-digit PIN</label>
                    <input
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]{4}"
                      className="input"
                      placeholder="1234"
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                      maxLength={4}
                    />
                  </div>

                  <div className="animate-fade-in-up" style={{ animationDelay: '300ms' }}>
                    <label className="label">Confirm PIN</label>
                    <input
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]{4}"
                      className="input"
                      placeholder="1234"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value.replace(/[^0-9]/g, ''))}
                      maxLength={4}
                    />
                  </div>

                  {err && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg animate-shake">{err}</div>}

                  <button className="btn-primary w-full animate-fade-in-up" style={{ animationDelay: '400ms' }} type="submit">Save new PIN</button>
                </form>
              )}

              <div className="text-center text-sm text-earth-500 dark:text-earth-400 mt-6 animate-fade-in-up" style={{ animationDelay: '500ms' }}>
                <Link to="/login" className="text-brand-700 dark:text-brand-300 font-medium hover:underline">Back to login</Link>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function DeliveryBanner({ delivery, email, sentCode, onResend, retrying }) {
  if (delivery.status === 'sent') {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200 flex items-start gap-2">
        <Inbox className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          A PIN recovery code has been sent to <span className="font-semibold">{email}</span>. It expires in 15 minutes.
          Don't see it? Check the Spam folder and Promotions/Updates tab.
        </span>
      </div>
    )
  }
  if (delivery.status === 'fallback') {
    const isStaticHost = delivery.reason === 'no-backend'
    return (
      <div className="space-y-2">
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="flex-1">
              {isStaticHost ? (
                <div>
                  This deployment is a static site, so there&rsquo;s no email server reachable from here.
                  The PIN recovery code is shown below &mdash; only you can see this screen.
                </div>
              ) : (
                <div>
                  Email delivery is not available right now{delivery.reason && delivery.reason !== 'no-backend' ? ` (${delivery.reason})` : ''}.
                  Use the code below to continue &mdash; only you can see this screen.
                </div>
              )}
              {delivery.missingVars?.length > 0 && (
                <div className="mt-1 text-xs">
                  Add <code className="font-mono">{delivery.missingVars.join(', ')}</code> to your <code className="font-mono">.env</code> and restart the backend to enable real email.
                </div>
              )}
              {!isStaticHost && onResend && (
                <button
                  type="button"
                  onClick={onResend}
                  disabled={retrying}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-2 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${retrying ? 'animate-spin' : ''}`} /> {retrying ? 'Retrying…' : 'Try again'}
                </button>
              )}
            </div>
          </div>
        </div>
        {sentCode && (
          <div className="rounded-2xl border border-brand-500/20 bg-brand-500/10 p-3 text-sm text-brand-900 dark:text-brand-100">
            Your PIN recovery code is <span className="font-semibold">{sentCode}</span>. Use it within 15 minutes.
          </div>
        )}
      </div>
    )
  }
  return null
}
