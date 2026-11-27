import { useEffect, useRef, useState } from 'react'
import { Camera, Loader2, X, Printer } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { ACTIVITY_CATEGORIES } from '@/lib/categories.js'
import { tr } from '@/lib/i18n.js'
import { useAuth } from '@/hooks/useAuth.jsx'
import { isTouchDevice } from '@/lib/platform.js'
import { readOnDevice } from '@/lib/paperLogOcr.js'
import { parsePaperLog } from '@/lib/paperLogParse.js'
import { useMyRequirements, validateLogAgainstPolicy, isOwnEmail, OWN_EMAIL_AS_SUPERVISOR } from '@/lib/requirements.js'
import { paperLogColumns, paperLogLaterItems, paperLogExtraFields } from '@/lib/paperLogForm.js'

const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

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
// onAdd(entry): save it as is. onFinish(entry): fill the Log Hours form with
// it, for an entry the school needs more on than a paper log can carry.
export default function ScanPaperLog({ onAdd, onFinish }) {
  const { user } = useAuth()
  const { policy } = useMyRequirements()
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

  const onFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    readPhoto(file)
  }

  // Dropping a photo on the card does the same as picking one.
  const [dragging, setDragging] = useState(false)
  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    if (busy) return
    const file = e.dataTransfer.files?.[0]
    readPhoto(file)
  }

  // A photo (PNG or JPG) or a PDF, whether picked or dropped.
  const PHOTO_TYPES = ['image/png', 'image/jpeg']
  const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')

  // One image (a photo, or a scanned PDF page): on this device, or on our
  // server when it's set up for scans (better with handwriting).
  const readImage = async (file, onProgress) => {
    if (!serverScan || !token) return { entries: await readOnDevice(file, onProgress), note: '' }
    const image = await photoToDataUrl(file)
    const res = await fetch(`${apiUrl}/logs/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ image }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || tr("Couldn't read that photo. Please try again."))
    return { entries: data.entries || [], note: data.note || '' }
  }

  const readPhoto = async (file) => {
    if (!file) return
    const pdf = isPdf(file)
    if (!pdf && !PHOTO_TYPES.includes(file.type)) {
      setError(tr('Use a PNG, JPG or PDF of your paper log.'))
      return
    }
    setError('')
    setBusy(true)
    setProgress(0)
    try {
      let entries = []
      const notes = []
      if (pdf) {
        // Typed pages are read straight from the PDF's text; scanned pages
        // go through the same reader as a photo.
        const { readPdfPages, MAX_PAGES } = await import('@/lib/paperLogPdf.js')
        const { pages, total } = await readPdfPages(file)
        for (const [i, page] of pages.entries()) {
          if (page.text) {
            entries.push(...parsePaperLog(page.text))
          } else {
            const r = await readImage(page.image, (p) => setProgress((i + p) / pages.length))
            entries.push(...r.entries)
            if (r.note) notes.push(r.note)
          }
          setProgress((i + 1) / pages.length)
        }
        if (total > MAX_PAGES) notes.push(tr('Read the first {n} pages of {total}.', { n: MAX_PAGES, total }))
      } else {
        const r = await readImage(file, setProgress)
        entries = r.entries
        if (r.note) notes.push(r.note)
      }
      setRows(entries.map((r, i) => ({
        location: '', supervisorEmail: '', category: '', description: '', startTime: '', endTime: '', ...r, customFields: {},
        key: i, keep: Boolean(r.date && r.activity && r.hours > 0),
      })))
      setNote([...new Set(notes)].join(' '))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const update = (key, field, value) => setRows((rs) => rs.map((r) => {
    if (r.key !== key) return r
    if (field.startsWith('custom:')) return { ...r, customFields: { ...r.customFields, [field.slice(7)]: value } }
    return { ...r, [field]: value }
  }))
  // The school's other columns (category, location, supervisor email,
  // description, its own questions) get a box on every row, so what's on the
  // paper can be typed in here instead of in the form, one row at a time.
  const extras = paperLogExtraFields(policy)
  const allowedCats = policy?.logRules?.allowedCategories || []
  const pickCategory = (raw) => {
    const want = String(raw || '').trim().toLowerCase()
    const hit = (allowedCats.length ? allowedCats : ACTIVITY_CATEGORIES).find((c) => c.toLowerCase() === want)
    return hit || (allowedCats.length ? '' : ACTIVITY_CATEGORIES[0])
  }
  const extraValue = (r, f) => {
    if (f.key === 'category') return pickCategory(r.category)
    if (f.custom) return r.customFields?.[f.key.slice(7)] ?? (f.type === 'checkbox' ? false : '')
    return r[f.key] || ''
  }
  // What only the form can do (proof, signatures, the school's online form…).
  const BOX_FIELDS = new Set(['date', 'hours', 'activity', 'orgName', 'supervisorName', 'notes', ...extras.map((f) => f.key)])
  // What each row becomes, and what the school still needs on it, checked
  // with the same rules the server applies (validateLogAgainstPolicy), so an
  // entry that would be refused when it syncs is finished in the form instead.
  const entryFor = (r) => {
    const description = (r.description || '').trim()
    const marker = tr('Added from a photo of a paper log.')
    return {
      date: r.date,
      activity: r.activity.trim(),
      hours: Number(r.hours),
      category: pickCategory(r.category),
      orgName: r.orgName || '',
      supervisorName: r.supervisorName || '',
      location: (r.location || '').trim(),
      supervisorEmail: (r.supervisorEmail || '').trim(),
      customFields: r.customFields || {},
      // Times come with VolunTrack's own service record (parseServiceRecord).
      startTime: r.startTime || '',
      endTime: r.endTime || '',
      notes: description ? `${description}\n\n${marker}` : marker,
    }
  }
  // The description rule is checked on what the student wrote, not on our note.
  const missingFor = (r) => {
    const out = validateLogAgainstPolicy(policy, { ...entryFor(r), notes: (r.description || '').trim(), hasProof: false, hasStudentSignature: false })
    // Never their own email as the supervisor: the server refuses it.
    if (isOwnEmail(r.supervisorEmail, user?.email)) out.push({ field: 'supervisorEmail', message: OWN_EMAIL_AS_SUPERVISOR })
    return out
  }
  const formOnly = (r) => missingFor(r).some((m) => !BOX_FIELDS.has(m.field))
  const filled = (r) => r.keep && r.date && r.activity.trim() && Number(r.hours) > 0
  const ready = (rows || []).filter((r) => filled(r) && missingFor(r).length === 0)
  const needsMore = (rows || []).filter((r) => filled(r) && missingFor(r).length > 0)

  const finish = (r) => {
    onFinish?.(entryFor(r))
    setRows((rs) => {
      const left = rs.filter((x) => x.key !== r.key)
      return left.length ? left : null
    })
  }

  const addAll = () => {
    for (const r of ready) {
      onAdd(entryFor(r))
    }
    // Keep the ones still waiting to be finished in the form.
    const added = new Set(ready.map((r) => r.key))
    setRows((rs) => {
      const left = rs.filter((r) => !added.has(r.key) && filled(r))
      return left.length ? left : null
    })
  }

  // A blank log to print and fill in by hand, laid out for this reader.
  const printBlank = async () => {
    const { blankPaperLogPDF } = await import('@/lib/export.js')
    await blankPaperLogPDF({
      name: user?.name || '',
      school: user?.schoolName || user?.school || '',
      columns: paperLogColumns(policy),
      later: paperLogLaterItems(policy),
    })
  }

  return (
    <Card
      className={dragging ? 'ring-2 ring-brand-500 ring-offset-2 ring-offset-transparent' : ''}
      onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true) }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }}
      onDrop={onDrop}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-display font-semibold flex items-center gap-2"><Camera className="w-4 h-4 text-brand-600" />{' '}{tr('Have a paper log?')}</h3>
          <p className="text-sm text-earth-500 dark:text-earth-400 mt-0.5">{tr('Take a photo or add a PDF and we’ll fill in the entries. You check every one before it’s saved.')}</p>
          <button type="button" onClick={printBlank} className="mt-1 text-sm text-brand-600 dark:text-brand-400 hover:underline inline-flex items-center gap-1">
            <Printer className="w-3.5 h-3.5" aria-hidden="true" />{' '}{tr('Need one? Get a blank log to print')}
          </button>
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}{' '}{busy ? (progress > 0 ? tr('Reading… {n}%', { n: Math.round(progress * 100) }) : tr('Reading…')) : tr('Scan a paper log')}
        </button>
        <input ref={input} type="file" accept="image/png,image/jpeg,application/pdf,.pdf" className="hidden" onChange={onFile} />
      </div>
      {!rows && !busy && !isTouchDevice && (
        <p className="mt-3 rounded-xl border-2 border-dashed border-earth-200 dark:border-[#24382c] px-4 py-3 text-center text-sm text-earth-500 dark:text-earth-400">
          {dragging ? tr('Drop it here') : tr('Or drag a photo or PDF of your log here (PNG, JPG or PDF)')}
        </p>
      )}
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
                  <input type="date" className="input min-w-0" max={localToday()} value={r.date} onChange={(e) => update(r.key, 'date', e.target.value)} aria-label={tr('Date')} />
                  <input type="number" min="0.25" max="24" step="0.25" className="input min-w-0" value={r.hours || ''} placeholder={tr('Hours')} onChange={(e) => update(r.key, 'hours', e.target.value)} aria-label={tr('Hours')} />
                  <input className="input min-w-0 col-span-2" value={r.activity} placeholder={tr('Activity')} onChange={(e) => update(r.key, 'activity', e.target.value)} aria-label={tr('Activity')} />
                  <input className="input min-w-0 col-span-2" value={r.orgName} placeholder={tr('Organization')} onChange={(e) => update(r.key, 'orgName', e.target.value)} aria-label={tr('Organization')} />
                  <input className="input min-w-0 col-span-2" value={r.supervisorName} placeholder={tr('Supervisor')} onChange={(e) => update(r.key, 'supervisorName', e.target.value)} aria-label={tr('Supervisor')} />
                  {extras.map((f) => <ExtraField key={f.key} field={f} value={extraValue(r, f)} onChange={(v) => update(r.key, f.key, v)} />)}
                </div>
                {filled(r) && missingFor(r).length > 0 && (
                  <div className="col-start-2 flex flex-wrap items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
                    <span>{tr('Your school needs more on this one: {what}', { what: missingFor(r).map((m) => tr(m.message)).join(' ') })}</span>
                    {onFinish && formOnly(r) && (
                      <button type="button" className="btn-secondary btn-sm" onClick={() => finish(r)}>{tr('Finish in the form')}</button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {rows.length > 0 && (
            <button type="button" className="btn-primary w-full" onClick={addAll} disabled={ready.length === 0}>
              {tr('Add {n} entries', { n: ready.length })}
            </button>
          )}
          {needsMore.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {needsMore.some(formOnly)
                ? tr('{n} need more for your school. Fill in the boxes, or use Finish in the form.', { n: needsMore.length })
                : tr('{n} need more for your school. Fill in the boxes on each one.', { n: needsMore.length })}
            </p>
          )}
          <p className="text-xs text-earth-400">{tr('Entries need a date, an activity and hours. The photo isn’t kept.')}{!serverScan && ` ${tr('Read on your phone: printed sheets work best; check handwritten ones closely.')}`}</p>
        </div>
      )}
    </Card>
  )
}

// One box for a school column on a scanned row. Built-in labels are
// translated; a school's own question shows as the school wrote it.
function ExtraField({ field, value, onChange }) {
  const label = field.custom ? field.label : tr(field.label)
  const shown = field.required ? `${label} *` : label
  const cls = 'input min-w-0 col-span-2'
  if (field.type === 'checkbox') {
    return (
      <label className="col-span-2 flex items-center gap-2 text-sm">
        <input type="checkbox" className="w-4 h-4" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        {shown}
      </label>
    )
  }
  if (field.type === 'select') {
    return (
      <select className={cls} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">{shown}</option>
        {field.options.map((o) => <option key={o} value={o}>{field.custom ? o : tr(o)}</option>)}
      </select>
    )
  }
  const type = field.type === 'number' || field.type === 'date' || field.type === 'email' ? field.type : 'text'
  return <input type={type} className={cls} value={value} placeholder={shown} onChange={(e) => onChange(e.target.value)} aria-label={label} />
}
