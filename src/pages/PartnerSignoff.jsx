import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { fmtDate } from '@/utils/date.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// Partner sign-off (#676): a district partner confirms the hours students
// logged at their place, with one typed signature. No sign-in; the link is the
// key. Every entry starts ticked; untick one to send it back with a reason.
export default function PartnerSignoff() {
  const { token } = useParams()
  const [state, setState] = useState({ loading: true, data: null, error: '' })
  const [sendBack, setSendBack] = useState({}) // id -> reason
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)

  useEffect(() => {
    fetch(`${apiUrl}/organization/partner-signoff/${encodeURIComponent(token)}`)
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Could not load the hours.'); return d })
      .then((data) => setState({ loading: false, data, error: '' }))
      .catch((e) => setState({ loading: false, data: null, error: e.message }))
  }, [token])

  const d = state.data
  const entries = d?.entries || []
  const approveIds = entries.filter((e) => !(e.id in sendBack)).map((e) => e.id)
  const rejects = Object.entries(sendBack).map(([id, reason]) => ({ id, reason }))
  const totalHours = entries.filter((e) => !(e.id in sendBack)).reduce((n, e) => n + Number(e.hours || 0), 0)

  const submit = async (ev) => {
    ev.preventDefault()
    if (rejects.some((r) => !r.reason.trim())) { setError('Give a reason for each entry you send back.'); return }
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/organization/partner-signoff/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signerName: name, signerTitle: title, confirm: agree, approve: approveIds, reject: rejects }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not save your decisions.')
      setDone(body)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen px-4 py-8 page-shell text-earth-900 dark:text-earth-100">
      <div className="w-full max-w-2xl mx-auto">
        <Link to="/" className="flex items-center gap-2.5 justify-center mb-6">
          <img src={`${import.meta.env.BASE_URL}logo-icon.webp`} alt="" className="w-10 h-10 object-contain" />
          <span className="font-display font-bold text-2xl">VolunTrack</span>
        </Link>
        <Card padded={false} className="p-6">
          {state.loading ? (
            <p className="text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></p>
          ) : state.error ? (
            <div className="text-center">
              <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
              <p className="text-sm text-earth-500 dark:text-earth-400">{state.error}</p>
            </div>
          ) : done ? (
            <div className="text-center">
              <CheckCircle2 className="w-10 h-10 text-brand-500 mx-auto mb-3" />
              <p className="font-semibold">Thank you!</p>
              <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">
                {done.approved} confirmed{done.rejected ? ` · ${done.rejected} sent back` : ''}. The students have been told.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <h1 className="font-display font-bold text-xl">Confirm volunteer hours at {d.partner}</h1>
                <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">
                  Students from {d.organization} logged these hours at your organization. Untick any you can&apos;t confirm and say why; sign once for the rest.
                </p>
              </div>
              {entries.length === 0 ? (
                <p className="text-sm text-earth-500">Nothing is waiting right now. Thanks for checking!</p>
              ) : (
                <>
                  <ul className="divide-y divide-earth-100 dark:divide-white/10">
                    {entries.map((e) => {
                      const back = e.id in sendBack
                      return (
                        <li key={e.id} className="py-2 text-sm">
                          <label className="flex items-start gap-3 cursor-pointer">
                            <input
                              type="checkbox" className="mt-1 w-4 h-4 accent-emerald-600" checked={!back}
                              onChange={() => setSendBack((cur) => { const next = { ...cur }; if (back) delete next[e.id]; else next[e.id] = ''; return next })}
                              aria-label={`Confirm ${e.student}, ${e.date}`}
                            />
                            <span className="flex-1 min-w-0">
                              <span className="font-medium">{e.student}</span>
                              <span className="text-earth-500"> · {e.school}</span>
                              <span className="block">{e.activity || 'Volunteering'} · <strong>{e.hours}h</strong> · {fmtDate(e.date)}</span>
                            </span>
                          </label>
                          {back && (
                            <input
                              value={sendBack[e.id]} maxLength={500}
                              onChange={(ev) => setSendBack((cur) => ({ ...cur, [e.id]: ev.target.value }))}
                              className="input mt-2 text-sm" placeholder="Why can't you confirm this? (the student sees this)"
                              aria-label={`Reason for ${e.student}`}
                            />
                          )}
                        </li>
                      )
                    })}
                  </ul>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="Your full name" aria-label="Your full name" maxLength={100} />
                    <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="Your role (optional)" aria-label="Your role" maxLength={100} />
                  </div>
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input type="checkbox" className="mt-1 w-4 h-4 accent-emerald-600" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                    <span>I confirm these students volunteered with us for the hours ticked ({Math.round(totalHours * 100) / 100} hours). Typing my name is my signature.</span>
                  </label>
                  {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
                  <button type="submit" className="btn-primary w-full" disabled={busy || name.trim().length < 2 || !agree}>
                    {busy ? 'Saving…' : `Sign and confirm ${approveIds.length}${rejects.length ? `, send back ${rejects.length}` : ''}`}
                  </button>
                </>
              )}
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}
