import { useEffect, useState } from 'react'
import { ShieldCheck, KeyRound, X } from 'lucide-react'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return token ? { Authorization: `Bearer ${token}` } : null
}

// A submitted-but-undecided review (see ReviewPopup.jsx) gets a self-serve
// consent step here: the reviewer confirms, via a one-time PIN emailed to
// their account, whether they want it considered for the public testimonials
// at all. Saying yes only makes it *eligible* for admin approval — see
// server/routes/reviews.js PATCH /admin/:id/approve, which still gates
// actual publication.
export default function ReviewConsentPrompt() {
  const [review, setReview] = useState(null)
  const [step, setStep] = useState(null) // 'ask' | 'pin' | 'done' | null (hidden)
  const [choice, setChoice] = useState(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const headers = authHeaders()
    if (!headers) return
    fetch(`${apiUrl}/reviews/mine`, { headers })
      .then((r) => (r.ok ? r.json() : { review: null }))
      .then((data) => {
        const r = data.review
        if (!r || r.consent_choice) return
        setReview(r)
        setStep(r.pending_consent_choice ? 'pin' : 'ask')
        if (r.pending_consent_choice) setChoice(r.pending_consent_choice)
      })
      .catch(() => {})
  }, [])

  if (dismissed || !review || !step) return null

  const requestPin = async (pickedChoice) => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/reviews/mine/${review.id}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ choice: pickedChoice }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Could not send a confirmation code.')
      }
      setChoice(pickedChoice)
      setStep('pin')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const confirmPin = async () => {
    if (!/^\d{4}$/.test(pin)) { setError('Enter the 4-digit code.'); return }
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/reviews/mine/${review.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ pin }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Incorrect code.')
      setStep('done')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) setDismissed(true) }}
    >
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0f1813] p-6 sm:p-8 shadow-soft text-white">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Close"
          className="absolute top-4 right-4 p-1 text-earth-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {step === 'ask' && (
          <>
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-brand-900/40 border border-brand-700/30 grid place-items-center mx-auto mb-4">
                <ShieldCheck className="w-7 h-7 text-brand-400" />
              </div>
              <h2 className="text-2xl font-bold">Feature your review?</h2>
              <p className="mt-2 text-sm text-earth-400 leading-6">
                You submitted a review. Do you want it considered for the public testimonials on our site?
              </p>
            </div>
            {error && <p className="mt-4 text-sm text-red-400 text-center">{error}</p>}
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => requestPin('no')}
                disabled={busy}
                className="flex-1 rounded-xl border border-white/10 py-3 text-sm font-semibold text-earth-200 hover:bg-white/5 disabled:opacity-40 transition-colors"
              >
                No thanks
              </button>
              <button
                onClick={() => requestPin('yes')}
                disabled={busy}
                className="flex-1 rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-40 transition-colors"
              >
                Yes, feature it
              </button>
            </div>
          </>
        )}

        {step === 'pin' && (
          <>
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-brand-900/40 border border-brand-700/30 grid place-items-center mx-auto mb-4">
                <KeyRound className="w-7 h-7 text-brand-400" />
              </div>
              <h2 className="text-2xl font-bold">Confirm it's you</h2>
              <p className="mt-2 text-sm text-earth-400 leading-6">
                We sent a 4-digit code to your email to confirm you {choice === 'yes' ? 'want' : "don't want"} your review featured.
              </p>
            </div>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="0000"
              className="mt-5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-center text-2xl tracking-[0.5em] text-white placeholder-earth-600 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
            />
            {error && <p className="mt-3 text-sm text-red-400 text-center">{error}</p>}
            <button
              onClick={confirmPin}
              disabled={busy || pin.length !== 4}
              className="mt-4 w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {busy ? 'Confirming...' : 'Confirm code'}
            </button>
            <button
              onClick={() => requestPin(choice)}
              disabled={busy}
              className="mt-2 w-full text-xs text-earth-400 hover:text-earth-200 transition-colors"
            >
              Resend code
            </button>
          </>
        )}

        {step === 'done' && (
          <div className="text-center py-2">
            <div className="w-14 h-14 rounded-full bg-brand-900/40 border border-brand-700/30 grid place-items-center mx-auto mb-4">
              <ShieldCheck className="w-7 h-7 text-brand-400" />
            </div>
            <h2 className="text-2xl font-bold">Got it</h2>
            <p className="mt-2 text-sm text-earth-400 leading-6">
              {choice === 'yes'
                ? "Thanks — your review is now eligible to be featured. We'll email you if it's approved."
                : "Understood — your review won't be featured. Thanks for the feedback."}
            </p>
            <button
              onClick={() => setDismissed(true)}
              className="mt-5 w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-500 transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
