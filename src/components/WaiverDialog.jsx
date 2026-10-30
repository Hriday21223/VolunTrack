import { useState } from 'react'
import { FileSignature, X } from 'lucide-react'
import { tr } from '@/lib/i18n.js'

// Event waivers (#595): shown before signing up for a task that has one. The
// volunteer types their full name; someone under 18 also names a parent or
// guardian, who gets an email to agree as well. An under-13 account (`under13`)
// skips that: their parent's OK is asked for anyway, and it covers the waiver.
export default function WaiverDialog({ task, user, onClose, onAgree }) {
  const [name, setName] = useState(user?.name || '')
  const [minor, setMinor] = useState(Boolean(user?.under13))
  const [parentName, setParentName] = useState('')
  const [parentEmail, setParentEmail] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const under13 = Boolean(user?.under13)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onAgree({ name: name.trim(), minor, ...(minor && !under13 ? { parentName: parentName.trim(), parentEmail: parentEmail.trim() } : {}) })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="waiver-title"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose?.() }}
    >
      <form onSubmit={submit} className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0f1813] p-5 text-white shadow-soft space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="waiver-title" className="font-display font-semibold text-lg flex items-center gap-2"><FileSignature className="w-4 h-4 text-brand-400" />{' '}{tr('Waiver')}</h2>
            <p className="text-sm text-earth-400 mt-0.5">{tr('{organizer} asks every volunteer at {title} to agree to this.', { organizer: task.creator_name || tr('The organizer'), title: task.title })}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost p-1" aria-label={tr('Close')}><X className="w-4 h-4" /></button>
        </div>
        <div className="max-h-64 overflow-y-auto whitespace-pre-line rounded-xl border border-white/10 bg-white/5 p-3 text-sm">{task.waiver_text}</div>
        <label className="block text-sm">
          {tr('Type your full name to agree')}
          <input className="input mt-1" required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        {!under13 && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={minor} onChange={(e) => setMinor(e.target.checked)} />
            {tr("I'm under 18")}
          </label>
        )}
        {minor && !under13 && (
          <div className="space-y-3 rounded-xl border border-white/10 p-3">
            <p className="text-xs text-earth-400">{tr("A parent or guardian has to agree too. We'll email them a link; your sign-up goes ahead meanwhile, and the organizer sees when they agree.")}</p>
            <label className="block text-sm">{tr("Parent or guardian's name")}
              <input className="input mt-1" required maxLength={100} value={parentName} onChange={(e) => setParentName(e.target.value)} />
            </label>
            <label className="block text-sm">{tr("Parent or guardian's email")}
              <input className="input mt-1" type="email" required maxLength={254} value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} />
            </label>
          </div>
        )}
        {under13 && <p className="text-xs text-earth-400">{tr("Your parent sees this waiver when they OK your sign-up, and approving it agrees for you.")}</p>}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} required />
          <span>{tr('I have read this waiver and I agree to it.')}</span>
        </label>
        {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost flex-1">{tr('Cancel')}</button>
          <button type="submit" disabled={busy || !agree || name.trim().length < 2} className="btn-primary flex-1">{busy ? tr('Signing up…') : tr('Agree and sign up')}</button>
        </div>
      </form>
    </div>
  )
}
