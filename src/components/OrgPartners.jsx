import { useEffect, useRef, useState } from 'react'
import { Handshake, Pencil, Trash2, Upload, Download, Plus, ExternalLink } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { parseCsv } from '@/lib/rosterCsv.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const EMPTY = { name: '', address: '', causes: '', contactName: '', contactEmail: '', website: '', notes: '' }
const CSV_HEAD = ['Name', 'Address', 'Causes', 'Contact name', 'Contact email', 'Website', 'Notes']

async function call(path, opts = {}) {
  let token = null
  try { token = localStorage.getItem('voluntrack:auth_token') } catch { /* private mode */ }
  const res = await fetch(`${apiUrl}/organization/partners${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'Something went wrong.')
  return body
}

// CSV header → partner field. Loose on purpose: "E-mail", "Contact Email" and
// "email" all land on contactEmail.
function fieldFor(header) {
  const h = header.toLowerCase().replace(/[^a-z]/g, '')
  if (/^(organization|org|partner)?name$/.test(h)) return 'name'
  if (/address|location/.test(h)) return 'address'
  if (/cause|category|focus/.test(h)) return 'causes'
  if (/email/.test(h)) return 'contactEmail'
  if (/contact|person/.test(h)) return 'contactName'
  if (/web|url|site/.test(h)) return 'website'
  if (/note/.test(h)) return 'notes'
  return null
}

function partnersFromCsv(text) {
  const rows = parseCsv(text)
  if (rows.length < 2) return []
  const fields = rows[0].map(fieldFor)
  if (!fields.includes('name')) throw new Error('The first row needs a "Name" column.')
  return rows.slice(1).map((r) => {
    const p = {}
    fields.forEach((f, i) => { if (f && r[i]) p[f] = r[i] })
    return p
  }).filter((p) => p.name)
}

const csvCell = (v) => {
  const s = String(v ?? '')
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

// Organization dashboard → Partners (#611): the nonprofits the organization
// approved, shared with all its schools. Optionally counted as approved places
// at every school; partners who post events get a "District partner" label.
export default function OrgPartners() {
  const [state, setState] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [editing, setEditing] = useState(null) // partner id, or 'new'
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => { call('').then(setState).catch((e) => setError(e.message)) }, [])

  const run = async (fn) => {
    setBusy(true)
    setError('')
    setNote('')
    try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const body = () => ({ ...form, causes: form.causes.split(/[;,]/).map((c) => c.trim()).filter(Boolean) })
  const save = (e) => {
    e.preventDefault()
    run(async () => {
      const out = editing === 'new'
        ? await call('', { method: 'POST', body: JSON.stringify(body()) })
        : await call(`/${encodeURIComponent(editing)}`, { method: 'PATCH', body: JSON.stringify(body()) })
      if (editing === 'new' && out.added === 0) setNote('That partner is already on the list.')
      setState(out)
      setEditing(null)
      setForm(EMPTY)
    })
  }
  const edit = (p) => {
    setEditing(p.id)
    setForm({ ...EMPTY, ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v ?? ''])), causes: (p.causes || []).join(', ') })
  }
  const remove = (p) => {
    if (!window.confirm(`Remove ${p.name} from your partner list?`)) return
    run(async () => setState(await call(`/${encodeURIComponent(p.id)}`, { method: 'DELETE' })))
  }
  const toggle = (asPlaces) => run(async () => setState(await call('/settings', { method: 'PUT', body: JSON.stringify({ asPlaces }) })))
  const importFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    run(async () => {
      if (file.size > 1024 * 1024) throw new Error('Choose a CSV file under 1 MB.')
      const partners = partnersFromCsv(await file.text())
      if (partners.length === 0) throw new Error('No partners found in that file.')
      const out = await call('', { method: 'POST', body: JSON.stringify({ partners }) })
      setState(out)
      setNote(`Added ${out.added} partner${out.added === 1 ? '' : 's'}${out.skipped ? `; ${out.skipped} already on the list` : ''}.`)
    })
  }
  const exportCsv = () => {
    const lines = [CSV_HEAD.join(','), ...state.partners.map((p) => [p.name, p.address, (p.causes || []).join('; '), p.contactName, p.contactEmail, p.website, p.notes].map(csvCell).join(','))]
    const url = URL.createObjectURL(new Blob([`${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'partners.csv'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (!state) return <Card>{error ? <p className="text-sm text-red-500">{error}</p> : <p className="text-sm text-earth-500">Loading…</p>}</Card>
  const field = (key, label, props = {}) => (
    <label className="block text-sm">
      <span className="label">{label}</span>
      <input className="input w-full" value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} {...props} />
    </label>
  )

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold flex items-center gap-2"><Handshake className="w-4 h-4 text-brand-600" /> Partner organizations</h3>
            <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">
              The nonprofits your schools work with, kept in one list. Students at your schools see it on Opportunities, and advisers also see the contact person.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-sm btn-primary" onClick={() => { setEditing('new'); setForm(EMPTY) }} disabled={busy || state.partners.length >= state.max}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add partner
            </button>
            <button type="button" className="btn-sm btn-ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload className="w-3.5 h-3.5 mr-1" /> Import CSV
            </button>
            {state.partners.length > 0 && (
              <button type="button" className="btn-sm btn-ghost" onClick={exportCsv}>
                <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
              </button>
            )}
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={importFile} />
          </div>
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={state.asPlaces} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
          <span>
            Count these as approved places at all my schools.
            <span className="block text-xs text-earth-500 dark:text-earth-400">They are added to each school's own list. Hours from other places are still counted, but advisers see them flagged to check.</span>
          </span>
        </label>
        <p className="text-xs text-earth-500 dark:text-earth-400 mt-2">
          A partner whose contact email matches the account they post events from gets a <em>District partner</em> label on those events for your students. CSV columns: {CSV_HEAD.join(', ')} (separate causes with semicolons).
        </p>
        {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
        {note && <p className="text-sm text-brand-600 dark:text-brand-300 mt-2">{note}</p>}
      </Card>

      {editing && (
        <Card>
          <form onSubmit={save} className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">{field('name', 'Name *', { required: true, maxLength: 120 })}</div>
            {field('address', 'Address', { maxLength: 200 })}
            {field('causes', 'Causes (comma separated)', { placeholder: 'Hunger, Education', maxLength: 400 })}
            {field('contactName', 'Contact person', { maxLength: 100 })}
            {field('contactEmail', 'Contact email', { type: 'email', maxLength: 200 })}
            {field('website', 'Website', { maxLength: 200, placeholder: 'https://' })}
            {field('notes', 'Notes for advisers', { maxLength: 500 })}
            <div className="sm:col-span-2 flex gap-2">
              <button type="submit" className="btn-primary btn-sm" disabled={busy}>{editing === 'new' ? 'Add partner' : 'Save'}</button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => { setEditing(null); setForm(EMPTY) }}>Cancel</button>
            </div>
          </form>
        </Card>
      )}

      <Card padded={false}>
        {state.partners.length === 0 ? (
          <p className="p-4 text-sm text-earth-500">No partners yet. Add one, or import a CSV.</p>
        ) : (
          <ul className="divide-y divide-earth-100 dark:divide-[#1f2e25]">
            {state.partners.map((p) => (
              <li key={p.id} className="p-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium flex items-center gap-2">
                    {p.name}
                    {p.website && <a href={p.website} target="_blank" rel="noopener noreferrer" className="text-brand-500" aria-label={`${p.name} website`}><ExternalLink className="w-3.5 h-3.5" /></a>}
                  </p>
                  {p.address && <p className="text-sm text-earth-500 dark:text-earth-400">{p.address}</p>}
                  {(p.causes || []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">{p.causes.map((c) => <span key={c} className="chip text-xs">{c}</span>)}</div>
                  )}
                  {(p.contactName || p.contactEmail) && (
                    <p className="text-xs text-earth-500 dark:text-earth-400 mt-1">{[p.contactName, p.contactEmail].filter(Boolean).join(' · ')}</p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button type="button" className="p-1.5 rounded hover:bg-white/10" onClick={() => edit(p)} aria-label={`Edit ${p.name}`}><Pencil className="w-4 h-4" /></button>
                  <button type="button" className="p-1.5 rounded hover:bg-white/10 text-red-400" onClick={() => remove(p)} aria-label={`Remove ${p.name}`} disabled={busy}><Trash2 className="w-4 h-4" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
