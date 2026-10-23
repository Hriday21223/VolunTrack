import { useEffect, useRef, useState } from 'react'
import { Sun, CloudSun, Cloud, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning, Droplets } from 'lucide-react'
import { tr } from '@/lib/i18n.js'
import { wantsWeather, getForecast, usesFahrenheit, weatherKind, RAIN_ALERT_PERCENT, HOT_C, HOT_F } from '@/lib/weather.js'

const ICONS = {
  clear: Sun, partly: CloudSun, cloudy: Cloud, fog: CloudFog,
  drizzle: CloudDrizzle, rain: CloudRain, snow: CloudSnow, storm: CloudLightning,
}

// The forecast for an outdoor task in the next 7 days (#435): icon, high/low
// and rain chance, with a heads-up when rain is likely or it will be hot.
// Renders nothing for any other task, or when no forecast comes back. It asks
// only once the card scrolls into view.
export default function WeatherChip({ task, className = '' }) {
  const wanted = wantsWeather(task)
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)
  const [forecast, setForecast] = useState(null)

  useEffect(() => {
    if (!wanted || visible) return undefined
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return undefined
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true)
        io.disconnect()
      }
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [wanted, visible])

  const lat = task?.latitude
  const lng = task?.longitude
  const date = task?.date
  useEffect(() => {
    if (!wanted || !visible) return undefined
    let live = true
    getForecast({ latitude: lat, longitude: lng, date }).then((f) => { if (live) setForecast(f) })
    return () => { live = false }
  }, [wanted, visible, lat, lng, date])

  if (!wanted) return null
  if (!forecast) return <span ref={ref} aria-hidden="true" />

  const f = usesFahrenheit()
  const conv = (c) => Math.round(f ? c * 9 / 5 + 32 : c)
  const high = conv(forecast.highC)
  const low = conv(forecast.lowC)
  const unit = f ? '°F' : '°C'
  const rain = forecast.rainChance
  const rainy = rain != null && rain >= RAIN_ALERT_PERCENT
  const hot = f ? high >= HOT_F : high >= HOT_C
  const Icon = ICONS[weatherKind(forecast.code)] || Cloud
  const notes = [rainy && tr('Rain likely — check with the organizer'), hot && tr('Bring water')].filter(Boolean)
  const label = tr('Forecast: high {high}, low {low}', { high: `${high}${unit}`, low: `${low}${unit}` })
    + (rain != null ? `, ${tr('{n}% chance of rain', { n: rain })}` : '')

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className={rainy || hot ? 'chip-amber' : 'chip-earth'} title={`${label} · Open-Meteo`} aria-label={label}>
        <Icon className="w-3 h-3" aria-hidden="true" />
        <span aria-hidden="true">{high}° / {low}{unit}</span>
        {rain != null && (
          <span className="inline-flex items-center gap-0.5" aria-hidden="true"><Droplets className="w-3 h-3" />{rain}%</span>
        )}
      </span>
      {notes.map((n) => <span key={n} className="text-xs text-amber-500">{n}</span>)}
    </div>
  )
}
