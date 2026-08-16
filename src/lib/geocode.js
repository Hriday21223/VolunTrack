// Location search backing LocationPicker. HERE has its own worldwide business/POI
// database (not OpenStreetMap-derived), so it finds places OSM hasn't been tagged
// with yet; Nominatim (OSM, no key required) is the always-available fallback so
// search still works before VITE_HERE_API_KEY is configured, or if HERE errors out.
const HERE_KEY = import.meta.env.VITE_HERE_API_KEY

async function hereSearch(query, bias) {
  const at = bias ? `${bias.lat},${bias.lng}` : '20,0'
  const url = `https://autosuggest.search.hereapi.com/v1/autosuggest?q=${encodeURIComponent(query)}&at=${at}&limit=5&apiKey=${HERE_KEY}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HERE autosuggest failed: ${res.status}`)
  const data = await res.json()
  // resultType "categoryQuery" items are refine-your-search hints, not places —
  // they carry no position, so drop anything without one.
  return (data.items || [])
    .filter((item) => item.position && item.address?.label)
    .map((item) => ({ label: item.address.label, lat: item.position.lat, lng: item.position.lng }))
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
  if (HERE_KEY) {
    try {
      return await hereSearch(query, bias)
    } catch {
      // fall through to Nominatim — bad/quota-exhausted key or network hiccup
    }
  }
  try {
    return await nominatimSearch(query, bias)
  } catch {
    return []
  }
}

async function hereReverse(lat, lng) {
  const res = await fetch(`https://revgeocode.search.hereapi.com/v1/revgeocode?at=${lat},${lng}&limit=1&apiKey=${HERE_KEY}`)
  if (!res.ok) throw new Error(`HERE revgeocode failed: ${res.status}`)
  const data = await res.json()
  return data.items?.[0]?.address?.label || null
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
  if (HERE_KEY) {
    try {
      const label = await hereReverse(lat, lng)
      if (label) return label
    } catch {
      // fall through to Nominatim
    }
  }
  try {
    return await nominatimReverse(lat, lng)
  } catch {
    return null
  }
}
