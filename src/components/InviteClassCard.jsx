import { useRef, useState } from 'react'
import { Users, Upload } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { readRoster, mergeRoster } from '@/lib/rosterCsv.js'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const PREVIEW_ROWS = 5

// Students tab → Invite a whole class (#532): paste a list of emails or pick
// a CSV. A CSV with a header row also gives names and grades (#584): the
// invite greets each student by name, and the grade is set when they join.
export default function InviteClassCard({ onDone }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [fromFile, setFromFile] = useState({ students: [], columns: null, name: '' })
  const file = useRef(null)
  const students = mergeRoster(fromFile.students, text)
  const emails = students.map((st) => st.email)
  const withGrade = students.filter((st) => st.grade).length
  const withName = students.filter((st) => st.name).length

  const onFile = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const roster = readRoster(await f.text())
    // A second file adds to the first; the same address keeps the newer row.
    setFromFile((prev) => ({
      students: [...new Map([...prev.students, ...roster.students].map((st) => [st.email, st])).values()],
      columns: roster.columns || prev.columns,
      name: f.name,
    }))
  }

  const send = async () => {
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/invite-class`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ emails, students: students.filter((st) => st.name || st.grade) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not send the invites.')
      setResult(data)
      setText('')
      setFromFile({ students: [], columns: null, name: '' })
      onDone?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const lines = result && [
    result.emailed && `${result.emailed} emailed a join link`,
    result.invited && `${result.invited} with an account got an invite to accept`,
    result.alreadyHere && `${result.alreadyHere} already in your school`,
    result.atAnotherSchool && `${result.atAnotherSchool} already at another school (they can transfer with your code)`,
    result.recentlyEmailed && `${result.recentlyEmailed} skipped (emailed in the last week, or today's limit reached)`,
    result.notStudent && `${result.notStudent} not student accounts`,
    result.invalid && `${result.invalid} didn't look like email addresses`,
    result.gradesSaved && `${result.gradesSaved} grade${result.gradesSaved === 1 ? '' : 's'} saved: each is set when that student joins`,
    result.unknownGrades && `${result.unknownGrades} grade${result.unknownGrades === 1 ? '' : 's'} not used (not one of your school's grades)`,
  ].filter(Boolean)

  return (
    <Card>
      <h3 className="font-semibold mb-1 flex items-center gap-2"><Users className="w-4 h-4 text-brand-600" />{' '}{tr('Invite a whole class')}</h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">{tr('Paste your students\' emails, or pick a CSV file from your roster. Students with an account accept in their Settings; everyone else gets an email with your join link. Up to 200 at a time.')}</p>
      <p className="text-xs text-earth-500 dark:text-earth-400 mb-3">{tr('A CSV with a header row can include Name (or First and Last name) and Grade columns. Each student’s grade is then set for them when they join.')}</p>
      <textarea
        className="input min-h-[120px] font-mono text-sm"
        placeholder={'maya@school.edu\njordan@school.edu, sam@school.edu'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button type="button" className="btn-primary" onClick={send} disabled={busy || emails.length === 0 || emails.length > 200}>
          {busy ? tr('Sending…') : emails.length ? `Invite ${emails.length} student${emails.length === 1 ? '' : 's'}` : tr('Invite')}
        </button>
        <button type="button" className="btn-ghost" onClick={() => file.current?.click()}>
          <Upload className="w-4 h-4" />{' '}{tr('Pick a CSV file')}
        </button>
        <input ref={file} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={onFile} />
        {emails.length > 200 && <span className="text-sm text-red-500">{tr('That’s {n}; send up to 200 at a time.', { n: emails.length })}</span>}
      </div>
      {fromFile.students.length > 0 && (
        <div className="mt-3 rounded-xl border border-earth-200 dark:border-white/10 p-3 text-sm">
          <div className="flex items-start justify-between gap-2 mb-2">
            <span className="min-w-0 break-words">
              <span className="font-medium">{fromFile.name}</span>
              <span className="block text-xs text-earth-500 dark:text-earth-400">{fromFile.students.length} student{fromFile.students.length === 1 ? '' : 's'}{fromFile.columns ? ` · ${withName} with names · ${withGrade} with grades` : ''}</span>
            </span>
            <button type="button" className="btn-ghost text-xs" onClick={() => setFromFile({ students: [], columns: null, name: '' })}>{tr('Remove')}</button>
          </div>
          {!fromFile.columns && <p className="text-xs text-earth-500 dark:text-earth-400 mb-2">{tr('No header row found, so only the email addresses were read.')}</p>}
          {fromFile.columns && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-earth-500 dark:text-earth-400"><th className="pr-3 font-medium">{tr('Email')}</th><th className="pr-3 font-medium">{tr('Name')}</th><th className="font-medium">{tr('Grade')}</th></tr></thead>
                <tbody>
                  {fromFile.students.slice(0, PREVIEW_ROWS).map((st) => (
                    <tr key={st.email}><td className="pr-3 py-0.5 break-all">{st.email}</td><td className="pr-3">{st.name || '—'}</td><td>{st.grade || '—'}</td></tr>
                  ))}
                </tbody>
              </table>
              {fromFile.students.length > PREVIEW_ROWS && <p className="text-xs text-earth-500 dark:text-earth-400 mt-1">and {fromFile.students.length - PREVIEW_ROWS} more</p>}
            </div>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
      {lines && (
        <ul className="mt-3 text-sm space-y-1">
          {lines.map((l) => <li key={l}>• {l}</li>)}
        </ul>
      )}
    </Card>
  )
}
