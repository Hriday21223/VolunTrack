import { useEffect, useState } from 'react'
import { Building2, Plus, Search, Globe, Mail, MapPin } from 'lucide-react'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import { ACTIVITY_CATEGORIES, categoryColor } from '@/lib/categories.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

const blank = () => ({ name: '', description: '', category: ACTIVITY_CATEGORIES[0], website: '', contactEmail: '', city: '' })

export default function Organizations() {
  const [orgs, setOrgs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(blank())
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const qs = category ? `?category=${encodeURIComponent(category)}` : ''
      const res = await fetch(`${apiUrl}/organizations${qs}`, { headers: authHeaders() })
      if (!res.ok) throw new Error('Could not load organizations.')
      const data = await res.json()
      setOrgs(data.organizations || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [category])

  const onSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/organizations`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not save organization.')
      setForm(blank())
      setShowForm(false)
      setToast(true)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const visible = orgs.filter((o) => o.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <AppLayout
      title="Organizations"
      subtitle="Browse volunteer organizations, or add one for others to find."
      action={
        <button className="btn-primary" onClick={() => setShowForm((s) => !s)}>
          <Plus className="w-4 h-4" /> {showForm ? 'Close' : 'Add organization'}
        </button>
      }
    >
      {showForm && (
        <Card className="mb-5">
          <form onSubmit={onSubmit} className="grid sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="label">Name *</label>
              <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Description</label>
              <textarea className="input min-h-[80px]" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <label className="label">Category</label>
              <select className="input" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                {ACTIVITY_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="label">City</label>
              <input className="input" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
            </div>
            <div>
              <label className="label">Website</label>
              <input className="input" type="url" placeholder="https://…" value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} />
            </div>
            <div>
              <label className="label">Contact email</label>
              <input className="input" type="email" value={form.contactEmail} onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))} />
            </div>
            {error && <div className="sm:col-span-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg">{error}</div>}
            <div className="sm:col-span-2">
              <button className="btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save organization'}</button>
            </div>
          </form>
        </Card>
      )}

      <Card className="mb-5">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-earth-400" />
            <input className="input pl-9" placeholder="Search organizations…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input sm:w-56" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {ACTIVITY_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </Card>

      {loading ? (
        <div className="text-sm text-earth-400 py-8 text-center">Loading…</div>
      ) : error && orgs.length === 0 ? (
        <div className="text-sm text-red-500 py-8 text-center">{error}</div>
      ) : visible.length === 0 ? (
        <div className="text-sm text-earth-400 py-8 text-center border border-dashed border-earth-200 dark:border-[#243529] rounded-xl">
          No organizations found. Be the first to add one.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((o) => (
            <Card key={o.id}>
              <div className="flex items-start gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-brand-100 dark:bg-brand-900/30 grid place-items-center text-brand-700 flex-shrink-0">
                  <Building2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-display font-semibold truncate">{o.name}</div>
                  {o.category && <span className={`chip ${categoryColor(o.category)}`}>{o.category}</span>}
                </div>
              </div>
              {o.description && <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">{o.description}</p>}
              <div className="space-y-1 text-xs text-earth-500 dark:text-earth-400">
                {o.city && <div className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> {o.city}</div>}
                {o.website && (
                  <a href={o.website} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-brand-600 hover:underline">
                    <Globe className="w-3.5 h-3.5" /> {o.website}
                  </a>
                )}
                {o.contact_email && <div className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> {o.contact_email}</div>}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Toast open={toast} onClose={() => setToast(false)}>Organization added</Toast>
    </AppLayout>
  )
}
