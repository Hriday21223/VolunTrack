import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, Plus, Pencil, Trash2, ExternalLink, Link2 } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { EVENT_TIME_ZONES, utcToZoned, isUpcoming } from '@schoolEvents'

// Admin → Invites → Events for schools (#995). Sessions VolunTrack runs for
// school staff and organizations. The public /events page and the banner on
// the home and For schools pages show the next published one while it's
// coming up. Admin-only, so English.

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const base = `${apiUrl}/events/admin`
const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

const ZONE_LABEL = {
  'America/New_York': 'Eastern', 'America/Chicago': 'Central', 'America/Denver': 'Mountain', 'America/Phoenix': 'Arizona',
  'America/Los_Angeles': 'Pacific', 'America/Anchorage': 'Alaska', 'Pacific/Honolulu': 'Hawaii',
}
const AGENDA_EXAMPLE = '0:00 Why paper hour logs break\n0:05 The student side: logging and signing\n0:12 The adviser dashboard\n0:20 Districts and organizations\n0:25 Questions, pricing and today’s offer'

const empty = () => ({ id: null, title: '', date: '', time: '16:00', timeZone: 'America/Chicago', durationMinutes: 30, mode: 'online', place: '', agenda: AGENDA_EXAMPLE, offerCode: '', offerText: '', rsvpUrl: '', published: true })

function whenText(ev) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: ev.timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(ev.startsAt))
  } catch { return ev.startsAt }
}

export default function SchoolEventsPanel() {
  const [events, setEvents] = useState([])
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [confirmId, setConfirmId] = useState(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(base, { headers: headers() })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not load events.')
      setEvents(d.events || [])
    } catch (e) { setMsg({ ok: false, text: e.message }) }
  }, [])
  useEffect(() => { load() }, [load])

  const edit = (ev) => {
    const { date, time } = utcToZoned(ev.startsAt, ev.timeZone)
    setForm({ id: ev.id, title: ev.title, date, time, timeZone: ev.timeZone, durationMinutes: ev.durationMinutes, mode: ev.mode, place: ev.place || '', agenda: ev.agenda || '', offerCode: ev.offerCode || '', offerText: ev.offerText || '', rsvpUrl: ev.rsvpUrl || '', published: ev.published })
    setMsg(null)
  }

  const save = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      const body = { ...form, durationMinutes: Number(form.durationMinutes) }
      const r = await fetch(form.id ? `${base}/${encodeURIComponent(form.id)}` : base, { method: form.id ? 'PATCH' : 'POST', headers: headers(), body: JSON.stringify(body) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not save the event.')
      setForm(null)
      setMsg({ ok: true, text: form.id ? 'Event updated.' : 'Event added.' })
      load()
    } catch (e2) { setMsg({ ok: false, text: e2.message }) } finally { setBusy(false) }
  }

  const remove = async (id) => {
    setConfirmId(null); setBusy(true)
    try {
      const r = await fetch(`${base}/${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers() })
      if (!r.ok) throw new Error('Could not remove the event.')
      setMsg({ ok: true, text: 'Event removed.' })
      load()
    } catch (e) { setMsg({ ok: false, text: e.message }) } finally { setBusy(false) }
  }

  const [copied, setCopied] = useState(null)
  const copyLink = async (ev) => {
    const url = `${window.location.origin}/events?id=${encodeURIComponent(ev.id)}`
    try { await navigator.clipboard.writeText(url); setCopied(ev.id); setTimeout(() => setCopied(null), 2000) } catch { setMsg({ ok: true, text: `Link: ${url}` }) }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const live = events.find((ev) => isUpcoming(ev))

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><CalendarDays className="w-4 h-4 text-brand-600" aria-hidden="true" /> Events for schools</h3>
          <p className="text-sm text-earth-400 mt-1 max-w-2xl">Sessions for school staff and organizations to see VolunTrack. While a published event is coming up, it shows at <a href="/events" target="_blank" rel="noopener noreferrer" className="underline">/events</a> and as a banner on the home and For schools pages. <b>Copy link</b> gives each event its own address (<code>/events?id=…</code>) for your emails and Eventbrite. Students can’t sign up for these.</p>
        </div>
        {!form && <button type="button" onClick={() => { setForm(empty()); setMsg(null) }} className="btn-primary btn-sm inline-flex items-center gap-1"><Plus className="w-4 h-4" aria-hidden="true" /> Add event</button>}
      </div>

      {live && !form && (
        <p className="mt-3 text-sm text-emerald-500">Showing now: <b>{live.title}</b> · {whenText(live)}</p>
      )}

      {form && (
        <form onSubmit={save} className="mt-4 space-y-3">
          <div>
            <label className="label" htmlFor="sev-title">Event name</label>
            <input id="sev-title" className="input" value={form.title} onChange={set('title')} placeholder="See VolunTrack for your school" maxLength={120} required />
          </div>
          <div className="grid sm:grid-cols-4 gap-3">
            <div>
              <label className="label" htmlFor="sev-date">Date</label>
              <input id="sev-date" type="date" className="input" value={form.date} onChange={set('date')} required />
            </div>
            <div>
              <label className="label" htmlFor="sev-time">Start time</label>
              <input id="sev-time" type="time" className="input" value={form.time} onChange={set('time')} required />
            </div>
            <div>
              <label className="label" htmlFor="sev-tz">Time zone</label>
              <select id="sev-tz" className="input" value={form.timeZone} onChange={set('timeZone')}>
                {EVENT_TIME_ZONES.map((z) => <option key={z} value={z}>{ZONE_LABEL[z] || z}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="sev-len">Length (minutes)</label>
              <input id="sev-len" type="number" min="10" max="480" step="5" className="input" value={form.durationMinutes} onChange={set('durationMinutes')} required />
            </div>
          </div>
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="label">Where</legend>
            <label className="inline-flex items-center gap-2"><input type="radio" name="sev-mode" checked={form.mode === 'online'} onChange={() => setForm({ ...form, mode: 'online' })} /> Online</label>
            <label className="inline-flex items-center gap-2"><input type="radio" name="sev-mode" checked={form.mode === 'in_person'} onChange={() => setForm({ ...form, mode: 'in_person' })} /> In person</label>
          </fieldset>
          {form.mode === 'in_person' && (
            <div>
              <label className="label" htmlFor="sev-place">Address</label>
              <input id="sev-place" className="input" value={form.place} onChange={set('place')} maxLength={300} required />
            </div>
          )}
          <div>
            <label className="label" htmlFor="sev-agenda">Agenda (one line each; start a line with a time like 0:05 to show it on the left)</label>
            <textarea id="sev-agenda" className="input font-mono text-sm" rows={6} value={form.agenda} onChange={set('agenda')} maxLength={1500} />
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="label" htmlFor="sev-code">Event code (optional)</label>
              <input id="sev-code" className="input font-mono" value={form.offerCode} onChange={(e) => setForm({ ...form, offerCode: e.target.value.toUpperCase() })} maxLength={32} placeholder="GIVETUESDAY" />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="sev-offer">What the code gives (optional)</label>
              <input id="sev-offer" className="input" value={form.offerText} onChange={set('offerText')} maxLength={300} placeholder="A one-month free trial and 20% off your first year." />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="sev-rsvp">RSVP link (Eventbrite or similar; leave empty until you have it)</label>
            <input id="sev-rsvp" className="input" value={form.rsvpUrl} onChange={set('rsvpUrl')} maxLength={500} placeholder="https://www.eventbrite.com/e/…" />
          </div>
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={form.published} onChange={set('published')} /> Show it on the site</label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="btn-primary btn-sm">{busy ? 'Saving…' : form.id ? 'Save changes' : 'Add event'}</button>
            <button type="button" onClick={() => setForm(null)} className="btn-ghost btn-sm">Cancel</button>
          </div>
          <p className="text-xs text-earth-400">The event code itself is made under Event codes above; type the same code here so the page shows it.</p>
        </form>
      )}

      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mt-3 text-sm ${msg.ok ? 'text-emerald-500' : 'text-amber-500'}`}>{msg.text}</p>}

      {!form && (
        events.length === 0 ? (
          <p className="mt-4 text-sm text-earth-400">No events yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-earth-200 dark:divide-white/10">
            {events.map((ev) => {
              const upcoming = isUpcoming(ev)
              return (
                <li key={ev.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium break-words">{ev.title}</p>
                    <p className="text-xs text-earth-400">
                      {whenText(ev)} · {ev.durationMinutes} min · {ev.mode === 'online' ? 'Online' : ev.place}
                      {' · '}
                      <span className={!ev.published ? 'text-earth-500' : upcoming ? 'text-emerald-500' : 'text-earth-500'}>{!ev.published ? 'Hidden' : upcoming ? 'Coming up' : 'Over'}</span>
                      {!ev.rsvpUrl && upcoming && <span className="text-amber-500"> · No RSVP link yet</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {ev.published && <a href={`/events?id=${encodeURIComponent(ev.id)}`} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm inline-flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> View</a>}
                    {ev.published && <button type="button" onClick={() => copyLink(ev)} className="btn-ghost btn-sm inline-flex items-center gap-1"><Link2 className="w-3.5 h-3.5" aria-hidden="true" /> {copied === ev.id ? 'Copied' : 'Copy link'}</button>}
                    <button type="button" onClick={() => edit(ev)} className="btn-ghost btn-sm inline-flex items-center gap-1"><Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit</button>
                    {confirmId === ev.id ? (
                      <>
                        <button type="button" onClick={() => remove(ev.id)} disabled={busy} className="btn-sm bg-red-600 text-white hover:bg-red-700">Remove</button>
                        <button type="button" onClick={() => setConfirmId(null)} className="btn-ghost btn-sm">Cancel</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setConfirmId(ev.id)} className="btn-ghost btn-sm text-red-400 inline-flex items-center gap-1" aria-label={`Remove ${ev.title}`}><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )
      )}
    </Card>
  )
}
