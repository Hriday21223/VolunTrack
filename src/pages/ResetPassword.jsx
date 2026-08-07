import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Lock, CheckCircle2 } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { useAuth } from '@/hooks/useAuth.jsx'
import { updateUser, hashPassword } from '@/api/index.js'

export default function ResetPassword() {
  const { user, completePasswordReset } = useAuth()
  const location = useLocation()
  const nav = useNavigate()
  const [email, setEmail] = useState(location.state?.email || '')
  const [code, setCode] = useState(location.state?.code || '')
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')

  const onSubmit = async (e) => {
    e.preventDefault()
    setErr('')
    if (pw1.length < 6) { setErr('Password must be at least 6 characters.'); return }
    if (pw1 !== pw2) { setErr("Passwords don't match."); return }

    try {
      if (user && user.email.toLowerCase() === email.toLowerCase()) {
        updateUser(user.id, { passwordHash: hashPassword(pw1) })
      } else {
        await completePasswordReset(email, code, pw1)
      }
      setDone(true)
      setTimeout(() => nav('/login', { replace: true }), 1200)
    } catch (error) {
      setErr(error.message)
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4 bg-gradient-to-br from-brand-50 via-earth-50 to-earth-100 dark:from-[#0f1813] dark:via-[#0f1813] dark:to-[#14201a]">
      <div className="w-full max-w-md">
        <Link to="/login" className="flex items-center gap-2.5 justify-center mb-6 animate-fade-in-up">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="VolunTrack" className="w-10 h-10 object-contain" />
          <span className="font-display font-bold text-2xl">VolunTrack</span>
        </Link>

        <Card padded={false} className="p-7 animate-scale-in">
          {done ? (
            <div className="text-center animate-fade-in-up">
              <div className="w-12 h-12 rounded-full bg-brand-100 dark:bg-brand-900/30 grid place-items-center text-brand-700 mx-auto animate-bounce-in">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h1 className="text-2xl font-bold mt-3">Password updated</h1>
              <p className="text-sm text-earth-500 dark:text-earth-400 mt-2">
                Taking you back to sign in…
              </p>
            </div>
          ) : (
            <div className="animate-fade-in-up">
              <h1 className="text-2xl font-bold mb-1">Choose a new password</h1>
              <p className="text-sm text-earth-500 dark:text-earth-400 mb-6">
                Make it at least 6 characters. If you requested a reset, use the recovery code sent above.
              </p>

              <form onSubmit={onSubmit} className="space-y-4">
                <div className="animate-fade-in-up" style={{ animationDelay: '100ms' }}>
                  <label className="label">Email</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400" />
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

                {!user && (
                  <div className="animate-fade-in-up" style={{ animationDelay: '200ms' }}>
                    <label className="label">Recovery code</label>
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
                )}

                <div className="animate-fade-in-up" style={{ animationDelay: '300ms' }}>
                  <label className="label">New password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400" />
                    <input
                      type="password"
                      required
                      minLength={6}
                      className="input pl-9"
                      value={pw1}
                      onChange={(e) => setPw1(e.target.value)}
                    />
                  </div>
                </div>
                <div className="animate-fade-in-up" style={{ animationDelay: '400ms' }}>
                  <label className="label">Confirm new password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-earth-400" />
                    <input
                      type="password"
                      required
                      minLength={6}
                      className="input pl-9"
                      value={pw2}
                      onChange={(e) => setPw2(e.target.value)}
                    />
                  </div>
                </div>

                {err && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg animate-shake">{err}</div>}
                <button className="btn-primary w-full animate-fade-in-up" style={{ animationDelay: '500ms' }} type="submit">Update password</button>
              </form>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
