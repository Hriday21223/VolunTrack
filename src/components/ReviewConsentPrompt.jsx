import { useEffect, useState } from 'react'
import { ShieldCheck, KeyRound, X, User as UserIcon } from 'lucide-react'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return token ? { Authorization: `Bearer ${token}` } : null
}

// This prompt mounts with every page, and the answer rarely changes, so it's
// asked once per signed-in session. Asking on every navigation ran into the
// endpoint's per-IP limit after a dozen pages, sooner on a shared school
// network. Cleared once the consent step finishes.
let mineCache = { token: null, request: null }

// Called after a new review is sent (src/pages/ReviewUs.jsx), so the next
// check sees it.
// eslint-disable-next-line react-refresh/only-export-components
export function resetMyReviewCache() { mineCache = { token: null, request: null } }

function loadMyReview(headers) {
  const token = headers.Authorization
  if (mineCache.token !== token) {
    const request = fetch(`${apiUrl}/reviews/mine`, { headers })
      // 429 counts as an answer ("not now"), not a failure: retrying it on
      // every page only adds more requests the limiter will refuse.
      .then((r) => (r.ok ? r.json() : { review: null, failed: r.status !== 429 }))
      .catch(() => ({ review: null, failed: true }))
    // A failed check is asked again next page rather than remembered.
    request.then((data) => { if (data.failed && mineCache.request === request) mineCache = { token: null, request: null } })
    mineCache = { token, request }
  }
  return mineCache.request
}

// A submitted-but-undecided review (see ReviewPopup.jsx) gets a self-serve
// consent step here (#843). "No thanks" is saved at once. "Yes" first asks
// which name to show, then a one-time PIN emailed to their account confirms
// it, since only yes can make the review public. Saying yes only makes it *eligible* for admin approval — see
// server/routes/reviews.js PATCH /admin/:id/approve, which still gates
// actual publication.
export default function ReviewConsentPrompt() {
  const [review, setReview] = useState(null)
  const [step, setStep] = useState(null) // 'ask' | 'details' | 'pin' | 'done' | null (hidden)
  const [name, setName] = useState('')
  const [choice, setChoice] = useState(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const headers = authHeaders()
    if (!headers) return
    loadMyReview(headers)
      .then((data) => {
        const r = data.review
        if (!r || r.consent_choice) return
        setReview(r)
        setName(r.name || '')
        // Only a "yes" waits for a code now; an old pending "no" (from before
        // #843) just asks again.
        const waitingYes = r.pending_consent_choice === 'yes'
        setStep(waitingYes ? 'pin' : 'ask')
        if (waitingYes) setChoice('yes')
      })
  }, [])

  if (dismissed || !review || !step) return null

  // "no" is recorded straight away; "yes" sends the code for the PIN step.
  const sendChoice = async (pickedChoice) => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/reviews/mine/${review.id}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(pickedChoice === 'yes' ? { choice: 'yes', name: name.trim() } : { choice: 'no' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || tr('Could not save your answer.'))
      }
      setChoice(pickedChoice)
      if (pickedChoice === 'no') mineCache = { token: null, request: null }
      setStep(pickedChoice === 'no' ? 'done' : 'pin')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const confirmPin = async () => {
    if (!/^\d{4}$/.test(pin)) { setError(tr('Enter the 4-digit code.')); return }
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/reviews/mine/${review.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ pin }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || tr('Invalid code.'))
      mineCache = { token: null, request: null }
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
          aria-label={tr('Close')}
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
              <h2 className="text-2xl font-bold">{tr('Feature your review?')}</h2>
              <p className="mt-2 text-sm text-earth-400 leading-6">
                {tr('You submitted a review. Do you want it considered for the public testimonials on our site?')}
              </p>
            </div>
            {error && <p className="mt-4 text-sm text-red-400 text-center">{error}</p>}
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => sendChoice('no')}
                disabled={busy}
                className="flex-1 rounded-xl border border-white/10 py-3 text-sm font-semibold text-earth-200 hover:bg-white/5 disabled:opacity-40 transition-colors"
              >
                {tr('No thanks')}
              </button>
              <button
                onClick={() => { setError(''); setStep('details') }}
                disabled={busy}
                className="flex-1 rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-40 transition-colors"
              >
                {tr('Yes, feature it')}
              </button>
            </div>
          </>
        )}

        {step === 'details' && (
          <>
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-brand-900/40 border border-brand-700/30 grid place-items-center mx-auto mb-4">
                <UserIcon className="w-7 h-7 text-brand-400" />
              </div>
              <h2 className="text-2xl font-bold">{tr('Feature your review?')}</h2>
              <p className="mt-2 text-sm text-earth-400 leading-6">
                {tr('Your review and this name may appear on our website once our team approves it.')}
              </p>
            </div>
            <label htmlFor="review-consent-name" className="block mt-5 text-sm font-medium text-earth-200">{tr('Show my review with this name (optional)')}</label>
            <input
              id="review-consent-name"
              type="text"
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-white placeholder-earth-600 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
            />
            <p className="mt-1 text-xs text-earth-400">{tr('Leave it blank and we show your account type instead, like “VolunTrack Student”.')}</p>
            {error && <p className="mt-3 text-sm text-red-400 text-center">{error}</p>}
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => { setError(''); setStep('ask') }}
                disabled={busy}
                className="flex-1 rounded-xl border border-white/10 py-3 text-sm font-semibold text-earth-200 hover:bg-white/5 disabled:opacity-40 transition-colors"
              >
                {tr('Back')}
              </button>
              <button
                onClick={() => sendChoice('yes')}
                disabled={busy}
                className="flex-1 rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-40 transition-colors"
              >
                {busy ? tr('Sending…') : tr('Send me a code')}
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
              <h2 className="text-2xl font-bold">{tr("Confirm it's you")}</h2>
              <p className="mt-2 text-sm text-earth-400 leading-6">
                {tr('We sent a 4-digit code to your email. Enter it to confirm you want your review featured.')}
              </p>
            </div>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(e) => { if (e.key === 'Enter' && pin.length === 4 && !busy) confirmPin() }}
              placeholder="0000"
              className="mt-5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-center text-2xl tracking-[0.5em] text-white placeholder-earth-600 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
            />
            {error && <p className="mt-3 text-sm text-red-400 text-center">{error}</p>}
            <button
              onClick={confirmPin}
              disabled={busy || pin.length !== 4}
              className="mt-4 w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {busy ? tr('Checking…') : tr('Confirm code')}
            </button>
            <button
              onClick={() => sendChoice('yes')}
              disabled={busy}
              className="mt-2 w-full text-xs text-earth-400 hover:text-earth-200 transition-colors"
            >
              {tr('Resend code')}
            </button>
            <button
              onClick={() => { setPin(''); setError(''); setStep('ask') }}
              disabled={busy}
              className="mt-1 w-full text-xs text-earth-400 hover:text-earth-200 transition-colors"
            >
              {tr('Back')}
            </button>
          </>
        )}

        {step === 'done' && (
          <div className="text-center py-2">
            <div className="w-14 h-14 rounded-full bg-brand-900/40 border border-brand-700/30 grid place-items-center mx-auto mb-4">
              <ShieldCheck className="w-7 h-7 text-brand-400" />
            </div>
            <h2 className="text-2xl font-bold">{tr('Got it')}</h2>
            <p className="mt-2 text-sm text-earth-400 leading-6">
              {choice === 'yes'
                ? tr("Thanks — your review is now eligible to be featured. We'll email you if it's approved.")
                : tr("Understood — your review won't be featured. Thanks for the feedback.")}
            </p>
            <button
              onClick={() => setDismissed(true)}
              className="mt-5 w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-500 transition-colors"
            >
              {tr('Close')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
