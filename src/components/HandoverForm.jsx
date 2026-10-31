import { useState } from 'react'
import { CheckCircle2, UserCog } from 'lucide-react'
import { startHandover } from '@/lib/handover.js'
import { tr } from '@/lib/i18n.js'

// "Hand over to a new person" (#550): name + email (or a preset co-admin),
// plus the caller's password when `needsPassword`. The new person accepts
// from the emailed link at /handover.
export default function HandoverForm({ path, needsPassword = true, preset = null, place = '', role = 'principal', onCancel, onSent }) {
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const body = preset ? { staffId: preset.id } : { name: form.name, email: form.email }
      if (needsPassword) body.password = form.password
      const res = await startHandover(path, body)
      const to = preset ? preset.email : form.email
      setSent({ to, emailSent: res.emailSent })
      onSent?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="text-sm space-y-1">
        <p className="flex items-center gap-2 font-medium text-brand-600 dark:text-brand-400">
          <CheckCircle2 className="w-4 h-4" />{' '}{tr('Invite sent to {email}', { email: sent.to })}
        </p>
        <p className="text-xs text-earth-500 dark:text-earth-400">
          {sent.emailSent
            ? tr('They have 7 days to accept. Nothing changes until they do.')
            : tr('The email couldn’t be sent from here. Nothing changes until they accept.')}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {preset ? (
        <p className="text-sm">
          {place
            ? tr('Make {name} ({email}) the main admin of {place}? They’ll get an email to accept. You’ll stay on as a co-admin.', { name: preset.name, email: preset.email, place })
            : tr('Make {name} ({email}) the main admin? They’ll get an email to accept. You’ll stay on as a co-admin.', { name: preset.name, email: preset.email })}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <input className="input" placeholder={`New ${role}’s name`} value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input className="input" type="email" placeholder={tr('Their email')} value={form.email} maxLength={254} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </div>
      )}
      {needsPassword && (
        <input className="input" type="password" autoComplete="current-password" placeholder={tr('Your password, to confirm')} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary btn-sm" disabled={busy}>
          <UserCog className="w-3.5 h-3.5 mr-1" /> {busy ? tr('Sending…') : tr('Send handover invite')}
        </button>
        {onCancel && <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>{tr('Cancel')}</button>}
      </div>
    </form>
  )
}
