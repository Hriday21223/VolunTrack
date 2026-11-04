import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, Pencil, X } from 'lucide-react'
import { tr } from '@/lib/i18n.js'
import { FREE_DAYS, FREE_PARTS, cleanFreeTimes, hasFreeTimes } from '@/lib/freeTimes.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const LOCAL_KEY = 'voluntrack:free-times'

const DAY_LABELS = { mon: tr('Mon'), tue: tr('Tue'), wed: tr('Wed'), thu: tr('Thu'), fri: tr('Fri'), sat: tr('Sat'), sun: tr('Sun') }
const PART_LABELS = { morning: tr('Morning'), afternoon: tr('Afternoon'), evening: tr('Evening') }

function readLocal() {
  try { return cleanFreeTimes(JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}')) } catch { return {} }
}

// When the viewer is usually free (#672): saved with the account when signed
// in, else on this device. Only they see it.
export function useFreeTimes() {
  const token = localStorage.getItem('voluntrack:auth_token')
  const [freeTimes, setFreeTimes] = useState(() => (token ? {} : readLocal()))
  useEffect(() => {
    if (!token) return
    let stopped = false
    fetch(`${apiUrl}/interests/free-times`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!stopped && d) setFreeTimes(cleanFreeTimes(d.freeTimes)) })
      .catch(() => {})
    return () => { stopped = true }
  }, [token])
  const save = useCallback(async (next) => {
    const clean = cleanFreeTimes(next)
    if (!token) {
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(clean)) } catch { /* private mode */ }
      setFreeTimes(clean)
      return
    }
    const res = await fetch(`${apiUrl}/interests/free-times`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ freeTimes: clean }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(d.error || tr('Could not save when you are free.'))
    setFreeTimes(cleanFreeTimes(d.freeTimes))
  }, [token])
  return { freeTimes, save }
}

// The filter button plus its editor: a week of morning/afternoon/evening boxes.
export default function FreeTimesFilter({ on, onToggle, freeTimes, save }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const open = () => { setDraft(freeTimes); setError(''); setEditing(true) }
  const flip = (day, part) => setDraft((d) => {
    const parts = d[day] || []
    return { ...d, [day]: parts.includes(part) ? parts.filter((p) => p !== part) : [...parts, part] }
  })
  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await save(draft)
      setEditing(false)
      if (hasFreeTimes(draft) && !on) onToggle(true)
      if (!hasFreeTimes(draft) && on) onToggle(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  const set = hasFreeTimes(freeTimes)
  return (
    <>
      <span className="inline-flex items-center">
        <button
          type="button"
          onClick={() => (set ? onToggle(!on) : open())}
          aria-pressed={on}
          className={`btn-sm inline-flex items-center gap-1 ${on ? 'btn-primary' : 'btn-ghost'}`}
        >
          <CalendarClock className="w-3.5 h-3.5" />{' '}{tr("When I'm free")}
        </button>
        {set && (
          <button type="button" onClick={open} className="btn-ghost btn-sm px-1.5" aria-label={tr('Edit when you are free')} title={tr('Edit when you are free')}>
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
      </span>
      {editing && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="free-times-title">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white dark:bg-[#0f1813] p-5 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <h2 id="free-times-title" className="font-display font-semibold text-lg">{tr('When are you usually free?')}</h2>
              <button type="button" onClick={() => setEditing(false)} className="btn-ghost p-1" aria-label={tr('Close')}><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-earth-500 mt-1">{tr('Tick the times that work for you. "When I\'m free" then shows only events that start then. Only you see this.')}</p>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left font-normal text-earth-500" />
                  {FREE_PARTS.map((p) => <th key={p} className="font-medium text-xs px-1 pb-2">{PART_LABELS[p]}</th>)}
                </tr>
              </thead>
              <tbody>
                {FREE_DAYS.map((day) => (
                  <tr key={day}>
                    <th scope="row" className="text-left font-medium py-1">{DAY_LABELS[day]}</th>
                    {FREE_PARTS.map((part) => (
                      <td key={part} className="text-center">
                        <input
                          type="checkbox"
                          className="w-5 h-5 accent-emerald-600"
                          checked={(draft[day] || []).includes(part)}
                          onChange={() => flip(day, part)}
                          aria-label={`${DAY_LABELS[day]} ${PART_LABELS[part]}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-earth-500 mt-2">{tr('Morning is before noon, afternoon noon to 5 PM, evening after 5 PM.')}</p>
            {error && <p role="alert" className="text-sm text-red-400 mt-2">{error}</p>}
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={submit} disabled={busy} className="btn-primary btn-sm">{busy ? tr('Saving…') : tr('Save')}</button>
              <button type="button" onClick={() => setEditing(false)} className="btn-ghost btn-sm">{tr('Cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
