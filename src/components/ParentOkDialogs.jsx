import { useState } from 'react'
import { Mail, KeyRound, X } from 'lucide-react'
import { tr } from '@/lib/i18n.js'
import useEscapeKey from '@/hooks/useEscapeKey.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

function Shell({ title, onClose, children }) {
  useEscapeKey(onClose)
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0f1813] p-6 text-white shadow-soft" role="dialog" aria-modal="true" aria-label={title}>
        <button type="button" onClick={onClose} aria-label={tr('Close')} className="absolute top-4 right-4 p-1 text-earth-400 hover:text-white"><X className="w-5 h-5" /></button>
        <h2 className="text-xl font-bold pr-8">{title}</h2>
        {children}
      </div>
    </div>
  )
}

// Under 13 (#849): the child picks how a parent says yes before signing up.
export function ParentOkChoice({ onPick, onClose }) {
  return (
    <Shell title={tr('Your parent needs to OK this')} onClose={onClose}>
      <p className="mt-2 text-sm text-earth-300">{tr('Because you are under 13, a parent or guardian says yes before the organizer sees your sign-up. How should they say yes?')}</p>
      <div className="mt-5 space-y-3">
        <button type="button" onClick={() => onPick('email')} className="w-full text-left rounded-xl border border-white/10 p-4 hover:bg-white/5">
          <span className="flex items-center gap-2 font-semibold"><Mail className="w-4 h-4 text-brand-400" aria-hidden="true" />{tr('Email my parent to approve')}</span>
          <span className="block mt-1 text-xs text-earth-400">{tr('They get an email and tap Approve. You wait for them.')}</span>
        </button>
        <button type="button" onClick={() => onPick('pin')} className="w-full text-left rounded-xl border border-white/10 p-4 hover:bg-white/5">
          <span className="flex items-center gap-2 font-semibold"><KeyRound className="w-4 h-4 text-brand-400" aria-hidden="true" />{tr('Get a PIN from my parent')}</span>
          <span className="block mt-1 text-xs text-earth-400">{tr('We email your parent a 6-digit PIN. If they agree, they give it to you and you type it in.')}</span>
        </button>
      </div>
    </Shell>
  )
}

// The child types the PIN their parent was emailed (#849).
export function ParentPinEntry({ taskId, sent = true, onDone, onClose }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState(sent ? tr('We emailed your parent a 6-digit PIN. Ask them for it and type it here.') : '')

  const send = async () => {
    setBusy(true); setError('')
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${encodeURIComponent(taskId)}/parent-pin/send`, { method: 'POST', headers: authHeaders() })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || tr('Could not send the code.'))
      setInfo(tr('We emailed your parent a 6-digit PIN. Ask them for it and type it here.'))
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const check = async () => {
    setBusy(true); setError('')
    try {
      const res = await fetch(`${apiUrl}/school/public-tasks/${encodeURIComponent(taskId)}/parent-pin`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ pin }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || tr('Could not check the PIN.'))
      onDone(d.status)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <Shell title={tr('Enter the PIN from your parent')} onClose={onClose}>
      {info && <p className="mt-2 text-sm text-earth-300">{info}</p>}
      <input
        type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={pin} aria-label={tr('PIN from your parent')}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onKeyDown={(e) => { if (e.key === 'Enter' && pin.length === 6 && !busy) check() }}
        placeholder="000000"
        className="mt-4 w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-center text-2xl tracking-[0.4em] text-white placeholder-earth-600 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
      />
      {error && <p className="mt-3 text-sm text-red-400" role="alert">{error}</p>}
      <button type="button" onClick={check} disabled={busy || pin.length !== 6} className="mt-4 w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold hover:bg-brand-500 disabled:opacity-40">
        {busy ? tr('Checking…') : tr('Confirm PIN')}
      </button>
      <button type="button" onClick={send} disabled={busy} className="mt-2 w-full text-xs text-earth-400 hover:text-earth-200">
        {sent ? tr('Send a new PIN to my parent') : tr('Send a PIN to my parent')}
      </button>
    </Shell>
  )
}
