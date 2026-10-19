import express from 'express'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../auth.js'

// Place search for the "Where" box (src/lib/geocode.js), through our server so
// the HERE key stays here. It used to ship in the website as VITE_HERE_API_KEY,
// where anyone could copy it and spend the account's quota. Signed-in only:
// the box is only on Log Hours and My Tasks.
//
// With no HERE_API_KEY set, both routes answer { results: null } and the
// browser falls back to Nominatim (OpenStreetMap), which needs no key.

const router = express.Router()

// The box searches as you type (debounced), so the limit is generous: a
// whole class on one school network shares it.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many searches. Please try again in a few minutes.' },
})

const HERE_TIMEOUT_MS = 6000

function hereKey() {
  return process.env.HERE_API_KEY || null
}

function coords(lat, lng) {
  const la = Number(lat)
  const ln = Number(lng)
  return Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180
    ? { lat: la, lng: ln }
    : null
}

router.get('/search', limiter, requireAuth(), async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (!q || q.length > 200) return res.status(400).json({ error: 'Enter what to search for.' })
  const key = hereKey()
  if (!key) return res.json({ results: null })
  const bias = coords(req.query.lat, req.query.lng)
  const at = bias ? `${bias.lat},${bias.lng}` : '20,0'
  try {
    const url = `https://autosuggest.search.hereapi.com/v1/autosuggest?q=${encodeURIComponent(q)}&at=${at}&limit=5&apiKey=${encodeURIComponent(key)}`
    const r = await fetch(url, { signal: AbortSignal.timeout(HERE_TIMEOUT_MS) })
    if (!r.ok) {
      console.error(`HERE autosuggest failed: ${r.status}`)
      return res.json({ results: null })
    }
    const data = await r.json()
    // "categoryQuery" items are refine-your-search hints with no position.
    const results = (data.items || [])
      .filter((item) => item.position && item.address?.label)
      .map((item) => ({ label: item.address.label, lat: item.position.lat, lng: item.position.lng }))
    return res.json({ results })
  } catch (error) {
    console.error('HERE autosuggest failed:', error.message)
    return res.json({ results: null })
  }
})

router.get('/reverse', limiter, requireAuth(), async (req, res) => {
  const at = coords(req.query.lat, req.query.lng)
  if (!at) return res.status(400).json({ error: 'A valid position is required.' })
  const key = hereKey()
  if (!key) return res.json({ label: null })
  try {
    const r = await fetch(
      `https://revgeocode.search.hereapi.com/v1/revgeocode?at=${at.lat},${at.lng}&limit=1&apiKey=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(HERE_TIMEOUT_MS) },
    )
    if (!r.ok) {
      console.error(`HERE revgeocode failed: ${r.status}`)
      return res.json({ label: null })
    }
    const data = await r.json()
    return res.json({ label: data.items?.[0]?.address?.label || null })
  } catch (error) {
    console.error('HERE revgeocode failed:', error.message)
    return res.json({ label: null })
  }
})

export default router
