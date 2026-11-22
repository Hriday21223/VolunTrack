import { useState } from 'react'
import { Users } from 'lucide-react'
import Card from '@/components/Card.jsx'
import CaseloadEditor from '@/components/CaseloadEditor.jsx'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// Asked once, the first time a co-admin opens the school dashboard (#972):
// "Are you a counselor?" Yes → the last names (and grades) they help, after
// which they see only those students. No → nothing changes. The main admin
// can change it later in School setup → Co-admins.
export default function CaseloadPrompt({ gradeOptions, onDone }) {
  const [step, setStep] = useState('ask')
  const [value, setValue] = useState({ ranges: [{ from: '', to: '' }], grades: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async (counselor) => {
    setBusy(true); setError('')
    try {
      const res = await fetch(`${apiUrl}/school/staff/me/caseload`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` },
        body: JSON.stringify(counselor ? { counselor: true, ...value } : { counselor: false }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || tr('Could not save that.')); return }
      onDone?.()
    } catch { setError(tr('Could not save that.')) } finally { setBusy(false) }
  }

  return (
    <Card className="mb-4 border border-brand-500/30">
      <h3 className="font-semibold flex items-center gap-2 mb-1"><Users className="w-4 h-4 text-brand-600" />{' '}{tr('Are you a counselor?')}</h3>
      {step === 'ask' ? (
        <>
          <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">{tr('If you help only some students, for example by last name, pick them and you’ll see only your students.')}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary btn-sm" onClick={() => setStep('pick')}>{tr('Yes, pick my students')}</button>
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => save(false)}>{tr('No, I help everyone')}</button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-earth-500 dark:text-earth-400 mb-3">{tr('Which students do you help?')}</p>
          <CaseloadEditor value={value} onChange={setValue} gradeOptions={gradeOptions} idPrefix="my-caseload" />
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => save(true)}>{busy ? tr('Saving…') : tr('Save')}</button>
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => setStep('ask')}>{tr('Back')}</button>
          </div>
        </>
      )}
      {error && <p className="text-sm text-red-500 mt-2">{tr(error)}</p>}
    </Card>
  )
}
