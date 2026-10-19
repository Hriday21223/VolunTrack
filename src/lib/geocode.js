// Location search backing LocationPicker, through Nominatim (OpenStreetMap):
// free and keyless. HERE used to be tried first for its business listings,
// but it needed an API key that shipped in the website (anyone could copy it)
// and its plan now asks for a credit card, so it was dropped. Nominatim's
// usage policy allows this: searches are debounced as the user types.

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
// failure (Nominatim down / network error) rather than throwing —
// callers treat an empty suggestion list as "no matches", same as zero results.
export async function searchPlaces(query, bias) {
  try {
    return await nominatimSearch(query, bias)
  } catch {
    return []
  }
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

// Returns null (not a throw) when Nominatim can't resolve a label —
// callers already have the raw lat/lng to fall back to.
export async function reverseGeocode(lat, lng) {
  try {
    return await nominatimReverse(lat, lng)
  } catch {
    return null
  }
}
