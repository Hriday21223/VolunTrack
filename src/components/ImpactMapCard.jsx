import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { MapPin, Download, Printer } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { searchPlaces } from '@/lib/geocode.js'
import { csvCell } from '@/lib/csv.js'
import { schoolYears } from '@/lib/yearEndPacket.js'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })
const CACHE_KEY = 'voluntrack:place-geocodes'
const GEOCODE_MAX = 25

function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') } catch { return {} } }
function writeCache(c) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)) } catch { /* full or blocked */ } }

function FitTo({ points }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    map.fitBounds(points.map((p) => [p.lat, p.lng]), { padding: [30, 30], maxZoom: 13 })
  }, [map, points])
  return null
}

// Impact map (#659): where students volunteered, sized by hours, for grant
// reports. Places only, never names. Places without an event pin are looked
// up by name on OpenStreetMap (Photon), from this browser, and remembered here.
export default function ImpactMapCard() {
  const years = schoolYears()
  const [yearIndex, setYearIndex] = useState(0)
  const [data, setData] = useState(null)
  const [coords, setCoords] = useState({})
  const [error, setError] = useState('')
  const year = years[yearIndex]

  useEffect(() => {
    let live = true
    setData(null); setError('')
    fetch(`${apiUrl}/school/impact-places?from=${year.from}&to=${year.to}`, { headers: auth() })
      .then(async (res) => { const b = await res.json().catch(() => ({})); if (!res.ok) throw new Error(b.error || tr('Could not load the impact map.')); return b })
      .then((b) => { if (live) setData(b) })
      .catch((e) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [year.from, year.to])

  // Look up places that have no pin, most hours first.
  useEffect(() => {
    if (!data) return
    let live = true
    const cache = readCache()
    setCoords(cache)
    ;(async () => {
      const todo = data.places.filter((p) => p.lat == null && !(p.place.toLowerCase() in cache)).slice(0, GEOCODE_MAX)
      for (const p of todo) {
        const hit = (await searchPlaces(p.place))[0]
        cache[p.place.toLowerCase()] = hit ? { lat: hit.lat, lng: hit.lng } : null
        writeCache(cache)
        if (!live) return
        setCoords({ ...cache })
        await new Promise((r) => setTimeout(r, 350))
      }
    })()
    return () => { live = false }
  }, [data])

  const points = useMemo(() => (data?.places || []).map((p) => {
    const c = p.lat != null ? { lat: p.lat, lng: p.lng } : coords[p.place.toLowerCase()]
    return c ? { ...p, ...c } : null
  }).filter(Boolean), [data, coords])
  const maxHours = Math.max(1, ...points.map((p) => p.hours))
  const total = (data?.places || []).reduce((s, p) => s + p.hours, 0)

  const csv = () => {
    const rows = [['Place', 'Hours', 'Entries', 'Students'], ...(data?.places || []).map((p) => [p.place, p.hours, p.entries, p.students])]
    const blob = new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `voluntrack-impact-places-${year.label.replace('–', '-')}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }

  return (
    <Card className="impact-map-print">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <MapPin className="w-5 h-5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
          <h3 className="font-semibold">{tr('Impact map')}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <select className="input w-auto" value={yearIndex} onChange={(e) => setYearIndex(Number(e.target.value))} aria-label={tr('School year')}>
            {years.map((y, i) => <option key={y.label} value={i}>{y.label}</option>)}
          </select>
          <button type="button" className="btn-sm btn-ghost" onClick={csv} disabled={!data?.places?.length}><Download className="w-3.5 h-3.5 mr-1" />CSV</button>
          <button type="button" className="btn-sm btn-ghost" onClick={() => window.print()} disabled={!data?.places?.length}><Printer className="w-3.5 h-3.5 mr-1" />{tr('Print')}</button>
        </div>
      </div>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">
        {tr('Where your students volunteered, sized by hours. Places only, never names.')}
        {data && <> {tr('{hours} hours at {n} places.', { hours: Math.round(total * 10) / 10, n: data.places.length })}</>}
      </p>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {data === null && !error && <p className="text-sm text-earth-500">{tr('Loading…')}</p>}
      {data?.places?.length === 0 && <p className="text-sm text-earth-500">{tr('No hours with a place in this school year yet.')}</p>}
      {data?.places?.length > 0 && (
        <>
          <div className="h-80 rounded-xl overflow-hidden border border-earth-200 dark:border-white/10">
            <MapContainer center={[39.5, -98.35]} zoom={4} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
              <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {points.map((p) => (
                <CircleMarker key={p.place} center={[p.lat, p.lng]} radius={6 + 18 * Math.sqrt(p.hours / maxHours)} pathOptions={{ color: '#3f8344', fillColor: '#3f8344', fillOpacity: 0.45 }}>
                  <Tooltip>{p.place}: {p.hours} h · {p.students} {p.students === 1 ? tr('student') : tr('students')}</Tooltip>
                </CircleMarker>
              ))}
              <FitTo points={points} />
            </MapContainer>
          </div>
          <table className="w-full text-sm mt-3">
            <thead><tr className="text-left text-earth-500"><th className="py-1">{tr('Place')}</th><th className="py-1 text-right">{tr('Hours')}</th><th className="py-1 text-right">{tr('Students')}</th></tr></thead>
            <tbody>
              {data.places.slice(0, 15).map((p) => (
                <tr key={p.place} className="border-t border-earth-100 dark:border-white/5">
                  <td className="py-1 pr-2">{p.place}</td><td className="py-1 text-right">{p.hours}</td><td className="py-1 text-right">{p.students}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.places.length > 15 && <p className="text-xs text-earth-500 mt-1">{tr('Showing the top 15. The CSV has every place.')}</p>}
        </>
      )}
    </Card>
  )
}
