import { useState, useEffect, useCallback } from 'react'
import { MapPin, Calendar as CalIcon, Users } from 'lucide-react'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

const fmtDist = (km) => {
  if (km === null || km === undefined) return null
  const n = Number(km)
  if (n < 1) return `${Math.round(n * 1000)}m`
  return `${n.toFixed(1)}km`
}

export default function Opportunities() {
  const [nearbyTasks, setNearbyTasks] = useState([])
  const [userLoc, setUserLoc] = useState(null)
  const [nearbyRadius, setNearbyRadius] = useState(25)
  const [toast, setToast] = useState(false)
  const [toastMsg, setToastMsg] = useState('')

  const loadNearbyTasks = useCallback(async (lat, lng, radius) => {
    try {
      let url = `${apiUrl}/school/public-tasks?maxDistance=${radius}`
      if (lat != null && lng != null) url += `&lat=${lat}&lng=${lng}`
      const res = await fetch(url)
      if (res.ok) { const d = await res.json(); setNearbyTasks(d.tasks || []) }
    } catch {}
  }, [])

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
          setUserLoc(loc)
          loadNearbyTasks(loc.lat, loc.lng, nearbyRadius)
        },
        () => { loadNearbyTasks(null, null, nearbyRadius) },
        { enableHighAccuracy: true, timeout: 10000 },
      )
    } else {
      loadNearbyTasks(null, null, nearbyRadius)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (userLoc) loadNearbyTasks(userLoc.lat, userLoc.lng, nearbyRadius)
  }, [nearbyRadius, userLoc, loadNearbyTasks])

  return (
    <AppLayout title="Opportunities" subtitle="Volunteer tasks near you">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-xl font-bold">Opportunities near you</h2>
            <p className="text-sm text-earth-400 mt-1">
              {userLoc ? `Showing tasks within ${nearbyRadius}km of your location` : 'Enable location to see nearby tasks'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-earth-400">Radius:</label>
            <select
              value={nearbyRadius}
              onChange={(e) => setNearbyRadius(Number(e.target.value))}
              className="input py-1 px-2 text-sm w-24"
            >
              <option value={5}>5 km</option>
              <option value={10}>10 km</option>
              <option value={25}>25 km</option>
              <option value={50}>50 km</option>
              <option value={100}>100 km</option>
            </select>
          </div>
        </div>

        {!userLoc && (
          <Card className="border border-dashed border-brand-700/40 bg-brand-900/10">
            <div className="flex items-center gap-3">
              <MapPin className="w-5 h-5 text-brand-400 shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-sm text-white">Location access needed</p>
                <p className="text-xs text-earth-400 mt-0.5">Allow location access to see volunteer opportunities near you.</p>
              </div>
              <button onClick={() => {
                navigator.geolocation.getCurrentPosition(
                  (pos) => {
                    const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
                    setUserLoc(loc)
                    loadNearbyTasks(loc.lat, loc.lng, nearbyRadius)
                  },
                  () => {},
                  { enableHighAccuracy: true, timeout: 10000 },
                )
              }} className="btn-primary text-xs">Enable</button>
            </div>
          </Card>
        )}

        {nearbyTasks.length === 0 ? (
          <Card>
            <div className="text-center py-8">
              <MapPin className="w-10 h-10 text-earth-600 mx-auto mb-3" />
              <p className="text-earth-400">No volunteer opportunities within {nearbyRadius}km.</p>
              <p className="text-xs text-earth-500 mt-1">Try increasing the radius or check back later.</p>
            </div>
          </Card>
        ) : nearbyTasks.map((t) => {
          const filled = Number(t.slots_filled)
          const total = Number(t.slots_total)
          const full = filled >= total
          const approved = t.my_signup_status === 'approved'
          return (
            <Card key={t.id} padded={false} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{t.title}</p>
                    {t.distance != null && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-400 font-medium shrink-0">
                        {fmtDist(t.distance)} away
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-earth-400 mt-1">{t.description}</p>
                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-earth-500">
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${t.latitude != null && t.longitude != null ? `${t.latitude},${t.longitude}` : encodeURIComponent(t.location)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 hover:text-brand-400 hover:underline"
                    >
                      <MapPin className="w-3 h-3" /> {t.location}
                    </a>
                    <span className="flex items-center gap-1"><CalIcon className="w-3 h-3" /> {new Date(t.date).toLocaleDateString()}{t.time ? ` · ${t.time}` : ''}</span>
                    <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {filled}/{total} slots</span>
                  </div>
                  <p className="text-xs text-earth-600 mt-1">Posted by {t.creator_name}</p>
                  {approved && t.phone && (
                    <p className="text-xs text-emerald-400 mt-1 font-medium">Contact: {t.phone}</p>
                  )}
                  {approved && t.important_info && (
                    <div className="mt-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                      <p className="text-xs font-semibold text-emerald-300 mb-0.5">Important info</p>
                      <p className="text-xs text-emerald-200/80">{t.important_info}</p>
                    </div>
                  )}
                  {t.my_signup_status === 'pending' && (
                    <p className="text-xs text-amber-400 mt-1">Awaiting organizer approval</p>
                  )}
                  {t.my_signup_status === 'rejected' && (
                    <p className="text-xs text-red-400 mt-1">Signup rejected</p>
                  )}
                </div>
                <div className="shrink-0">
                  {t.my_signup_status === 'approved' ? (
                    <span className="text-xs text-emerald-400 font-medium">Approved</span>
                  ) : t.my_signup_status === 'pending' ? (
                    <span className="text-xs text-amber-400 font-medium">Pending</span>
                  ) : t.my_signup_status === 'rejected' ? (
                    <span className="text-xs text-red-400 font-medium">Rejected</span>
                  ) : full ? (
                    <span className="text-xs text-red-400 font-medium">Full</span>
                  ) : (
                    <button onClick={async () => {
                      try {
                        const token = localStorage.getItem('voluntrack:auth_token')
                        const res = await fetch(`${apiUrl}/school/public-tasks/${t.id}/signup`, {
                          method: 'POST',
                          headers: { Authorization: `Bearer ${token}` },
                        })
                        if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
                        setToastMsg('Signed up — awaiting organizer approval'); setToast(true); loadNearbyTasks(userLoc?.lat, userLoc?.lng, nearbyRadius)
                      } catch (e) { setToastMsg(e.message); setToast(true) }
                    }} className="btn-primary text-sm">Sign up</button>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      <Toast open={toast} onClose={() => setToast(false)}>{toastMsg}</Toast>
    </AppLayout>
  )
}
