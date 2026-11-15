import { useState } from 'react'
import { Download, LogOut } from 'lucide-react'
import Card from '@/components/Card.jsx'
import { useAuth } from '@/hooks/useAuth.jsx'
import { todayLocal } from '@/utils/date.js'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

// Devices and data (#886), for every kind of account: sign every other
// device out, and download everything VolunTrack keeps about the account.
export default function AccountDataCard() {
  const { refreshUser } = useAuth()
  const [busy, setBusy] = useState(null) // 'signout' | 'export'
  const [msg, setMsg] = useState(null) // { text, ok }

  const signOutOthers = async () => {
    setBusy('signout'); setMsg(null)
    try {
      const res = await fetch(`${apiUrl}/auth/me/sign-out-everywhere`, { method: 'POST', headers: auth() })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.token) throw new Error(d.error || tr('Something went wrong. Try again.'))
      // This device keeps going on the fresh token; every other one is out.
      localStorage.setItem('voluntrack:auth_token', d.token)
      await refreshUser?.()
      setMsg({ text: tr('Every other device is signed out. You are still signed in here.'), ok: true })
    } catch (err) { setMsg({ text: err.message, ok: false }) } finally { setBusy(null) }
  }

  const download = async () => {
    setBusy('export'); setMsg(null)
    try {
      const res = await fetch(`${apiUrl}/auth/me/export`, { headers: auth() })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || tr('Something went wrong. Try again.')) }
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `voluntrack-data-${todayLocal()}.json`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      setMsg({ text: tr('Your data is downloading.'), ok: true })
    } catch (err) { setMsg({ text: err.message, ok: false }) } finally { setBusy(null) }
  }

  return (
    <Card>
      <h3 className="font-display font-semibold mb-1">{tr('Devices and your data')}</h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
        {tr('Left VolunTrack signed in on a shared computer? Sign out every other device from here. We also email you when your account signs in on a new device.')}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={signOutOthers} disabled={busy !== null} className="btn-secondary btn-sm">
          <LogOut className="w-4 h-4 mr-1" aria-hidden="true" />{' '}{busy === 'signout' ? tr('Signing out…') : tr('Sign out of all other devices')}
        </button>
        <button type="button" onClick={download} disabled={busy !== null} className="btn-secondary btn-sm">
          <Download className="w-4 h-4 mr-1" aria-hidden="true" />{' '}{busy === 'export' ? tr('Preparing…') : tr('Download my data')}
        </button>
      </div>
      <p className="text-xs text-earth-500 dark:text-earth-400 mt-3">
        {tr('Download my data gives you one file with everything VolunTrack keeps about your account. Passwords, PINs and codes are stored only in scrambled form, so they are not in it.')}
      </p>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm mt-3 ${msg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>{msg.text}</p>}
    </Card>
  )
}
