import { format, formatDistanceToNow, parseISO, differenceInMinutes } from 'date-fns'

export const fmtDate = (iso) => (iso ? format(parseISO(iso), 'MMM d, yyyy') : '—')
export const fmtDateLong = (iso) => (iso ? format(parseISO(iso), 'MMMM d, yyyy') : '')
export const fmtTime = (iso) => (iso ? format(parseISO(iso), 'h:mm a') : '—')
export const fmtDateTime = (iso) => (iso ? format(parseISO(iso), "MMM d, yyyy 'at' h:mm a") : '—')
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

export function startOfTodayISO() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}
