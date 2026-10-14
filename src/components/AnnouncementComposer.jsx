import { useCallback, useEffect, useState } from 'react'
import { Megaphone } from 'lucide-react'
import Card from '@/components/Card.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

const DURATIONS = [
  [1, '1 hour'], [2, '2 hours'], [3, '3 hours'], [6, '6 hours'], [12, '12 hours'],
  [24, '1 day'], [72, '3 days'], [168, '7 days'], [720, '30 days'],
]

const audienceLabel = (a) => (a.toSchools && a.toOrgs ? 'Schools and organizations' : a.toSchools ? 'Schools' : 'Organizations')

// Admin: write an announcement to schools and/or organizations (#290) —
// a banner on their dashboards for a set time, plus one email per contact.
// Lists what's showing now so it can be taken down early.
export default function AnnouncementComposer({ defaultAudience = 'schools', onClose }) {
  const [draft, setDraft] = useState({
    title: '',
    message: '',
    toSchools: defaultAudience === 'schools',
    toOrgs: defaultAudience === 'orgs',
    hours: 2,
  })
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sent, setSent] = useState(null)
  const [active, setActive] = useState([])

  const loadActive = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/announcements/admin`, { headers: authHeaders() })
      if (res.ok) setActive((await res.json()).announcements || [])
    } catch { /* the list is a convenience; sending still works */ }
  }, [])

  useEffect(() => { loadActive() }, [loadActive])

  const ready = draft.title.trim() && draft.message.trim() && (draft.toSchools || draft.toOrgs)

  const send = async () => {
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`${apiUrl}/announcements/admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          title: draft.title.trim(),
          message: draft.message.trim(),
          toSchools: draft.toSchools,
          toOrgs: draft.toOrgs,
          showForHours: Number(draft.hours),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not send the announcement.')
      setSent(data)
      setConfirming(false)
      setDraft((d) => ({ ...d, title: '', message: '' }))
      loadActive()
    } catch (e) {
      setErr(e.message)
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  const end = async (id) => {
    await fetch(`${apiUrl}/announcements/admin/${id}/end`, { method: 'POST', headers: authHeaders() }).catch(() => {})
    setActive((prev) => prev.filter((a) => a.id !== id))
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold mb-1 flex items-center gap-2"><Megaphone className="w-4 h-4 text-brand-400" /> Send an announcement</h3>
        <p className="text-sm text-earth-400 mb-4">
          Shows as a banner on their dashboard for the time you choose, and is emailed to each contact. Not a payment notice — use it for things like planned downtime.
        </p>

        {sent && (
          <div className="text-sm rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 px-3 py-2 mb-3">
            Sent. Showing until {new Date(sent.showUntil).toLocaleString()} · {sent.emailsSent} of {sent.emailsTotal} email{sent.emailsTotal === 1 ? '' : 's'} delivered.
          </div>
        )}
        {err && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg mb-3">{err}</div>}

        <div className="space-y-3">
          <fieldset>
            <legend className="label">Send to</legend>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.toSchools} onChange={(e) => setDraft({ ...draft, toSchools: e.target.checked })} /> Schools
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.toOrgs} onChange={(e) => setDraft({ ...draft, toOrgs: e.target.checked })} /> Organizations
              </label>
            </div>
          </fieldset>
          <div>
            <label className="label" htmlFor="ann-title">Title</label>
            <input id="ann-title" className="input" maxLength={120} placeholder="Planned maintenance tonight" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="ann-message">Message</label>
            <textarea id="ann-message" className="input min-h-[96px]" maxLength={2000} placeholder="VolunTrack will be offline from 8:00 to 9:00 PM Central for maintenance. Anything you save before then is safe." value={draft.message} onChange={(e) => setDraft({ ...draft, message: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="ann-hours">Show the banner for</label>
            <select id="ann-hours" className="input" value={draft.hours} onChange={(e) => setDraft({ ...draft, hours: e.target.value })}>
              {DURATIONS.map(([h, label]) => <option key={h} value={h}>{label}</option>)}
            </select>
          </div>

          {confirming ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm space-y-2">
              <p>This emails every {draft.toSchools && draft.toOrgs ? 'school and organization' : draft.toSchools ? 'school' : 'organization'} contact now. Send it?</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirming(false)} className="btn-ghost flex-1" disabled={busy}>Back</button>
                <button onClick={send} className="btn-primary flex-1" disabled={busy}>{busy ? 'Sending…' : 'Yes, send'}</button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={onClose} className="btn-ghost flex-1">Close</button>
              <button onClick={() => setConfirming(true)} className="btn-primary flex-1" disabled={!ready}>Send</button>
            </div>
          )}
        </div>

        {active.length > 0 && (
          <div className="mt-5 pt-4 border-t border-earth-200 dark:border-earth-800">
            <p className="label">Showing now</p>
            <ul className="space-y-2">
              {active.map((a) => (
                <li key={a.id} className="flex items-start gap-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{a.title}</p>
                    <p className="text-xs text-earth-500">{audienceLabel(a)} · until {new Date(a.showUntil).toLocaleString()}</p>
                  </div>
                  <button onClick={() => end(a.id)} className="text-xs text-red-400 hover:text-red-300 shrink-0">End now</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  )
}
