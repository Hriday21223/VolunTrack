import { useState } from 'react'
import { Archive, Download } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { buildYearEndPacket, schoolYears } from '@/lib/yearEndPacket.js'
import { tr } from '@/lib/i18n.js'

// One download for the end of the school year (#640): reports, every entry,
// approvals, certificates and each student's own report, in a ZIP.
export default function YearEndPacketCard({ kind = 'school' }) {
  const years = schoolYears()
  const [yearIndex, setYearIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState('')

  const build = async () => {
    setBusy(true)
    setError('')
    setProgress(null)
    try {
      const { blob, filename } = await buildYearEndPacket({
        kind,
        year: years[yearIndex],
        onStep: (done, total) => setProgress({ done, total }),
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (e) {
      setError(e.message || tr('Could not make the packet.'))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <Card>
      <div className="flex items-center gap-2 mb-1">
        <Archive className="w-5 h-5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
        <h3 className="font-semibold">{tr('End-of-year packet')}</h3>
      </div>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
        {kind === 'organization'
          ? tr('One ZIP with a folder for each school: summary, every entry, and each student’s hours report.')
          : tr('One ZIP with the summary, every entry, the approval history, certificates for students who met the requirement, and each student’s hours report.')}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block mb-1 text-earth-600 dark:text-earth-300">{tr('School year')}</span>
          <select className="input" value={yearIndex} onChange={(e) => setYearIndex(Number(e.target.value))} disabled={busy}>
            {years.map((y, i) => <option key={y.label} value={i}>{y.label}</option>)}
          </select>
        </label>
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={build} disabled={busy}>
          <Download className="w-4 h-4" aria-hidden="true" />
          {busy
            ? (progress ? tr('Making student reports… {done} of {total}', progress) : tr('Making the packet…'))
            : tr('Download packet')}
        </button>
      </div>
      <p className="text-xs text-earth-500 dark:text-earth-400 mt-3">{tr('School year runs August 1 to July 31. The ZIP has students’ personal information, so keep it somewhere safe.')}</p>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 mt-3">{error}</p>}
    </Card>
  )
}
