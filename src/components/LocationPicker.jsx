import { useState, useEffect, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Navigation, MapPin } from 'lucide-react'
import { searchPlaces, reverseGeocode } from '@/lib/geocode.js'

// Bundlers break Leaflet's default marker icon URLs — point them at the CDN
// copies that ship in the same package version instead of asset-resolving.
const markerIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

const PICKED_ZOOM = 16

function RecenterOnChange({ position }) {
  const map = useMap()
  useEffect(() => {
    if (position) map.setView(position, Math.max(map.getZoom(), PICKED_ZOOM))
  }, [position, map])
  return null
}

function ClickToPlace({ onPick }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

// Address + business/POI autocomplete with a draggable-pin map. Search and
// reverse-geocoding go through src/lib/geocode.js, which prefers HERE (real
// worldwide business data — set VITE_HERE_API_KEY) and falls back to
// Nominatim/OpenStreetMap (no key required, but its POI coverage has real
// gaps — e.g. a business OSM hasn't been tagged with yet won't show up).
// Leaflet renders the map tiles either way.
export default function LocationPicker({ address, lat, lng, onChange, placeholder, required }) {
  const [query, setQuery] = useState(address || '')
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState('')
  const debounceRef = useRef(null)
  const blurTimeoutRef = useRef(null)
  // A generic query like "park" ranks purely by global relevance without
  // this — often landing somewhere far from the searcher. Silently grab an
  // approximate location (no prompt if the browser already knows it / has
  // been asked before) and use it to bias results toward nearby matches
  // without excluding far ones.
  const biasRef = useRef(null)

  useEffect(() => setQuery(address || ''), [address])

  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => { biasRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude } },
      () => {},
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 },
    )
  }, [])

  const search = useCallback((text) => {
    clearTimeout(debounceRef.current)
    if (!text || text.trim().length < 3) {
      setSuggestions([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      const results = await searchPlaces(text, biasRef.current)
      setSuggestions(results)
    }, 400)
  }, [])

  const onInputChange = (e) => {
    const value = e.target.value
    setQuery(value)
    setOpen(true)
    search(value)
    // Free-typed text (no pin yet) is still a valid location — keep it live
    // so the form's required-field check passes even without picking a pin.
    onChange({ address: value, lat: null, lng: null })
  }

  const pickSuggestion = (s) => {
    setQuery(s.label)
    setSuggestions([])
    setOpen(false)
    onChange({ address: s.label, lat: s.lat, lng: s.lng })
  }

  const pickOnMap = async (mapLat, mapLng) => {
    onChange({ address: query, lat: mapLat, lng: mapLng })
    const resolved = await reverseGeocode(mapLat, mapLng)
    if (resolved) {
      setQuery(resolved)
      onChange({ address: resolved, lat: mapLat, lng: mapLng })
    }
  }

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser.')
      return
    }
    setLocating(true)
    setError('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        pickOnMap(pos.coords.latitude, pos.coords.longitude).finally(() => setLocating(false))
      },
      (err) => {
        setError(err.message || 'Could not get your location.')
        setLocating(false)
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    )
  }

  const position = lat != null && lng != null ? [lat, lng] : null

  return (
    <div>
      <div className="relative">
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder={placeholder || 'Search for an address or place…'}
            value={query}
            onChange={onInputChange}
            onFocus={() => setOpen(true)}
            onBlur={() => { blurTimeoutRef.current = setTimeout(() => setOpen(false), 150) }}
            autoComplete="off"
            name="voluntrack-location-search"
            required={required}
          />
          <button
            type="button"
            onClick={useCurrentLocation}
            disabled={locating}
            className="btn-ghost inline-flex items-center gap-1.5 whitespace-nowrap"
            title="Use current location"
          >
            <Navigation className={`w-4 h-4 ${locating ? 'animate-spin' : ''}`} />
            {locating ? 'Locating…' : 'Current'}
          </button>
        </div>
        {open && suggestions.length > 0 && (
          <ul className="absolute z-[1000] left-0 right-0 mt-1 rounded-lg border border-earth-800 bg-white dark:bg-earth-900 shadow-lg max-h-56 overflow-y-auto">
            {suggestions.map((s, i) => (
              <li key={`${s.lat},${s.lng},${i}`}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickSuggestion(s)}
                  className="w-full text-left px-3 py-2 text-sm text-earth-900 dark:text-earth-100 hover:bg-earth-100 dark:hover:bg-earth-800 flex items-start gap-2"
                >
                  <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-brand-400" />
                  <span>{s.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <div className="text-xs text-red-600 mt-1">{error}</div>}

      {/* Map only appears once a place is actually picked — search-and-select
          is the primary flow (like Google's address autocomplete), so there's
          no empty map taking up space before that. */}
      {position && (
        <div className="mt-3">
          <div className="rounded-lg overflow-hidden border border-earth-800 h-40">
            <MapContainer center={position} zoom={PICKED_ZOOM} style={{ height: '100%', width: '100%' }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <ClickToPlace onPick={pickOnMap} />
              <RecenterOnChange position={position} />
              <Marker
                position={position}
                icon={markerIcon}
                draggable
                eventHandlers={{
                  dragend: (e) => {
                    const { lat: newLat, lng: newLng } = e.target.getLatLng()
                    pickOnMap(newLat, newLng)
                  },
                }}
              />
            </MapContainer>
          </div>
          <p className="text-xs text-earth-500 mt-1.5">Not quite right? Drag the pin or click the map to adjust.</p>
        </div>
      )}
    </div>
  )
}
