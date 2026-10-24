import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Calendar as CalIcon, Users, Globe } from 'lucide-react'
import { fmtDate } from '@/utils/date.js'
import { tr } from '@/lib/i18n.js'

// Map view of Opportunities (#496). Loaded only when someone opens the map
// (React.lazy in Opportunities.jsx), so the list never pays for Leaflet.
// Tasks at the same place share one pin; online tasks have no place, so the
// caller is told how many were left off.

// A drawn pin rather than Leaflet's image one: no extra requests, and it can
// carry a count when several tasks share a spot.
function pinIcon(count) {
  const label = count > 1 ? `<span class="vt-pin-count">${count}</span>` : ''
  return L.divIcon({
    className: 'vt-pin',
    html: `<div class="vt-pin-body">${label}</div>`,
    iconSize: [30, 40],
    iconAnchor: [15, 40],
    popupAnchor: [0, -36],
  })
}

const fmtDist = (km) => {
  if (km == null) return null
  const n = Number(km)
  return n < 1 ? `${Math.round(n * 1000)}m` : `${n.toFixed(1)}km`
}

// Same coordinates to ~10 m → one pin.
function groupByPlace(tasks) {
  const groups = new Map()
  for (const t of tasks) {
    const lat = Number(t.latitude)
    const lng = Number(t.longitude)
    if (t.is_online || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`
    if (!groups.has(key)) groups.set(key, { key, lat, lng, tasks: [] })
    groups.get(key).tasks.push(t)
  }
  return [...groups.values()]
}

// Leaflet stops clicks inside a popup from bubbling out of it, so React's
// own onClick (listening at the app root) never hears them. Listen on the
// button itself instead; keyboard activation fires the same click event.
function PopupButton({ onPress, className, children }) {
  const ref = useRef(null)
  const press = useRef(onPress)
  press.current = onPress
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const handle = (e) => { e.preventDefault(); press.current() }
    el.addEventListener('click', handle)
    return () => el.removeEventListener('click', handle)
  }, [])
  return <button ref={ref} type="button" className={className}>{children}</button>
}

function FitBounds({ groups, userLoc }) {
  const map = useMap()
  useEffect(() => {
    const points = groups.map((g) => [g.lat, g.lng])
    if (userLoc) points.push([userLoc.lat, userLoc.lng])
    if (points.length === 0) return
    if (points.length === 1) map.setView(points[0], 13)
    else map.fitBounds(points, { padding: [40, 40], maxZoom: 14 })
    // Fit once per set of pins, not on every render.
  }, [map, groups, userLoc?.lat, userLoc?.lng]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export default function OpportunitiesMap({ tasks, userLoc, onOpenTask, onShowOnline }) {
  const groups = useMemo(() => groupByPlace(tasks), [tasks])
  const online = tasks.filter((t) => t.is_online).length
  const unplaced = tasks.length - online - groups.reduce((s, g) => s + g.tasks.length, 0)
  const center = groups[0] ? [groups[0].lat, groups[0].lng] : userLoc ? [userLoc.lat, userLoc.lng] : [39.5, -98.35]

  return (
    <div className="space-y-2">
      <div className="relative rounded-2xl overflow-hidden border border-earth-200 dark:border-white/10 h-[60vh] min-h-[320px] max-h-[620px]">
        <MapContainer center={center} zoom={groups.length || userLoc ? 12 : 4} scrollWheelZoom className="w-full h-full z-0">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds groups={groups} userLoc={userLoc} />
          {userLoc && (
            <CircleMarker
              center={[userLoc.lat, userLoc.lng]}
              radius={8}
              pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }}
            >
              <Popup>{tr('You are here')}</Popup>
            </CircleMarker>
          )}
          {groups.map((g) => (
            <Marker key={g.key} position={[g.lat, g.lng]} icon={pinIcon(g.tasks.length)} title={g.tasks.length > 1 ? tr('{n} tasks here', { n: g.tasks.length }) : g.tasks[0].title}>
              <Popup minWidth={220} maxWidth={280}>
                <div className="vt-map-popup space-y-3">
                  {g.tasks.length > 1 && <p className="text-xs font-semibold text-earth-600">{tr('{n} tasks here', { n: g.tasks.length })}</p>}
                  {g.tasks.map((t) => {
                    const left = Math.max(0, Number(t.slots_total) - Number(t.slots_filled))
                    return (
                      <div key={t.id}>
                        <p className="font-semibold text-sm text-earth-900 leading-snug">{t.title}</p>
                        <p className="mt-1 text-xs text-earth-600 flex flex-wrap gap-x-3 gap-y-0.5">
                          <span className="inline-flex items-center gap-1"><CalIcon className="w-3 h-3" /> {fmtDate(t.date)}{t.time ? ` · ${t.time}` : ''}</span>
                          <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> {left > 0 ? tr('{n} spots left', { n: left }) : tr('Full')}</span>
                          {t.distance != null && <span>{fmtDist(t.distance)}{' '}{tr('away')}</span>}
                        </p>
                        <PopupButton onPress={() => onOpenTask(t.id)} className="mt-1.5 text-xs font-semibold text-brand-700 hover:underline">
                          {tr('View details')} →
                        </PopupButton>
                      </div>
                    )
                  })}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
        {groups.length === 0 && (
          <div className="absolute inset-x-0 top-3 mx-auto w-fit max-w-[90%] rounded-full bg-white/95 px-4 py-2 text-xs text-earth-700 shadow z-[500] text-center">
            {tr('None of these tasks has a place on the map.')}
          </div>
        )}
      </div>
      {(online > 0 || unplaced > 0) && (
        <p className="text-xs text-earth-500 flex items-center gap-1.5 flex-wrap">
          <Globe className="w-3.5 h-3.5" />
          {online > 0 && (online === 1 ? tr('1 online task isn’t on the map.') : tr('{n} online tasks aren’t on the map.', { n: online }))}
          {unplaced > 0 && <span>{unplaced === 1 ? tr('1 task has no map location.') : tr('{n} tasks have no map location.', { n: unplaced })}</span>}
          <button type="button" onClick={() => onShowOnline(unplaced === 0)} className="text-brand-500 hover:underline">{tr('See them in the list')}</button>
        </p>
      )}
    </div>
  )
}
