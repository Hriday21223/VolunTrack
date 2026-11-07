import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { printSpotlightCertificate } from '@/lib/export.js'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })
const monthName = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

// Volunteer of the month (#786), student side: shown for the month they were
// picked, with a printable certificate.
export default function MySpotlightCard({ user, className = '' }) {
  const [spot, setSpot] = useState(null)
  useEffect(() => {
    fetch(`${apiUrl}/school/my-spotlight`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : { spotlights: [] }))
      .then((d) => setSpot((d.spotlights || []).find((s) => s.current) || null))
      .catch(() => setSpot(null))
  }, [])
  if (!spot) return null
  return (
    <Card className={`border border-amber-500/30 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Star className="w-4 h-4 text-amber-500" />{' '}{tr("You're volunteer of the month! 🌟")}</h3>
          <p className="text-sm text-earth-500 dark:text-earth-400">{tr('{school} picked you for {month}.', { school: spot.schoolName || tr('Your school'), month: monthName(spot.month) })}</p>
          {spot.note && <p className="text-sm mt-1">“{spot.note}”</p>}
        </div>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => { if (!printSpotlightCertificate({ name: user?.name, schoolName: spot.schoolName, month: spot.month, note: spot.note })) window.alert(tr('Allow pop-ups for this site to print the certificates.')) }}
        >
          {tr('Print certificate')}
        </button>
      </div>
    </Card>
  )
}
