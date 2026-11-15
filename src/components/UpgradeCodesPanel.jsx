import { useCallback, useEffect, useState } from 'react'
import { ArrowUpCircle, Check, Copy, Plus } from 'lucide-react'
import Card from '@/components/Card.jsx'
import useEscapeKey from '@/hooks/useEscapeKey.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const base = `${apiUrl}/registration-codes/admin/upgrade`
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

// Admin Invites tab: club upgrade codes (#892). A free club's adviser types
// one under "Upgrade to a school plan" and the club becomes a school plan,
// on a free trial or paid. The full code is shown once, here.
export default function UpgradeCodesPanel() {
  const [codes, setCodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [form, setForm] = useState(null) // { label, days, trial }
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(null)
  const [copied, setCopied] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(null)
  useEscapeKey(() => setForm(null), Boolean(form))

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { headers: authHeaders() })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not load codes.')
      setCodes(data.codes || [])
      setErr('')
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const create = async () => {
    setBusy(true); setErr('')
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ label: form.label.trim(), expiresInDays: Number(form.days), trialDays: Number(form.trial) || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not create a code.')
      setForm(null); setCopied(false); setCreated(data)
      load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const revoke = async (id) => {
    setConfirmRevoke(null)
    const res = await fetch(`${base}/${id}/revoke`, { method: 'POST', headers: authHeaders() })
    if (!res.ok) { const data = await res.json().catch(() => ({})); setErr(data.error || 'Could not revoke the code.') }
    load()
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(created.code); setCopied(true) } catch { /* the code is selectable on screen */ }
  }

  return (
    <Card padded={false} className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><ArrowUpCircle className="w-4 h-4 text-brand-400" /> Club upgrade codes</h2>
          <p className="text-sm text-earth-400 mt-0.5">
            A free club’s adviser types one of these under “Upgrade to a school plan” and the club becomes a school plan. Give it a free trial, or none if they’ve already paid. Each works once.
          </p>
        </div>
        <button onClick={() => setForm({ label: '', days: 14, trial: 30 })} className="btn-sm btn-primary">
          <Plus className="w-3.5 h-3.5 mr-1" /> New code
        </button>
      </div>

      {err && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg mb-3">{err}</div>}

      {loading ? (
        <p className="text-sm text-earth-400 py-4 text-center">Loading codes…</p>
      ) : codes.length === 0 ? (
        <p className="text-sm text-earth-400 py-4 text-center">No unused codes.</p>
      ) : (
        <ul className="divide-y divide-earth-200 dark:divide-earth-800">
          {codes.map((c) => (
            <li key={c.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              <ArrowUpCircle className="w-5 h-5 text-brand-600 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  <span className="font-mono text-earth-400">•••••-••{c.hint}</span>
                  {c.label && <span className="ml-2">{c.label}</span>}
                </p>
                <p className="text-xs text-earth-500">
                  {c.trialDays ? `${c.trialDays}-day free trial` : 'Paid, no trial'}
                  {' · '}
                  {`Expires ${new Date(c.expiresAt).toLocaleDateString()}`}
                </p>
              </div>
              {confirmRevoke === c.id ? (
                <span className="flex gap-1">
                  <button onClick={() => revoke(c.id)} className="btn-sm bg-red-600 text-white hover:bg-red-700">Revoke</button>
                  <button onClick={() => setConfirmRevoke(null)} className="btn-sm btn-ghost">Keep</button>
                </span>
              ) : (
                <button onClick={() => setConfirmRevoke(c.id)} className="text-xs text-red-400 hover:text-red-300">Revoke</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {form && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setForm(null)}>
          <Card className="w-full max-w-sm" role="dialog" aria-modal="true" aria-labelledby="uc-new-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="uc-new-title" className="font-semibold mb-2">New club upgrade code</h3>
            <p className="text-sm text-earth-400 mb-4">10 letters and numbers. Give it to the club’s adviser however you like. It works once.</p>
            <div className="space-y-3">
              <div>
                <label className="label" htmlFor="uc-label">Note <span className="text-earth-400 font-normal">(optional)</span></label>
                <input id="uc-label" className="input" maxLength={120} placeholder="e.g. Lincoln High Key Club" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="uc-trial">After they enter it</label>
                <select id="uc-trial" className="input" value={form.trial} onChange={(e) => setForm({ ...form, trial: e.target.value })}>
                  <option value={14}>14-day free trial</option>
                  <option value={30}>1-month free trial (30 days)</option>
                  <option value={60}>2-month free trial (60 days)</option>
                  <option value={90}>3-month free trial (90 days)</option>
                  <option value={0}>Paid already, no trial</option>
                </select>
                <p className="text-xs text-earth-400 mt-1">A trial counts as paid until it ends, then turns unpaid and the school locks until you mark it paid.</p>
              </div>
              <div>
                <label className="label" htmlFor="uc-days">Code expires after</label>
                <select id="uc-days" className="input" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })}>
                  <option value={3}>3 days</option>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setForm(null)} className="btn-ghost flex-1">Cancel</button>
                <button onClick={create} className="btn-primary flex-1" disabled={busy}>{busy ? 'Creating…' : 'Create code'}</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {created && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-sm" role="dialog" aria-modal="true" aria-labelledby="uc-reveal-title">
            <h3 id="uc-reveal-title" className="font-semibold mb-1">Club upgrade code</h3>
            <p className="text-sm text-earth-400 mb-4">
              Copy it now — <strong>you won&apos;t be able to see it again</strong>. It expires {new Date(created.expiresAt).toLocaleDateString()}.
              {created.trialDays ? ` It comes with a ${created.trialDays}-day free trial.` : ' It makes the club a paid school plan.'}
            </p>
            <div className="rounded-xl bg-earth-100 dark:bg-earth-900 px-4 py-3 text-center font-mono text-lg tracking-wider select-all break-all">
              {created.code}
            </div>
            <p className="text-xs text-earth-400 mt-2">The adviser enters it on their School Dashboard, under “Upgrade to a school plan”.</p>
            <div className="flex gap-2 mt-4">
              <button onClick={copy} className="btn-ghost flex-1">
                {copied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy</>}
              </button>
              <button onClick={() => setCreated(null)} className="btn-primary flex-1">Done</button>
            </div>
          </Card>
        </div>
      )}
    </Card>
  )
}
