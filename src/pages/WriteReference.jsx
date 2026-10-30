import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Loader2, Clock } from 'lucide-react'
import Card from '@/components/Card.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const TEXT_MIN = 40
const TEXT_MAX = 3000

const CLOSED = {
  written: 'This reference was already written. Thank you!',
  declined: 'You already answered this request.',
  expired: 'This link has expired. The student can send you a new one.',
}

const fmt = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

// /reference/:token (#593): someone a student asked writes them a reference,
// or declines. No sign-in; the one-time link is the key.
export default function WriteReference() {
  const { token } = useParams()
  const [req, setReq] = useState({ loading: true, data: null, error: '' })
  const [form, setForm] = useState({ text: '', writerName: '', writerTitle: '', relationship: '', confirm: false, shareable: false })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetch(`${apiUrl}/references/write/${encodeURIComponent(token)}`)
      .then(async (res) => {
        const d = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(d.error || 'This link is not valid.')
        if (!alive) return
        setReq({ loading: false, data: d, error: '' })
        setForm((f) => ({ ...f, writerName: f.writerName || d.writerName || '' }))
      })
      .catch((e) => alive && setReq({ loading: false, data: null, error: e.message }))
    return () => { alive = false }
  }, [token])

  const submit = async (decline) => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/references/write/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(decline ? { decline: true } : form),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not save that.')
      setDone(decline ? 'declined' : 'written')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const d = req.data
  const first = String(d?.studentName || 'the student').split(/\s+/)[0]
  const length = form.text.trim().length

  return (
    <div className="min-h-screen px-4 py-8 page-shell text-earth-900 dark:text-earth-100">
      <div className="w-full max-w-xl mx-auto">
        <Link to="/" className="flex items-center gap-2.5 justify-center mb-6">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="" className="w-10 h-10 object-contain" />
          <span className="font-display font-bold text-2xl">VolunTrack</span>
        </Link>
        <Card padded={false} className="p-6">
          {req.loading ? (
            <p className="text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></p>
          ) : req.error || d.closed ? (
            <div className="text-center">
              <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
              <p className="text-sm text-earth-500 dark:text-earth-400">{req.error || CLOSED[d.closed]}</p>
            </div>
          ) : done ? (
            <div className="text-center">
              <CheckCircle2 className="w-10 h-10 text-brand-500 mx-auto mb-3" />
              <p className="font-semibold">{done === 'written' ? 'Thank you!' : 'Got it'}</p>
              <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">
                {done === 'written' ? `We've let ${first} know. Your words can make a real difference to their application.` : `We've let ${first} know, so they can ask someone else.`}
              </p>
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); submit(false) }} className="space-y-4">
              <div>
                <h1 className="font-display font-semibold text-xl">A reference for {d.studentName}</h1>
                <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">
                  {first} asked you to write a few lines about their volunteering{d.organization ? ` with ${d.organization}` : ''}, for things like college and scholarship applications.
                </p>
              </div>
              {d.message && (
                <blockquote className="border-l-4 border-brand-500 pl-3 text-sm text-earth-600 dark:text-earth-300 whitespace-pre-line">{d.message}</blockquote>
              )}
              {d.hours && (
                <p className="flex items-start gap-2 rounded-xl bg-brand-500/10 px-3 py-2 text-sm">
                  <Clock className="w-4 h-4 mt-0.5 text-brand-500 shrink-0" />
                  <span>{first} logged <strong>{d.hours.total} hours</strong> at {d.organization} in {d.hours.entries} {d.hours.entries === 1 ? 'entry' : 'entries'}{d.hours.from !== d.hours.to ? `, ${fmt(d.hours.from)} to ${fmt(d.hours.to)}` : `, on ${fmt(d.hours.from)}`}.</span>
                </p>
              )}
              <label className="block text-sm">
                <span className="font-medium">Your reference</span>
                <textarea
                  className="input mt-1 min-h-[180px]"
                  maxLength={TEXT_MAX}
                  required
                  placeholder={`What did ${first} do? What stood out about how they worked with people, showed up, or took responsibility?`}
                  value={form.text}
                  onChange={(e) => setForm({ ...form, text: e.target.value })}
                />
                <span className={`block text-xs mt-1 ${length > 0 && length < TEXT_MIN ? 'text-amber-600' : 'text-earth-500'}`}>
                  {length < TEXT_MIN ? `At least ${TEXT_MIN} characters (${length} so far)` : `${length} / ${TEXT_MAX}`}
                </span>
              </label>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block text-sm"><span className="font-medium">Your name</span>
                  <input className="input mt-1" required maxLength={120} value={form.writerName} onChange={(e) => setForm({ ...form, writerName: e.target.value })} />
                </label>
                <label className="block text-sm"><span className="font-medium">Your role or title</span> <span className="text-earth-500">(optional)</span>
                  <input className="input mt-1" maxLength={120} placeholder="e.g. Volunteer coordinator" value={form.writerTitle} onChange={(e) => setForm({ ...form, writerTitle: e.target.value })} />
                </label>
              </div>
              <label className="block text-sm"><span className="font-medium">How you know {first}</span> <span className="text-earth-500">(optional)</span>
                <input className="input mt-1" maxLength={120} placeholder={`e.g. I supervised ${first} at Saturday food drives`} value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} />
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.checked })} required />
                <span>I saw {first} volunteer, and this reference is my own honest account.</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={form.shareable} onChange={(e) => setForm({ ...form, shareable: e.target.checked })} />
                <span>{first} may show this reference, with my name and title, on their public volunteer portfolio page. <span className="text-earth-500">Leave unticked to let only {first} read it.</span></span>
              </label>
              {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
              <button type="submit" className="btn-primary w-full" disabled={busy || length < TEXT_MIN || !form.confirm}>{busy ? 'Sending…' : 'Send reference'}</button>
              <button type="button" className="btn-ghost w-full text-sm" disabled={busy} onClick={() => submit(true)}>I can&apos;t write one right now</button>
              <p className="text-xs text-earth-500 dark:text-earth-400">Only {first} sees your answer, plus anyone they share their portfolio with if you tick the box above. Your email address is never shown.</p>
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}
