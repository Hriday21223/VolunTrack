import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import Card from '@/components/Card.jsx'
import SignaturePad from '@/components/SignaturePad.jsx'
import { fmtDate } from '@/utils/date.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// Supervisor inbox (#694): every request still waiting for this supervisor,
// approved with one signature. No sign-in; the link is the key. All start
// ticked; untick one to reject it instead.
export default function SupervisorInbox() {
  const { token } = useParams()
  const [state, setState] = useState({ loading: true, data: null, error: '' })
  const [rejected, setRejected] = useState(() => new Set())
  const [signature, setSignature] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)

  useEffect(() => {
    fetch(`${apiUrl}/supervisor-inbox/${encodeURIComponent(token)}`)
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Could not load the requests.'); return d })
      .then((data) => setState({ loading: false, data, error: '' }))
      .catch((e) => setState({ loading: false, data: null, error: e.message }))
  }, [token])

  const list = state.data?.requests || []
  const approve = list.filter((r) => !rejected.has(r.id)).map((r) => r.id)
  const toggle = (id) => setRejected((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next })

  const submit = async () => {
    if (approve.length > 0 && !signature) { setError('Sign in the box first.'); return }
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/supervisor-inbox/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature, approve, reject: [...rejected] }),
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
              <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">{done.approved} approved{done.rejected ? ` · ${done.rejected} rejected` : ''}. The students have been told.</p>
            </div>
          ) : list.length === 0 ? (
            <p className="text-sm text-center text-earth-500">Nothing is waiting for you right now. Thanks!</p>
          ) : (
            <div className="space-y-4">
              <div>
                <h1 className="font-display font-bold text-xl">Hours waiting for you</h1>
                <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">These students listed you as their supervisor. Untick any you can&apos;t confirm (they&apos;re rejected), then sign once to approve the rest.</p>
              </div>
              <ul className="divide-y divide-earth-100 dark:divide-white/10">
                {list.map((r) => (
                  <li key={r.id} className="py-2 text-sm">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" className="mt-1 w-4 h-4 accent-emerald-600" checked={!rejected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Approve ${r.studentName}, ${r.activity}`} />
                      <span className="flex-1">
                        <span className="font-medium">{r.studentName}</span>
                        <span className="block">{r.activity} · <strong>{r.hours}h</strong> · asked {fmtDate(String(r.createdAt).slice(0, 10))}</span>
                        {rejected.has(r.id) && <span className="text-xs text-red-500">Will be rejected</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {approve.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">Your signature (covers the {approve.length} you approve)</p>
                  <SignaturePad value={signature} onChange={setSignature} />
                </div>
              )}
              {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
              <button type="button" className="btn-primary w-full" onClick={submit} disabled={busy}>
                {busy ? 'Saving…' : `Approve ${approve.length}${rejected.size ? `, reject ${rejected.size}` : ''}`}
              </button>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
