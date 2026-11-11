import { useState } from 'react'
import { Star, Heart } from 'lucide-react'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import ReviewConsentPrompt, { resetMyReviewCache } from '@/components/ReviewConsentPrompt.jsx'
import { useAuth } from '@/hooks/useAuth.jsx'
import { anonymousReviewerName } from '@/lib/reviewerLabel.js'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const LABELS = ['', 'Needs work', 'Okay', 'Pretty good', 'Great', 'Amazing!']

// Review us (#843): leave a review any time, not only from the one-off popup
// after a first logged session. Same POST /api/reviews as that popup; once it
// is saved, the consent step (ReviewConsentPrompt) asks whether to feature it.
export default function ReviewUs() {
  const { user } = useAuth()
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(0)

  const onSubmit = async (e) => {
    e.preventDefault()
    if (rating === 0) { setError(tr('Pick a star rating first.')); return }
    setBusy(true)
    setError('')
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ rating, comment: comment.trim(), name: name.trim() || null }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || tr('Could not send your review.'))
      }
      resetMyReviewCache()
      setSent((n) => n + 1)
      setRating(0)
      setComment('')
    } catch (e2) {
      setError(e2.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppLayout title={tr('Review us')} subtitle={tr('Tell us how VolunTrack is working for you.')}>
      <div className="max-w-xl space-y-4">
        {user?.under13 ? (
          <Card><p className="text-sm">{tr('Reviews aren’t available for this account.')}</p></Card>
        ) : (
          <Card>
            {sent > 0 && (
              <p className="mb-4 rounded-lg bg-brand-500/10 text-brand-800 dark:text-brand-200 px-3 py-2 text-sm flex items-center gap-2">
                <Heart className="w-4 h-4" aria-hidden="true" />{tr('Thanks for your review! You can send another any time.')}
              </p>
            )}
            <form onSubmit={onSubmit} className="space-y-4">
              <fieldset>
                <legend className="label">{tr('Rate your experience')}</legend>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRating(n)}
                      onMouseEnter={() => setHover(n)}
                      onMouseLeave={() => setHover(0)}
                      aria-label={n === 1 ? tr('1 star') : tr('{n} stars', { n })}
                      aria-pressed={rating === n}
                      className="p-1 transition-transform hover:scale-110"
                    >
                      <Star className={`w-8 h-8 ${n <= (hover || rating) ? 'fill-brand-400 text-brand-400' : 'text-earth-400'} transition-colors`} />
                    </button>
                  ))}
                </div>
                {rating > 0 && <p className="mt-1 text-xs text-brand-700 dark:text-brand-300 font-medium">{tr(LABELS[rating])}</p>}
              </fieldset>
              <div>
                <label htmlFor="review-comment" className="label">{tr('Anything to add? (optional)')}</label>
                <textarea
                  id="review-comment"
                  className="input min-h-[100px]"
                  maxLength={2000}
                  placeholder={tr('Tell us what you like or what could be better...')}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="review-name" className="label">{tr('Your name (optional)')}</label>
                <input id="review-name" className="input" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
                <p className="mt-1 text-xs text-earth-500 dark:text-earth-400">
                  {tr('Leave it blank and it shows as “{label}” if we feature it.', { label: anonymousReviewerName(user?.role) })}
                </p>
              </div>
              <p className="text-xs text-earth-500 dark:text-earth-400">{tr('Reviews are checked by our team before they appear anywhere in the app.')}</p>
              {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
              <button type="submit" className="btn-primary" disabled={busy || rating === 0}>
                {busy ? tr('Sending…') : tr('Send review')}
              </button>
            </form>
          </Card>
        )}
      </div>
      {/* After each review, ask whether to feature it. */}
      {sent > 0 && <ReviewConsentPrompt key={sent} />}
    </AppLayout>
  )
}
