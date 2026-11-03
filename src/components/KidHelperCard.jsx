import { Star } from 'lucide-react'
import { starsFor } from '@/lib/kidMode.js'
import { tr } from '@/lib/i18n.js'

const round = (n) => Math.round((Number(n) || 0) * 10) / 10

// A big, simple card for students under 10 (#641): a star fills in for each
// hour, toward a small goal, in short words a young child can read.
export default function KidHelperCard({ name, hours, goal }) {
  const { stars, filled, perStar } = starsFor(hours, goal)
  const left = Math.max(0, round(goal - hours))
  const done = left <= 0
  const first = String(name || '').split(' ')[0]
  return (
    <section
      aria-label={tr('My Helper Card')}
      className="mb-4 rounded-3xl p-5 sm:p-6 text-white shadow-lg bg-gradient-to-br from-amber-400 via-orange-400 to-pink-500"
    >
      <p className="text-sm font-semibold uppercase tracking-wider text-white/90">{tr('My Helper Card')}</p>
      <h2 className="mt-1 text-2xl sm:text-3xl font-extrabold">
        {done
          ? tr('You did it, {name}!', { name: first || tr('helper') })
          : first ? tr('Great helping, {name}!', { name: first }) : tr('Great helping!')}
      </h2>
      <p className="mt-2 text-lg font-semibold">
        {tr('You helped for {n} hours.', { n: round(hours) })}
      </p>

      <ul className="mt-4 flex flex-wrap gap-2" aria-label={tr('{filled} of {stars} stars', { filled, stars })}>
        {Array.from({ length: stars }, (_, i) => (
          <li key={i}>
            <Star
              className={`w-9 h-9 sm:w-11 sm:h-11 drop-shadow ${i < filled ? 'fill-yellow-200 text-yellow-100' : 'fill-white/20 text-white/60'}`}
              aria-hidden="true"
            />
          </li>
        ))}
      </ul>
      {perStar !== 1 && (
        <p className="mt-2 text-sm text-white/90">{tr('Each star is {n} hours of helping.', { n: round(perStar) })}</p>
      )}

      <p className="mt-4 text-lg font-bold">
        {done
          ? tr('Your card is full! Keep helping if you want to.')
          : tr('{n} more hours to fill your card.', { n: left })}
      </p>
      <p className="mt-1 text-sm text-white/90">{tr('Kids your age have a small goal. Every little bit helps!')}</p>
    </section>
  )
}
