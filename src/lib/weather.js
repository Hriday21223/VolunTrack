// The forecast behind WeatherChip (#435). The browser only ever talks to our
// own GET /api/weather, which asks Open-Meteo server-side, so the CSP is
// unchanged and Open-Meteo never sees who is looking.

const apiUrl = import.meta.env.VITE_API_URL || '/api'

export const FORECAST_DAYS = 7
// A card list can hold many outdoor tasks; ask for a few at a time.
const MAX_CONCURRENT = 2

const localDay = (offset = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Outdoor, in person, pinned on the map, not cancelled, and today through
// the next 6 days.
export function wantsWeather(task) {
  if (!task || !task.is_outdoor || task.is_online) return false
  if (task.latitude == null || task.longitude == null) return false
  const status = task.task_status || task.status
  if (status === 'cancelled') return false
  const day = String(task.date || '').slice(0, 10)
  return day >= localDay(0) && day <= localDay(FORECAST_DAYS - 1)
}

// Fahrenheit where people use it; Celsius everywhere else.
const FAHRENHEIT_REGIONS = new Set(['US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH'])
export function usesFahrenheit() {
  try {
    const tag = (typeof navigator !== 'undefined' && navigator.language) || 'en-US'
    const region = new Intl.Locale(tag).maximize().region
    return FAHRENHEIT_REGIONS.has(region)
  } catch {
    return false
  }
}

const results = new Map() // key → Promise<forecast|null>
const queue = []
let running = 0

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const job = queue.shift()
    running += 1
    job().finally(() => {
      running -= 1
      pump()
    })
  }
}

// One forecast per rounded spot and day, shared by every card that asks.
// Resolves null when there is nothing to show.
export function getForecast(task) {
  const lat = Math.round(Number(task.latitude) * 100) / 100
  const lng = Math.round(Number(task.longitude) * 100) / 100
  const date = String(task.date).slice(0, 10)
  const key = `${lat},${lng},${date}`
  if (!results.has(key)) {
    let token = null
    try { token = localStorage.getItem('voluntrack:auth_token') } catch { /* storage blocked */ }
    if (!token) return Promise.resolve(null)
    results.set(key, new Promise((resolve) => {
      queue.push(async () => {
        try {
          const params = new URLSearchParams({ lat: String(lat), lng: String(lng), date })
          const res = await fetch(`${apiUrl}/weather?${params}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(8000),
          })
          resolve(res.status === 200 ? await res.json() : null)
        } catch {
          resolve(null)
        }
      })
      pump()
    }))
  }
  return results.get(key)
}

// WMO weather code → a broad kind for the icon.
export function weatherKind(code) {
  const c = Number(code)
  if (c === 0) return 'clear'
  if (c === 1 || c === 2) return 'partly'
  if (c === 3) return 'cloudy'
  if (c === 45 || c === 48) return 'fog'
  if (c >= 51 && c <= 57) return 'drizzle'
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return 'rain'
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow'
  if (c >= 95) return 'storm'
  return 'cloudy'
}

export const RAIN_ALERT_PERCENT = 60
export const HOT_C = 32
export const HOT_F = 90
