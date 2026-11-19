import { format as dfFormat, formatDistanceToNow as dfDistance, parseISO, differenceInMinutes } from 'date-fns'
import { es, vi, zhCN } from 'date-fns/locale'
import { language } from '@/lib/i18n.js'

// Month and day names follow the app's language (src/lib/i18n.js).
const locale = { es, vi, zh: zhCN }[language]
const format = (d, f) => dfFormat(d, f, { locale })
const formatDistanceToNow = (d, o) => dfDistance(d, { ...o, locale })

// Date patterns per language; English is the fallback.
const PATTERNS = {
  es: { short: 'd MMM yyyy', long: "d 'de' MMMM 'de' yyyy", time: "d MMM yyyy 'a las' h:mm a" },
  vi: { short: 'd MMM, yyyy', long: "d MMMM, yyyy", time: "HH:mm, d MMM, yyyy" },
  zh: { short: 'yyyy年M月d日', long: 'yyyy年M月d日', time: 'yyyy年M月d日 HH:mm' },
}
const pattern = PATTERNS[language] || { short: 'MMM d, yyyy', long: 'MMMM d, yyyy', time: "MMM d, yyyy 'at' h:mm a" }

export const fmtDate = (iso) => (iso ? format(parseISO(iso), pattern.short) : '—')
export const fmtDateLong = (iso) => (iso ? format(parseISO(iso), pattern.long) : '')
// "14:30" (how a task stores its time) → "2:30 PM".
export function fmtClock(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''))
  if (!m) return String(hhmm || '')
  const h = Number(m[1])
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}
export const fmtTime = (iso) => (iso ? format(parseISO(iso), 'h:mm a') : '—')
export const fmtDateTime = (iso) => (iso ? format(parseISO(iso), pattern.time) : '—')
export const fromNow = (iso) => (iso ? formatDistanceToNow(parseISO(iso), { addSuffix: true }) : '')

export function hoursBetween(start, end) {
  if (!start || !end) return 0
  const mins = differenceInMinutes(parseISO(end), parseISO(start))
  return Math.max(0, Math.round((mins / 60) * 100) / 100)
}

export function fmtHours(n) {
  if (n == null || isNaN(n)) return '0h'
  if (n === 0) return '0h'
  if (n < 1) return `${Math.round(n * 60)}m`
  if (Number.isInteger(n)) return `${n}h`
  return `${n.toFixed(2)}h`
}

// The person's own date as YYYY-MM-DD. Not toISOString(), which is UTC and
// already tomorrow in the US evening (lint rule in eslint.config.js, #878).
export function todayLocal(d = new Date()) {
  return dfFormat(d, 'yyyy-MM-dd')
}

export function startOfTodayISO() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}
