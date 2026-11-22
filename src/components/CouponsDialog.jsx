import { useCallback, useEffect, useState } from 'react'
import { Ticket, X, Copy, Check } from 'lucide-react'
import Card from '@/components/Card.jsx'
import useEscapeKey from '@/hooks/useEscapeKey.js'
import { fmtDate } from '@/utils/date.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

// Admin → Schools / Organizations → Coupons (#966): make a coupon for this one
// account, see its coupons, cancel an unused one. Admin-only, English.
export default function CouponsDialog({ entityType, entity, onClose }) {
  useEscapeKey(onClose)
  const [coupons, setCoupons] = useState([])
  const [kind, setKind] = useState('percent')
  const [percentOff, setPercentOff] = useState('100')
  const [freeMonths, setFreeMonths] = useState('3')
  const [expiresAt, setExpiresAt] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [made, setMade] = useState(null) // { code, label }
  const [copied, setCopied] = useState(false)
  const [voiding, setVoiding] = useState(null) // id waiting for the second click

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/coupons/admin/${entityType}/${entity.id}`, { headers: auth() })
      if (res.ok) setCoupons((await res.json()).coupons || [])
    } catch {}
  }, [entityType, entity.id])
  useEffect(() => { load() }, [load])

  const create = async (e) => {
    e.preventDefault()
    setBusy(true); setError(''); setMade(null)
    try {
      const res = await fetch(`${apiUrl}/coupons/admin`, {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType, entityId: entity.id, kind, percentOff, freeMonths, expiresAt: expiresAt || undefined, note: note.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Could not make the coupon.'); return }
      setMade({ code: data.code, label: data.coupon.label })
      setNote('')
      load()
    } catch { setError('Could not make the coupon.') } finally { setBusy(false) }
  }

  const voidCoupon = async (id) => {
    if (voiding !== id) { setVoiding(id); return }
    setVoiding(null)
    try {
      const res = await fetch(`${apiUrl}/coupons/admin/${id}/void`, { method: 'POST', headers: auth() })
      if (!res.ok) setError((await res.json().catch(() => ({}))).error || 'Could not cancel it.')
      load()
    } catch {}
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(made.code); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {}
  }

  const statusText = (c) => {
    if (c.status === 'void') return 'Cancelled'
    if (c.status === 'redeemed') {
      if (c.kind === 'percent') return c.applied_invoice_id ? 'Used on an invoice' : 'Used, waiting for the next invoice'
      return `Used ${fmtDate(String(c.redeemed_at).slice(0, 10))}`
    }
    if (c.expires_at && new Date(c.expires_at) < new Date()) return 'Expired'
    return c.expires_at ? `Not used yet · expires ${fmtDate(String(c.expires_at).slice(0, 10))}` : 'Not used yet · no expiry'
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="font-semibold flex items-center gap-2"><Ticket className="w-4 h-4 text-brand-400" /> Coupons for {entity.name}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-earth-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-earth-400 mb-4">Only this {entityType === 'organization' ? 'organization' : 'school'} can use it, once. They type it under Billing.</p>

        {made && (
          <div className="mb-4 rounded-xl p-3 bg-brand-500/10 border border-brand-500/30 text-sm">
            <p className="font-medium">{made.label}. Give them this code:</p>
            <div className="flex items-center gap-2 mt-2">
              <code className="flex-1 rounded-lg bg-earth-800 px-3 py-2 font-mono text-base tracking-wider select-all">{made.code}</code>
              <button type="button" onClick={copy} className="btn-sm btn-ghost">{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}</button>
            </div>
            <p className="text-xs text-earth-400 mt-2">Shown only now. VolunTrack keeps just the last 4 characters.</p>
          </div>
        )}

        <form onSubmit={create} className="space-y-3">
          <div className="flex gap-2">
            <button type="button" onClick={() => setKind('percent')} className={`btn-sm flex-1 ${kind === 'percent' ? 'btn-primary' : 'btn-ghost'}`}>% off next invoice</button>
            <button type="button" onClick={() => setKind('months')} className={`btn-sm flex-1 ${kind === 'months' ? 'btn-primary' : 'btn-ghost'}`}>Free months</button>
          </div>
          {kind === 'percent' ? (
            <div>
              <label htmlFor="cpn-percent" className="label">Percent off (100 = free)</label>
              <input id="cpn-percent" type="number" min="1" max="100" step="0.01" className="input" value={percentOff} onChange={(e) => setPercentOff(e.target.value)} required />
            </div>
          ) : (
            <div>
              <label htmlFor="cpn-months" className="label">Free months (1–36)</label>
              <input id="cpn-months" type="number" min="1" max="36" step="1" className="input" value={freeMonths} onChange={(e) => setFreeMonths(e.target.value)} required />
              <p className="text-xs text-earth-400 mt-1">If they're already paid with no end date, their due date moves back this many months. Otherwise they're paid until then, and it ends like a free trial (with the same reminder emails).</p>
            </div>
          )}
          <div>
            <label htmlFor="cpn-expires" className="label">Use by (optional)</label>
            <input id="cpn-expires" type="date" className="input" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            <p className="text-xs text-earth-400 mt-1">Leave empty and they can use it any time.</p>
          </div>
          <div>
            <label htmlFor="cpn-note" className="label">Note (optional, shown on the invoice)</label>
            <input id="cpn-note" className="input" maxLength={200} placeholder="e.g. Thank you for 3 years" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? 'Making…' : 'Make coupon'}</button>
        </form>

        {coupons.length > 0 && (
          <div className="mt-5">
            <h4 className="text-sm font-medium mb-2">Coupons</h4>
            <ul className="space-y-2">
              {coupons.map((c) => (
                <li key={c.id} className="rounded-xl p-2.5 bg-earth-500/5 text-sm flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p>{c.label} <span className="text-earth-500 font-mono text-xs">…{c.code_hint}</span></p>
                    <p className="text-xs text-earth-500">{statusText(c)}{c.note ? ` · ${c.note}` : ''}</p>
                  </div>
                  {c.status === 'active' && (
                    <button type="button" onClick={() => voidCoupon(c.id)} className={`btn-sm shrink-0 ${voiding === c.id ? 'btn-danger' : 'btn-ghost'}`}>
                      {voiding === c.id ? 'Tap again to cancel' : 'Cancel'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  )
}
