import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ScrollText } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth.jsx'
import { tr } from '@/lib/i18n.js'
import { LEGAL_VERSION, LEGAL_CHANGES, LEGAL_SUMMARY, LEGAL_SUMMARY_SCHOOL } from '@/lib/legal.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// "We updated our Terms and Privacy Policy" (#689): a signed-in account that
// hasn't accepted the current version sees this over the app until it agrees
// or signs out. The Terms and Privacy pages stay readable underneath.
export default function LegalUpdateGate() {
  const { user, refreshUser, logout } = useAuth()
  const { pathname } = useLocation()
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  let token = null
  try { token = localStorage.getItem('voluntrack:auth_token') } catch { /* private mode */ }
  if (!user || !token || user.legalVersion === LEGAL_VERSION) return null
  if (pathname === '/terms' || pathname === '/privacy') return null
  const firstTime = !user.legalVersion
  const isSchool = ['school', 'school_staff', 'org'].includes(user.role)
  const points = firstTime ? (isSchool ? LEGAL_SUMMARY_SCHOOL : LEGAL_SUMMARY) : LEGAL_CHANGES

  const accept = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/auth/me/legal`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ version: LEGAL_VERSION }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || tr('Could not save that. Please try again.'))
      await refreshUser()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] grid place-items-center bg-black/80 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-labelledby="legal-update-title">
      <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl border border-white/10 bg-white dark:bg-[#0f1813] p-5 shadow-soft text-earth-900 dark:text-earth-100">
        <h2 id="legal-update-title" className="font-display font-semibold text-lg flex items-center gap-2">
          <ScrollText className="w-5 h-5 text-brand-600" aria-hidden="true" />
          {firstTime ? tr('Please review our Terms and Privacy Policy') : tr('We updated our Terms and Privacy Policy')}
        </h2>
        <p className="text-sm text-earth-500 dark:text-earth-400 mt-1">{firstTime ? tr('The short version:') : tr('What changed, in short:')}</p>
        <ul className="mt-2 space-y-1.5 list-disc pl-5 text-sm text-earth-700 dark:text-earth-300">
          {points.map((c) => <li key={c}>{tr(c)}</li>)}
        </ul>
        <p className="mt-3 text-sm">
          {tr('Read the full')}{' '}
          <Link to="/terms" target="_blank" className="text-brand-700 dark:text-brand-300 font-medium hover:underline">{tr('Terms of Service')}</Link>
          {' '}{tr('and')}{' '}
          <Link to="/privacy" target="_blank" className="text-brand-700 dark:text-brand-300 font-medium hover:underline">{tr('Privacy Policy')}</Link>.
        </p>
        <label className="mt-4 flex items-start gap-2 text-sm cursor-pointer">
          <input type="checkbox" className="mt-0.5 w-4 h-4" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>{firstTime ? tr('I have read the short version and agree to the Terms of Service and Privacy Policy.') : tr('I have read what changed and agree to the updated Terms of Service and Privacy Policy.')}</span>
        </label>
        {error && <p role="alert" className="text-sm text-red-500 mt-2">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={accept} disabled={!agree || busy}>{busy ? tr('Saving…') : tr('Agree and continue')}</button>
          <button type="button" className="btn-ghost" onClick={() => logout()}>{tr("I don't agree — sign out")}</button>
        </div>
        <p className="mt-3 text-xs text-earth-500 dark:text-earth-400">{tr('If you don’t agree, you can sign out and ask us to delete your account from the Privacy Policy page.')}</p>
      </div>
    </div>
  )
}
