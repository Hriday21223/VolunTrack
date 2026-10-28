import { useCallback, useEffect, useState } from 'react'
import { Megaphone, X } from 'lucide-react'
import Card from '@/components/Card.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

async function call(path, { method = 'GET', body } = {}) {
  let token = null
  try { token = localStorage.getItem('voluntrack:auth_token') } catch { /* private mode */ }
  const res = await fetch(`${apiUrl}/announcements${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.')
  return data
}

const DURATIONS = [
  { hours: 24, label: '1 day' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '1 week' },
  { hours: 336, label: '2 weeks' },
  { hours: 720, label: '30 days' },
]

// An organization's announcement to every school it owns (#557): a banner on
// those schools' dashboards (and their students', if chosen) plus one email
// each. server/routes/announcements.js.
export default function OrgAnnouncementsCard() {
  const [form, setForm] = useState({ title: '', message: '', toSchools: true, toStudents: false, showForHours: 168 })
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(() => {
    call('/org').then((d) => setItems(d.announcements || [])).catch(() => {})
  }, [])
  useEffect(() => { load() }, [load])

  const send = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { announcement } = await call('/org', { method: 'POST', body: form })
      setNotice(`Sent. ${announcement.emailsTotal} ${announcement.emailsTotal === 1 ? 'person is' : 'people are'} being emailed.`)
      setForm((f) => ({ ...f, title: '', message: '' }))
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const end = async (id) => {
    try {
      await call(`/org/${encodeURIComponent(id)}/end`, { method: 'POST' })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="font-semibold mb-1 flex items-center gap-2"><Megaphone className="w-4 h-4 text-brand-600" /> Announce to your schools</h3>
        <p className="text-sm text-earth-500 mb-3">
          Shows as a banner on each of your schools’ dashboards, marked as from your organization, and is emailed once.
        </p>
        <form onSubmit={send} className="space-y-3">
          <input className="input" placeholder="Title" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <textarea className="input" rows={4} placeholder="Message" maxLength={2000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} required />
          <fieldset className="space-y-2">
            <legend className="label">Send to</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.toSchools} onChange={(e) => setForm({ ...form, toSchools: e.target.checked })} />
              School admins and co-admins
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.toStudents} onChange={(e) => setForm({ ...form, toStudents: e.target.checked })} />
              Students at your schools
            </label>
          </fieldset>
          <label className="block">
            <span className="label">Show the banner for</span>
            <select className="input w-auto" value={form.showForHours} onChange={(e) => setForm({ ...form, showForHours: Number(e.target.value) })}>
              {DURATIONS.map((d) => <option key={d.hours} value={d.hours}>{d.label}</option>)}
            </select>
          </label>
          {error && <p className="text-sm text-red-500">{error}</p>}
          {notice && <p className="text-sm text-brand-600 dark:text-brand-400">{notice}</p>}
          <button type="submit" className="btn-primary" disabled={busy || (!form.toSchools && !form.toStudents)}>
            {busy ? 'Sending…' : 'Send announcement'}
          </button>
        </form>
      </Card>

      {items.length > 0 && (
        <Card>
          <h3 className="font-semibold mb-3">Showing now</h3>
          <div className="divide-y divide-earth-200 dark:divide-white/10">
            {items.map((a) => (
              <div key={a.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm">{a.title}</p>
                  <p className="text-xs text-earth-500">
                    {[a.toSchools && 'School admins', a.toStudents && 'Students'].filter(Boolean).join(' and ')}
                    {' · until '}{new Date(a.showUntil).toLocaleDateString()}
                    {' · '}{a.emailsSent}/{a.emailsTotal} emailed
                  </p>
                </div>
                <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => end(a.id)}>
                  <X className="w-3.5 h-3.5 mr-1" /> End now
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
