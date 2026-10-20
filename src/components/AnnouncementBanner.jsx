import { useEffect, useState } from 'react'
import { Megaphone, X } from 'lucide-react'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const DISMISSED_KEY = 'voluntrack:dismissed-announcements'

const readDismissed = () => {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]') } catch { return [] }
}

// Admin announcements (#290) at the top of the school and organization
// dashboards — e.g. planned downtime. The server picks what this account's
// role should see; each one stays until it expires or is closed on this
// device.
export default function AnnouncementBanner() {
  const [items, setItems] = useState([])
  const [dismissed, setDismissed] = useState(readDismissed)

  useEffect(() => {
    const token = localStorage.getItem('voluntrack:auth_token')
    if (!token) return
    let cancelled = false
    fetch(`${apiUrl}/announcements/mine`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : { announcements: [] }))
      .then((d) => { if (!cancelled) setItems(d.announcements || []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const dismiss = (id) => {
    // Keep only ids still being served, so the list can't grow forever.
    const next = [...dismissed.filter((d) => items.some((a) => a.id === d)), id]
    setDismissed(next)
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)) } catch { /* storage off: hidden until reload */ }
  }

  const visible = items.filter((a) => !dismissed.includes(a.id))
  if (visible.length === 0) return null

  return (
    <div className="space-y-2 mb-4">
      {visible.map((a) => (
        <div key={a.id} role="status" className="flex items-start gap-3 rounded-2xl border border-sky-500/30 bg-sky-500/10 p-4">
          <Megaphone className="w-5 h-5 text-sky-500 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm">{a.title}</p>
            <p className="text-sm text-earth-600 dark:text-earth-300 whitespace-pre-line mt-0.5">{a.message}</p>
          </div>
          <button onClick={() => dismiss(a.id)} className="p-1 text-earth-400 hover:text-earth-600 dark:hover:text-earth-200" aria-label={tr('Dismiss: {title}', { title: a.title })}>
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
