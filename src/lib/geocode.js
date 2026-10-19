// Location search backing LocationPicker. HERE has its own worldwide business/POI
// database (not OpenStreetMap-derived), so it finds places OSM hasn't been tagged
// with yet. It's reached through our server (server/routes/places.js), which
// holds the key; the key used to ship in the website, where anyone could copy
// it. Nominatim (OSM, no key required) is the always-available fallback, for
// when the server has no HERE key, HERE errors out, or the user is signed out.
const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return token ? { Authorization: `Bearer ${token}` } : null
}

// null means "no answer from HERE" (no key, signed out, error): use Nominatim.
async function hereSearch(query, bias) {
  const headers = authHeaders()
  if (!headers) return null
  const params = new URLSearchParams({ q: query })
  if (bias) { params.set('lat', bias.lat); params.set('lng', bias.lng) }
  const res = await fetch(`${apiUrl}/places/search?${params}`, { headers })
  if (!res.ok) return null
  const data = await res.json()
  return Array.isArray(data.results) ? data.results : null
}

async function nominatimSearch(query, bias) {
  let biasParams = ''
  if (bias) {
    // ~2 degrees (roughly 200km at mid-latitudes) is a soft nudge, not a hard
    // cutoff — bounded=0 lets a genuinely far-off match still show.
    const { lat: bLat, lng: bLng } = bias
    const d = 2
    biasParams = `&viewbox=${bLng - d},${bLat + d},${bLng + d},${bLat - d}&bounded=0`
  }
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=5${biasParams}`,
    { headers: { 'Accept-Language': 'en' } },
  )
  if (!res.ok) throw new Error(`Nominatim search failed: ${res.status}`)
  const data = await res.json()
  return data.map((s) => ({ label: s.display_name, lat: Number(s.lat), lng: Number(s.lon) }))
}

// bias: optional { lat, lng } to rank results near the searcher. Returns [] on
// total failure (both providers down / network error) rather than throwing —
// callers treat an empty suggestion list as "no matches", same as zero results.
export async function searchPlaces(query, bias) {
  try {
    const here = await hereSearch(query, bias)
    if (here) return here
  } catch {
    // fall through to Nominatim — server unreachable or a network hiccup
  }
  try {
    return await nominatimSearch(query, bias)
  } catch {
    return []
  }
}

async function hereReverse(lat, lng) {
  const headers = authHeaders()
  if (!headers) return null
  const res = await fetch(`${apiUrl}/places/reverse?${new URLSearchParams({ lat, lng })}`, { headers })
  if (!res.ok) return null
  const data = await res.json()
  return data.label || null
}

async function nominatimReverse(lat, lng) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
    { headers: { 'Accept-Language': 'en' } },
  )
  if (!res.ok) throw new Error(`Nominatim reverse failed: ${res.status}`)
  const data = await res.json()
  return data.display_name || null
}

// Returns null (not a throw) when both providers fail to resolve a label —
// callers already have the raw lat/lng to fall back to.
export async function reverseGeocode(lat, lng) {
  try {
    const label = await hereReverse(lat, lng)
    if (label) return label
  } catch {
    // fall through to Nominatim
  }
  try {
    return await nominatimReverse(lat, lng)
  } catch {
    return null
  }
}
