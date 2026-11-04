import { useState } from 'react'
import { Camera, X } from 'lucide-react'
import { tr } from '@/lib/i18n.js'
import { matchSheet } from '@/lib/paperAttendance.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// Enter the paper sign-in sheet (#693): a time in and out per approved
// volunteer, typed or read off a photo of the sheet (on the device, like
// Scan a paper log). Saving checks them out like a scan; their hours then
// wait for the organizer's signature.
export default function PaperAttendance({ task, onClose, onSaved }) {
  const people = (task.signups || []).filter((s) => s.status === 'approved' && !s.checked_out_at && !s.task_log)
  const [times, setTimes] = useState({})
  const [reading, setReading] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const day = String(task.date).slice(0, 10)

  const set = (id, key, v) => setTimes((cur) => ({ ...cur, [id]: { ...cur[id], [key]: v } }))
  const hours = (t) => {
    if (!t?.in || !t?.out) return null
    const [a, b] = [t.in, t.out].map((x) => { const [h, m] = x.split(':').map(Number); return h * 60 + m })
    return b > a ? Math.max(1, Math.round((b - a) / 15)) / 4 : null
  }

  const fromPhoto = async (file) => {
    if (!file) return
    setMsg(null)
    setReading(0)
    try {
      const { readOnDevice } = await import('@/lib/paperLogOcr.js')
      const text = await readOnDevice(file, (p) => setReading(Math.round(p * 100)))
      const found = matchSheet(text, people.map((p) => ({ id: p.id, name: p.name })))
      const n = Object.keys(found).length
      setTimes((cur) => ({ ...cur, ...Object.fromEntries(Object.entries(found).filter(([id]) => !cur[id]?.in && !cur[id]?.out)) }))
      setMsg({ ok: n > 0, text: n > 0 ? tr('Filled in times for {n} volunteers. Check them against the sheet.', { n }) : tr("Couldn't read the times. Type them in instead.") })
    } catch {
      setMsg({ ok: false, text: tr("Couldn't read the photo. Type the times in instead.") })
    } finally {
      setReading(null)
    }
  }

  const save = async () => {
    const entries = people.filter((p) => hours(times[p.id]) != null).map((p) => ({
      userId: p.id,
      inAt: new Date(`${day}T${times[p.id].in}`).toISOString(),
      outAt: new Date(`${day}T${times[p.id].out}`).toISOString(),
    }))
    if (entries.length === 0) { setMsg({ ok: false, text: tr('Enter a time in and a later time out for at least one volunteer.') }); return }
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${task.id}/paper-attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` },
        body: JSON.stringify({ entries }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || tr('Could not save the sheet.'))
      onSaved?.(tr('{n} volunteers checked out from the paper sheet. Their hours are waiting for your signature.', { n: d.logged }))
    } catch (e) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-white/10 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{tr('Enter the paper sign-in sheet')}</p>
          <p className="text-xs text-earth-400">{tr('Type each time in and out, or fill them from a photo of the sheet. Saving checks them out; you sign their hours after.')}</p>
        </div>
        <button type="button" onClick={onClose} className="btn-ghost p-1" aria-label={tr('Close')}><X className="w-4 h-4" /></button>
      </div>
      {people.length === 0 ? (
        <p className="text-sm text-earth-500 mt-2">{tr('Everyone approved is already checked out or has hours.')}</p>
      ) : (
        <>
          <label className="btn-secondary btn-sm mt-2 inline-flex items-center gap-1 cursor-pointer">
            <Camera className="w-4 h-4" />{' '}{reading != null ? tr('Reading… {n}%', { n: reading }) : tr('Fill from a photo')}
            <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={reading != null} onChange={(e) => fromPhoto(e.target.files?.[0])} />
          </label>
          <ul className="mt-3 space-y-2">
            {people.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="flex-1 min-w-[8rem] truncate">{p.name}</span>
                <input type="time" className="input py-1 w-28 text-xs" value={times[p.id]?.in || ''} onChange={(e) => set(p.id, 'in', e.target.value)} aria-label={tr('Time in for {name}', { name: p.name })} />
                <span className="text-earth-500">–</span>
                <input type="time" className="input py-1 w-28 text-xs" value={times[p.id]?.out || ''} onChange={(e) => set(p.id, 'out', e.target.value)} aria-label={tr('Time out for {name}', { name: p.name })} />
                <span className="w-16 text-right text-xs text-earth-400">{hours(times[p.id]) != null ? tr('{n} h', { n: hours(times[p.id]) }) : ''}</span>
              </li>
            ))}
          </ul>
          {msg && <p role="status" className={`text-sm mt-2 ${msg.ok ? 'text-emerald-400' : 'text-amber-400'}`}>{msg.text}</p>}
          <button type="button" className="btn-primary btn-sm mt-3" onClick={save} disabled={busy}>{busy ? tr('Saving…') : tr('Save and check them out')}</button>
        </>
      )}
    </div>
  )
}
