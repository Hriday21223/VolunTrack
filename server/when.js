// "2026-10-30" + "10:00" → "Fri, Oct 30 · 10:00 AM", or in Spanish
// "vie, 30 oct · 10:00" (24-hour, as Spanish speakers write it). The year
// shows only when it isn't this one. A time that isn't HH:MM (free text) is shown as typed;
// ./ics.js reads times the same way.
export function friendlyWhen(date, time, lang = 'en') {
  const es = lang === 'es'
  // A raw DATE column comes back from pg as a Date at local midnight.
  if (date instanceof Date && !Number.isNaN(date.getTime())) {
    const pad = (n) => String(n).padStart(2, '0')
    date = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '')
  let day = date || ''
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    day = d.toLocaleDateString(es ? 'es-ES' : 'en-US', {
      timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
      ...(+m[1] !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    })
  }
  const hm = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim())
  let clock = time || ''
  if (hm && +hm[1] < 24) {
    clock = es
      ? `${hm[1].padStart(2, '0')}:${hm[2]}`
      : `${((+hm[1] + 11) % 12) + 1}:${hm[2]} ${+hm[1] < 12 ? 'AM' : 'PM'}`
  }
  return [day, clock].filter(Boolean).join(' · ')
}
