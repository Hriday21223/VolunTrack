import { useEffect, useRef, useState } from 'react'
import { Camera, Loader2, X } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { ACTIVITY_CATEGORIES } from '@/lib/categories.js'
import { tr } from '@/lib/i18n.js'
import { readOnDevice } from '@/lib/paperLogOcr.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const MAX_SIDE = 1600

// Shrinks the photo on the device so it fits the API's 1 MB request limit
// and uploads quickly: longest side 1600 px, JPEG.
async function photoToDataUrl(file) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  for (const quality of [0.82, 0.7, 0.55]) {
    const url = canvas.toDataURL('image/jpeg', quality)
    if (url.length < 900_000) return url
  }
  return canvas.toDataURL('image/jpeg', 0.45)
}

// Log Hours → "Scan a paper log" (#516, #521). A photo of an old paper hours
// sheet becomes a list the student checks and edits; only ticked rows are
// saved. Read on the device, or by the server's AI reader when one is set up
// (better with handwriting).
export default function ScanPaperLog({ onAdd }) {
  const [serverScan, setServerScan] = useState(false)
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [rows, setRows] = useState(null)
  const [note, setNote] = useState('')
  const input = useRef(null)
  const token = localStorage.getItem('voluntrack:auth_token')

  useEffect(() => {
    if (!token) return
    fetch(`${apiUrl}/logs/scan/available`)
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((d) => setServerScan(Boolean(d.available)))
      .catch(() => {})
  }, [token])

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    setBusy(true)
    setProgress(0)
    try {
      if (!serverScan || !token) {
        setRows((await readOnDevice(file, setProgress)).map((r, i) => ({ ...r, key: i, keep: Boolean(r.date && r.activity && r.hours > 0) })))
        setNote('')
        return
      }
      const image = await photoToDataUrl(file)
      const res = await fetch(`${apiUrl}/logs/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || tr("Couldn't read that photo. Please try again."))
      setRows((data.entries || []).map((r, i) => ({ ...r, key: i, keep: Boolean(r.date && r.activity && r.hours > 0) })))
      setNote(data.note || '')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const update = (key, field, value) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)))
  const ready = (rows || []).filter((r) => r.keep && r.date && r.activity.trim() && Number(r.hours) > 0)

  const addAll = () => {
    for (const r of ready) {
      onAdd({
        date: r.date,
        activity: r.activity.trim(),
        hours: Number(r.hours),
        category: ACTIVITY_CATEGORIES[0],
        orgName: r.orgName || '',
        supervisorName: r.supervisorName || '',
        notes: tr('Added from a photo of a paper log.'),
      })
    }
    setRows(null)
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-display font-semibold flex items-center gap-2"><Camera className="w-4 h-4 text-brand-600" />{' '}{tr('Have a paper log?')}</h3>
          <p className="text-sm text-earth-500 dark:text-earth-400 mt-0.5">{tr('Take a photo and we’ll fill in the entries. You check every one before it’s saved.')}</p>
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}{' '}{busy ? (progress > 0 ? tr('Reading… {n}%', { n: Math.round(progress * 100) }) : tr('Reading…')) : tr('Scan a paper log')}
        </button>
        <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
      </div>
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {rows && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{rows.length === 0 ? tr('No entries found in that photo.') : tr('Found {n} entries. Check them, then add.', { n: rows.length })}</p>
            <button type="button" className="p-1 text-earth-400 hover:text-earth-600" onClick={() => setRows(null)} aria-label={tr('Close')}><X className="w-4 h-4" /></button>
          </div>
          {note && <p className="text-xs text-amber-600 dark:text-amber-400">{note}</p>}
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.key} className={`rounded-xl border p-3 grid grid-cols-[auto,1fr] gap-x-3 gap-y-2 ${r.keep ? 'border-brand-500/40' : 'border-earth-200 dark:border-earth-700 opacity-70'}`}>
                <input type="checkbox" className="mt-2 w-4 h-4" checked={r.keep} onChange={(e) => update(r.key, 'keep', e.target.checked)} aria-label={tr('Add this entry')} />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <input type="date" className="input min-w-0" value={r.date} onChange={(e) => update(r.key, 'date', e.target.value)} aria-label={tr('Date')} />
                  <input type="number" min="0.25" max="24" step="0.25" className="input min-w-0" value={r.hours || ''} placeholder={tr('Hours')} onChange={(e) => update(r.key, 'hours', e.target.value)} aria-label={tr('Hours')} />
                  <input className="input min-w-0 col-span-2" value={r.activity} placeholder={tr('Activity')} onChange={(e) => update(r.key, 'activity', e.target.value)} aria-label={tr('Activity')} />
                  <input className="input min-w-0 col-span-2" value={r.orgName} placeholder={tr('Organization')} onChange={(e) => update(r.key, 'orgName', e.target.value)} aria-label={tr('Organization')} />
                  <input className="input min-w-0 col-span-2" value={r.supervisorName} placeholder={tr('Supervisor')} onChange={(e) => update(r.key, 'supervisorName', e.target.value)} aria-label={tr('Supervisor')} />
                </div>
              </li>
            ))}
          </ul>
          {rows.length > 0 && (
            <button type="button" className="btn-primary w-full" onClick={addAll} disabled={ready.length === 0}>
              {tr('Add {n} entries', { n: ready.length })}
            </button>
          )}
          <p className="text-xs text-earth-400">{tr('Entries need a date, an activity and hours. The photo isn’t kept.')}{!serverScan && ` ${tr('Read on your phone: printed sheets work best; check handwritten ones closely.')}`}</p>
        </div>
      )}
    </Card>
  )
}
