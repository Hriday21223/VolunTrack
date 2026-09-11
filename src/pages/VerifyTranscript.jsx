import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, XCircle, Upload, AlertTriangle, Loader2 } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { readTranscriptFile, verifyTranscript } from '@/lib/transcript.js'
import { fmtDate, fmtHours } from '@/utils/date.js'

// Public checker for a signed transcript (#143). Built for a receiving school
// or an admissions office with no VolunTrack account: drop the .json file the
// student gave you and see whether it is genuine and unaltered.

const STATUS_LABEL = { approved: 'Approved', rejected: 'Rejected' }
const ROLE_LABEL = {
  supervisor: 'supervisor',
  school: 'school',
  school_staff: 'school staff',
  org: 'organization',
  admin: 'VolunTrack',
}

export default function VerifyTranscript() {
  const [state, setState] = useState({ status: 'idle' })
  const [dragging, setDragging] = useState(false)

  const check = async (file) => {
    if (!file) return
    setState({ status: 'checking' })
    try {
      const doc = await readTranscriptFile(file)
      const result = await verifyTranscript(doc)
      setState({ status: 'done', result, doc, fileName: file.name })
    } catch (e) {
      setState({ status: 'error', message: e.message })
    }
  }

  return (
    <div className="min-h-screen px-4 py-8 page-shell text-earth-900 dark:text-earth-100">
      <div className="w-full max-w-3xl mx-auto">
        <Link to="/" className="flex items-center gap-2.5 justify-center mb-6">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="VolunTrack" className="w-10 h-10 object-contain" />
          <span className="font-display font-bold text-2xl">VolunTrack</span>
        </Link>

        <Card padded={false} className="p-7">
          <h1 className="text-xl font-bold">Verify a volunteer transcript</h1>
          <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">
            Check that a VolunTrack transcript is genuine and has not been changed since it was issued. No account
            needed. The file is checked by our server and not stored.
          </p>

          <label
            className={`mt-5 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center cursor-pointer transition-colors ${
              dragging ? 'border-brand-500 bg-brand-500/5' : 'border-earth-200 dark:border-[#1f2e25]'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); check(e.dataTransfer.files?.[0]) }}
          >
            {state.status === 'checking'
              ? <Loader2 className="w-6 h-6 text-brand-600 animate-spin" />
              : <Upload className="w-6 h-6 text-brand-600" />}
            <span className="text-sm font-medium">
              {state.status === 'checking' ? 'Checking…' : 'Drop a transcript .json file here, or click to choose one'}
            </span>
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => { check(e.target.files?.[0]); e.target.value = '' }}
            />
          </label>

          {state.status === 'error' && (
            <div className="mt-5 flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {state.message}
            </div>
          )}

          {state.status === 'done' && <Result {...state} />}
        </Card>
      </div>
    </div>
  )
}

function Result({ result, doc, fileName }) {
  if (!result.valid) {
    return (
      <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/5 p-5">
        <div className="flex items-center gap-2 font-semibold text-red-700 dark:text-red-300">
          <XCircle className="w-5 h-5" /> Not verified
        </div>
        <p className="text-sm mt-1">{result.message}</p>
        <p className="text-xs text-earth-500 dark:text-earth-400 mt-2">{fileName}</p>
      </div>
    )
  }

  // Only a verified document's contents are shown: rendering an invalid one
  // would put forged data on a VolunTrack-branded page.
  const { summary } = result
  const logs = Array.isArray(doc.logs) ? doc.logs : []
  return (
    <div className="mt-6 space-y-5">
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
        <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="w-5 h-5" /> Genuine and unaltered
        </div>
        <p className="text-sm mt-1">
          Issued by VolunTrack for <strong>{summary.studentName}</strong>
          {summary.issuer?.school ? <> at <strong>{summary.issuer.school}</strong></> : null} on{' '}
          {/* issued_at is a UTC timestamp; show the viewer's local day. */}
          {new Date(summary.issuedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}.
        </p>
        {result.keyStatus === 'retired' && (
          <p className="text-xs text-earth-500 dark:text-earth-400 mt-2">
            Signed with a signing key that has since been rotated. It is still valid.
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <Stat label="Total hours" value={fmtHours(Number(summary.totals?.hours) || 0)} />
        <Stat label="Approved hours" value={fmtHours(Number(summary.totals?.approved_hours) || 0)} />
        <Stat label="Entries" value={summary.totals?.entries ?? logs.length} />
      </div>

      {logs.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-earth-100 dark:border-[#1f2e25]">
          <table className="w-full text-sm">
            <thead className="bg-earth-50 dark:bg-[#0f1a14] text-earth-500 dark:text-earth-400">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Activity</th>
                <th className="text-left px-3 py-2">Verification</th>
                <th className="text-left px-3 py-2">Proof</th>
                <th className="text-right px-3 py-2">Hours</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t border-earth-100 dark:border-[#1f2e25] align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(l.date)}</td>
                  <td className="px-3 py-2">
                    {l.activity || '—'}
                    {l.organization && <div className="text-xs text-earth-500 dark:text-earth-400">{l.organization}</div>}
                    {l.imported_from?.issuer?.school && (
                      <div className="text-xs text-earth-500 dark:text-earth-400">From {l.imported_from.issuer.school}</div>
                    )}
                  </td>
                  <td className="px-3 py-2"><VerificationCell v={l.verification} /></td>
                  <td className="px-3 py-2 text-xs">
                    {l.proof?.present ? `On file${l.proof.retained_by ? ` with ${l.proof.retained_by}` : ''}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">{fmtHours(Number(l.hours) || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-earth-500 dark:text-earth-400">
        Transcript {summary.transcriptId}. Rejected hours are listed but not counted in the total.
      </p>
    </div>
  )
}

function VerificationCell({ v }) {
  const label = STATUS_LABEL[v?.status]
  if (!label) return <span className="text-earth-500 dark:text-earth-400">Not verified</span>
  const by = [ROLE_LABEL[v.verified_by_role], v.supervisor_name && v.verified_by_role === 'supervisor' ? v.supervisor_name : null]
    .filter(Boolean)
    .join(' ')
  return (
    <span className={v.status === 'approved' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}>
      {label}
      {by && <span className="block text-xs text-earth-500 dark:text-earth-400">by {by}</span>}
    </span>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-earth-100 dark:border-[#1f2e25] p-3">
      <div className="text-xs text-earth-500 dark:text-earth-400">{label}</div>
      <div className="text-lg font-bold mt-0.5">{value}</div>
    </div>
  )
}
