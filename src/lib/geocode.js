// Location search backing LocationPicker, all free and keyless (OpenStreetMap
// data). As-you-type search goes to Photon (photon.komoot.io), which is built
// for autocomplete; Nominatim's usage policy forbids autocomplete on its API,
// so it's used only to turn a map pin into an address (reverseGeocode). HERE
// was dropped: its key shipped in the website and its plan needs a card.

const PHOTON_URL = 'https://photon.komoot.io/api/'

// "Name, 710 West Cesar Chavez Street, Austin, Texas": the place's name when it
// has one, then the street address and the area that tells places apart.
function photonLabel(p) {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ')
  const parts = [p.name, street, p.city || p.town || p.village || p.county, p.state, p.country === 'United States' ? null : p.country]
  return [...new Set(parts.filter(Boolean))].join(', ')
}

// Photon matches street types spelled out: "625 Cowboys Pkwy" found nothing
// near Irving while "625 Cowboys Parkway" found the street. Common US
// abbreviations are expanded before searching. "St" is left alone, since it
// can be "Saint" (St Louis).
const STREET_WORDS = {
  pkwy: 'Parkway', pky: 'Parkway', blvd: 'Boulevard', hwy: 'Highway', fwy: 'Freeway',
  expy: 'Expressway', ave: 'Avenue', av: 'Avenue', rd: 'Road', dr: 'Drive', ln: 'Lane',
  ct: 'Court', cir: 'Circle', trl: 'Trail', ter: 'Terrace', pl: 'Place', sq: 'Square', hts: 'Heights',
}

// Only after another word: a street type follows the street's name, so a
// leading "Dr" is a name ("Dr Pepper Ballpark"), not "Drive".
export function expandStreetWords(query) {
  return query.replace(/\b([A-Za-z]+)\b\.?/g, (word, w, offset) => (offset > 0 && STREET_WORDS[w.toLowerCase()]) || word)
}

async function photonSearch(query, bias) {
  const params = new URLSearchParams({ q: expandStreetWords(query), limit: '8', lang: 'en' })
  // Ranks nearby places first without excluding far ones.
  if (bias) { params.set('lat', bias.lat); params.set('lon', bias.lng) }
  const res = await fetch(`${PHOTON_URL}?${params}`)
  if (!res.ok) throw new Error(`Photon search failed: ${res.status}`)
  const data = await res.json()
  // OpenStreetMap often lacks the house number, and the match is the street
  // itself: keep the number the user typed so the entry isn't saved without it.
  const typedNumber = query.match(/^\s*(\d+[A-Za-z]?)\s+\S/)?.[1]
  const seen = new Set()
  const results = []
  for (const f of data.features || []) {
    const [lng, lat] = f.geometry?.coordinates || []
    const p = f.properties || {}
    const isBareStreet = p.osm_key === 'highway' && !p.housenumber
    const label = (typedNumber && isBareStreet ? `${typedNumber} ` : '') + photonLabel(p)
    // The same place often comes back more than once (a park and its trail).
    if (!label || !Number.isFinite(lat) || !Number.isFinite(lng) || seen.has(label)) continue
    seen.add(label)
    results.push({ label, lat, lng })
    if (results.length === 5) break
  }
  return results
}

// bias: optional { lat, lng } to rank results near the searcher. Returns [] on
// failure (Nominatim down / network error) rather than throwing —
// callers treat an empty suggestion list as "no matches", same as zero results.
// No fallback to Nominatim here on purpose: as-you-type search is what its
// policy forbids. With no suggestions the user can still type the place or
// drag the pin.
export async function searchPlaces(query, bias) {
  try {
    return await photonSearch(query, bias)
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
