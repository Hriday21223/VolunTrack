import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Loader2, FileSignature } from 'lucide-react'
import Card from '@/components/Card.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const fmt = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '')

// /waiver/:token (#595): the parent or guardian of a volunteer under 18 reads
// an event's waiver and agrees with their typed name. No sign-in; the
// one-time link is the key.
export default function ParentWaiver() {
  const { token } = useParams()
  const [req, setReq] = useState({ loading: true, data: null, error: '' })
  const [name, setName] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetch(`${apiUrl}/school/waiver/${encodeURIComponent(token)}`)
      .then(async (res) => {
        const d = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(d.error || 'This link is not valid.')
        if (alive) { setReq({ loading: false, data: d, error: '' }); setName(d.parentName || '') }
      })
      .catch((e) => alive && setReq({ loading: false, data: null, error: e.message }))
    return () => { alive = false }
  }, [token])

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/school/waiver/${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, agree }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not save that.')
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally { setBusy(false) }
  }

  const d = req.data
  const child = d?.childFirstName || 'your child'
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
          ) : req.error || d.done || d.closed ? (
            <div className="text-center">
              {d?.done ? <CheckCircle2 className="w-10 h-10 text-brand-500 mx-auto mb-3" /> : <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />}
              <p className="text-sm text-earth-500 dark:text-earth-400">
                {req.error || (d.done ? 'You already agreed to this waiver. Thank you!' : 'This sign-up is no longer active, so there is nothing to agree to.')}
              </p>
            </div>
          ) : done ? (
            <div className="text-center">
              <CheckCircle2 className="w-10 h-10 text-brand-500 mx-auto mb-3" />
              <p className="font-semibold">Thank you</p>
              <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">We&apos;ve let {child} and the organizer know you agreed.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <h1 className="font-display font-semibold text-xl flex items-center gap-2"><FileSignature className="w-5 h-5 text-brand-500" /> A waiver for {child}</h1>
                <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">
                  {child} signed up to volunteer at <strong>{d.task.title}</strong>{d.task.date ? ` on ${fmt(d.task.date)}${d.task.time ? ` at ${d.task.time}` : ''}` : ''}{d.task.location ? `, ${d.task.location}` : ''}. {d.task.organizer || 'The organizer'} asks every volunteer to agree to this waiver, and because {child} is under 18, you need to agree too.
                </p>
              </div>
              <div className="max-h-72 overflow-y-auto whitespace-pre-line rounded-xl border border-earth-200 dark:border-white/10 p-3 text-sm">{d.waiverText}</div>
              <label className="block text-sm"><span className="font-medium">Your full name</span>
                <input className="input mt-1" required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} required />
                <span>I am {child}&apos;s parent or guardian, I have read this waiver, and I agree to it on their behalf.</span>
              </label>
              {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
              <button type="submit" className="btn-primary w-full" disabled={busy || !agree || name.trim().length < 2}>{busy ? 'Saving…' : 'Agree'}</button>
              <p className="text-xs text-earth-500 dark:text-earth-400">If you don&apos;t agree, just close this page: nothing is recorded. You may want to talk with {child} and the organizer.</p>
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}
