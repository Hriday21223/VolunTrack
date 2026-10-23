import express from 'express'
import rateLimit from 'express-rate-limit'
import { requireAuth } from '../auth.js'
import { isValidDateString } from '../validate.js'

// The forecast chip on outdoor tasks (src/components/WeatherChip.jsx).
// Open-Meteo is free and keyless; we call it from here rather than the
// browser so the site's CSP doesn't have to allow it and the only thing it
// ever sees is a task's rounded coordinates and date — never who is asking.
// Every failure answers 204, so the UI just leaves the chip out.

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

// WEATHER_API_URL exists so a test can point at an unreachable host.
const UPSTREAM = process.env.WEATHER_API_URL || 'https://api.open-meteo.com/v1/forecast'
const TIMEOUT_MS = 3000
const CACHE_TTL_MS = 60 * 60 * 1000
// A failed lookup is remembered briefly, so a provider outage doesn't turn
// every page view into another 3-second wait.
const FAILURE_TTL_MS = 5 * 60 * 1000
const CACHE_MAX = 2000
const FORECAST_DAYS = 7

const cache = new Map() // key → { expires, data|null }
const inFlight = new Map() // key → Promise<data|null>

const round2 = (n) => Math.round(n * 100) / 100

function readCoord(raw, limit) {
  if (typeof raw !== 'string' || !/^-?\d{1,3}(\.\d+)?$/.test(raw.trim())) return null
  const n = Number(raw)
  return Number.isFinite(n) && Math.abs(n) <= limit ? round2(n) : null
}

const dayOffset = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

function remember(key, data) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
  cache.set(key, { expires: Date.now() + (data ? CACHE_TTL_MS : FAILURE_TTL_MS), data })
}

async function fetchForecast(lat, lng, date) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    start_date: date,
    end_date: date,
  })
  try {
    const res = await fetch(`${UPSTREAM}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    const body = await res.json()
    const d = body?.daily
    const i = Array.isArray(d?.time) ? d.time.indexOf(date) : -1
    if (i < 0) return null
    const num = (arr) => (Array.isArray(arr) && Number.isFinite(arr[i]) ? arr[i] : null)
    const highC = num(d.temperature_2m_max)
    const lowC = num(d.temperature_2m_min)
    if (highC == null || lowC == null) return null
    return { date, code: num(d.weather_code), highC, lowC, rainChance: num(d.precipitation_probability_max) }
  } catch {
    return null
  }
}

// GET /api/weather?lat=&lng=&date=YYYY-MM-DD — one day's forecast at a task.
router.get('/', limiter, requireAuth(), async (req, res) => {
  const lat = readCoord(req.query.lat, 90)
  const lng = readCoord(req.query.lng, 180)
  if (lat == null || lng == null) return res.status(400).json({ error: 'Invalid coordinates.' })
  const date = req.query.date
  // Yesterday through a week out, in UTC, so a viewer a few time zones off
  // the server still gets today's forecast.
  if (typeof date !== 'string' || !isValidDateString(date) || date < dayOffset(-1) || date > dayOffset(FORECAST_DAYS)) {
    return res.status(400).json({ error: 'Pick a date within the next 7 days.' })
  }

  const key = `${lat},${lng},${date}`
  const hit = cache.get(key)
  let data
  let cached = false
  if (hit && hit.expires > Date.now()) {
    data = hit.data
    cached = true
  } else {
    if (!inFlight.has(key)) {
      inFlight.set(key, fetchForecast(lat, lng, date).then((result) => {
        remember(key, result)
        return result
      }).finally(() => inFlight.delete(key)))
    }
    data = await inFlight.get(key)
  }

  res.set('X-Weather-Cache', cached ? 'hit' : 'miss')
  if (!data) return res.status(204).end()
  res.set('Cache-Control', 'private, max-age=1800')
  return res.json({ ...data, source: 'Open-Meteo' })
})

export default router
