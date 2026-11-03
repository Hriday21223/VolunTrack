import { useState } from 'react'
import { Phone } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

// A parent's emergency contact for their child at volunteer events (#639).
// Organizers see it on the check-in list only around the day of an event.
export default function EmergencyContactCard({ child }) {
  const [saved, setSaved] = useState(child.emergencyContact || null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(child.emergencyContact?.name || '')
  const [phone, setPhone] = useState(child.emergencyContact?.phone || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const first = String(child.name || '').split(' ')[0] || tr('your child')
  const url = `${apiUrl}/parent/children/${encodeURIComponent(child.id)}/emergency-contact`

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch(url, { method: 'PUT', headers: headers(), body: JSON.stringify({ name, phone }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || tr('Could not save the emergency contact.'))
      setSaved(body.emergencyContact)
      setEditing(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(url, { method: 'DELETE', headers: headers() })
      if (!res.ok) throw new Error(tr('Could not remove the emergency contact.'))
      setSaved(null)
      setName('')
      setPhone('')
      setEditing(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="flex items-start gap-3">
        <Phone className="w-4 h-4 mt-1 text-brand-600 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-semibold text-sm">{tr('Emergency contact for {name}’s events', { name: first })}</h3>
          <p className="text-xs text-earth-500 dark:text-earth-400 mt-0.5">
            {tr('The organizer of an event {name} signed up for sees this on their check-in list, only around the day of the event. It isn’t shown anywhere else.', { name: first })}
          </p>

          {!editing && saved && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium">{saved.name ? `${saved.name} · ` : ''}{saved.phone}</span>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(true)}>{tr('Change')}</button>
              <button type="button" className="btn-ghost btn-sm text-red-600" onClick={remove} disabled={busy}>{tr('Remove')}</button>
            </div>
          )}
          {!editing && !saved && (
            <button type="button" className="btn-primary btn-sm mt-3" onClick={() => setEditing(true)}>{tr('Add a phone number')}</button>
          )}
          {editing && (
            <form onSubmit={save} className="mt-3 grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <label className="text-sm">
                <span className="block mb-1 text-earth-600 dark:text-earth-300">{tr('Name (optional)')}</span>
                <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={tr('e.g. Mom, or Priya Patel')} autoComplete="name" />
              </label>
              <label className="text-sm">
                <span className="block mb-1 text-earth-600 dark:text-earth-300">{tr('Phone')}</span>
                <input className="input" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(214) 555-0123" autoComplete="tel" />
              </label>
              <div className="flex gap-2">
                <button type="submit" className="btn-primary btn-sm" disabled={busy}>{busy ? tr('Saving…') : tr('Save')}</button>
                <button type="button" className="btn-ghost btn-sm" onClick={() => { setEditing(false); setError('') }}>{tr('Cancel')}</button>
              </div>
            </form>
          )}
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 mt-2">{error}</p>}
        </div>
      </div>
    </Card>
  )
}
