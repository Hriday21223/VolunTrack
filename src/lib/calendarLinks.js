// Google Calendar's own "new event" page for a volunteer task. The task has a
// start time but no end, so it assumes two hours, matching
// GET /api/school/public-tasks/:id/calendar.ics.
const pad = (n) => String(n).padStart(2, '0')
const stamp = (dt) => `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00`

export function googleCalendarUrl(task) {
  const [y, m, d] = String(task.date).slice(0, 10).split('-').map(Number)
  const hm = /^(\d{1,2}):(\d{2})/.exec(task.time || '')
  let dates
  if (hm) {
    const start = new Date(Date.UTC(y, m - 1, d, Number(hm[1]), Number(hm[2])))
    // A shift (#589) carries its own end time.
    const endHm = /^(\d{1,2}):(\d{2})/.exec(task.end_time || '')
    const end = endHm ? new Date(Date.UTC(y, m - 1, d, Number(endHm[1]), Number(endHm[2]))) : null
    dates = `${stamp(start)}/${stamp(end && end > start ? end : new Date(start.getTime() + 2 * 3600e3))}`
  } else {
    const day = new Date(Date.UTC(y, m - 1, d))
    dates = `${stamp(day).slice(0, 8)}/${stamp(new Date(day.getTime() + 86400e3)).slice(0, 8)}`
  }
  const details = [task.description, task.creator_name && `Posted by ${task.creator_name}`, `${window.location.origin}/opportunities`].filter(Boolean).join('\n\n')
  const q = new URLSearchParams({ action: 'TEMPLATE', text: task.title || 'Volunteer task', dates, location: task.is_online ? 'Online' : (task.location || ''), details })
  return `https://calendar.google.com/calendar/render?${q}`
}

