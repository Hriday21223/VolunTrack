import { useEffect, useState } from 'react'
import { Star, Heart, X } from 'lucide-react'
import { useData } from '@/hooks/useData.jsx'

const LABELS = ['', 'Needs work', 'Okay', 'Pretty good', 'Great', 'Amazing!']

export default function ReviewPopup() {
  const { showReview, submitReview, dismissReview } = useData()
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!showReview) return
    const onKeyDown = (e) => { if (e.key === 'Escape') dismissReview() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showReview, dismissReview])

  if (!showReview) return null

  const onSubmit = () => {
    if (rating === 0) return
    setBusy(true)
    submitReview(rating, comment.trim())
  }

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) dismissReview() }}
    >
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0f1813] p-6 sm:p-8 shadow-soft text-white max-h-[85vh] overflow-y-auto">
        <button
          type="button"
          onClick={dismissReview}
          aria-label="Close"
          className="absolute top-4 right-4 p-1 text-earth-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="text-center">
          <div className="w-14 h-14 rounded-full bg-brand-900/40 border border-brand-700/30 grid place-items-center mx-auto mb-4">
            <Heart className="w-7 h-7 text-brand-400" />
          </div>
          <h2 className="text-2xl font-bold">Love VolunTrack?</h2>
          <p className="mt-2 text-sm text-earth-400 leading-6">
            You&apos;ve logged your first volunteer session. We&apos;d love to hear how it&apos;s going for you!
          </p>
        </div>

        <div className="mt-6 text-center">
          <p className="text-sm font-medium text-earth-300 mb-3">Rate your experience</p>
          <div className="flex justify-center gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                className="p-1 transition-transform hover:scale-110"
              >
                <Star
                  className={`w-8 h-8 ${
                    n <= (hover || rating)
                      ? 'fill-brand-400 text-brand-400'
                      : 'text-earth-600'
                  } transition-colors`}
                />
              </button>
            ))}
          </div>
          {rating > 0 && (
            <p className="mt-2 text-xs text-brand-300 font-medium">{LABELS[rating]}</p>
          )}
        </div>

        <div className="mt-5">
          <label className="text-sm text-earth-300 mb-2 block">Anything to add? (optional)</label>
          <textarea
            className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-white placeholder-earth-500 resize-none min-h-[80px] focus:outline-none focus:ring-2 focus:ring-brand-500/50"
            placeholder="Tell us what you like or what could be better..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>

        <button
          onClick={onSubmit}
          disabled={rating === 0 || busy}
          className="mt-5 w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? 'Submitting...' : 'Submit review'}
        </button>
      </div>
    </div>
  )
}
