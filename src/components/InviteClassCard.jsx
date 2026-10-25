import { useRef, useState } from 'react'
import { Users, Upload } from 'lucide-react'
import Card from '@/components/Card.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

// Students tab → Invite a whole class (#532): paste a list of emails or pick
// a CSV (any columns — every email address in it is used).
export default function InviteClassCard({ onDone }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const file = useRef(null)
  const emails = [...new Set((text.match(EMAIL_RE) || []).map((e) => e.toLowerCase()))]

  const onFile = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const content = await f.text()
    setText((t) => [t, (content.match(EMAIL_RE) || []).join('\n')].filter(Boolean).join('\n'))
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
        body: JSON.stringify({ emails }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not send the invites.')
      setResult(data)
      setText('')
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
  ].filter(Boolean)

  return (
    <Card>
      <h3 className="font-semibold mb-1 flex items-center gap-2"><Users className="w-4 h-4 text-brand-600" /> Invite a whole class</h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">Paste your students&apos; emails, or pick a CSV file from your roster. Students with an account accept in their Settings; everyone else gets an email with your join link. Up to 200 at a time.</p>
      <textarea
        className="input min-h-[120px] font-mono text-sm"
        placeholder={'maya@school.edu\njordan@school.edu, sam@school.edu'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button type="button" className="btn-primary" onClick={send} disabled={busy || emails.length === 0 || emails.length > 200}>
          {busy ? 'Sending…' : emails.length ? `Invite ${emails.length} student${emails.length === 1 ? '' : 's'}` : 'Invite'}
        </button>
        <button type="button" className="btn-ghost" onClick={() => file.current?.click()}>
          <Upload className="w-4 h-4" /> Pick a CSV file
        </button>
        <input ref={file} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={onFile} />
        {emails.length > 200 && <span className="text-sm text-red-500">That's {emails.length}; send up to 200 at a time.</span>}
      </div>
      {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
      {lines && (
        <ul className="mt-3 text-sm space-y-1">
          {lines.map((l) => <li key={l}>• {l}</li>)}
        </ul>
      )}
    </Card>
  )
}
