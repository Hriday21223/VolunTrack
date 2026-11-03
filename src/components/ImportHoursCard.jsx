import { useState } from 'react'
import { FileUp } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { readHoursFile } from '@/lib/importHours.js'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

// Students → Import past hours (#657): a CSV from another tracker. Shows a
// check of every row first; nothing is saved until Import is pressed.
export default function ImportHoursCard({ onDone }) {
  const [rows, setRows] = useState(null)
  const [fileName, setFileName] = useState('')
  const [check, setCheck] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const send = async (dryRun, list = rows) => {
    const res = await fetch(`${apiUrl}/school/import-hours`, { method: 'POST', headers: headers(), body: JSON.stringify({ rows: list, dryRun }) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || tr('Could not import the hours.'))
    return body
  }

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(''); setDone(''); setCheck(null); setRows(null); setFileName(file.name)
    const { rows: read, missing } = readHoursFile(await file.text())
    if (missing.length) { setError(tr('This file needs columns for: {cols}.', { cols: missing.join(', ') })); return }
    setRows(read)
    setBusy(true)
    try { setCheck(await send(true, read)) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const importNow = async () => {
    setBusy(true); setError('')
    try {
      const r = await send(false)
      setDone(tr('Imported {n} entries.', { n: r.added }))
      setRows(null); setCheck(null)
      onDone?.()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <Card className="mb-4">
      <div className="flex items-center gap-2 mb-1">
        <FileUp className="w-5 h-5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
        <h3 className="font-semibold">{tr('Import past hours')}</h3>
      </div>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">
        {tr('Switching from x2VOL, MobileServe or a spreadsheet? Upload a CSV with student email, date, activity and hours (organization, category and notes are optional). Hours come in approved, for students already at your school.')}
      </p>
      <label className="btn-secondary inline-flex items-center gap-1.5 cursor-pointer">
        <FileUp className="w-4 h-4" aria-hidden="true" />{busy ? tr('Checking…') : tr('Choose a CSV file')}
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={pick} disabled={busy} />
      </label>
      {fileName && <span className="ml-2 text-sm text-earth-500">{fileName}</span>}

      {check && (
        <div className="mt-4 text-sm space-y-2">
          <p>
            <strong>{tr('{n} ready to import', { n: check.counts.ok })}</strong>
            {check.counts.duplicate > 0 && <> · {tr('{n} already there', { n: check.counts.duplicate })}</>}
            {check.counts.error > 0 && <> · <span className="text-red-600 dark:text-red-400">{tr('{n} with problems', { n: check.counts.error })}</span></>}
          </p>
          {check.problems.length > 0 && (
            <ul className="max-h-48 overflow-auto rounded-lg border border-earth-200 dark:border-white/10 divide-y divide-earth-100 dark:divide-white/5">
              {check.problems.map((p) => (
                <li key={p.row} className="px-3 py-1.5">
                  {tr('Row {n}', { n: p.row })}{p.email ? ` · ${p.email}` : ''}: <span className={p.status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-earth-500'}>{tr(p.error)}</span>
                </li>
              ))}
            </ul>
          )}
          {check.counts.ok > 0 && (
            <button type="button" className="btn-primary" onClick={importNow} disabled={busy}>
              {busy ? tr('Importing…') : tr('Import {n} entries', { n: check.counts.ok })}
            </button>
          )}
        </div>
      )}
      {done && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{done}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </Card>
  )
}
