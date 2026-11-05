import { useEffect, useState } from 'react'
import { Wallet } from 'lucide-react'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

// Wallet card (#716): Add to Apple Wallet / Save to Google Wallet, shown only
// for the wallets the server has credentials for. Both open a link: Apple's is
// a 5-minute .pkpass download, Google's its own save page. With `badgeTaskId`
// they add that event's volunteer badge as a ticket instead (#732).
export default function WalletButtons({ badgeTaskId = null, className = 'btn-secondary w-full' }) {
  const [on, setOn] = useState({ apple: false, google: false })
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!localStorage.getItem('voluntrack:auth_token')) return
    fetch(`${apiUrl}/wallet/status`, { headers: auth() }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setOn(d)).catch(() => {})
  }, [])
  if (!on.apple && !on.google) return null
  const open = async (which) => {
    setBusy(which)
    setError('')
    try {
      const path = badgeTaskId
        ? `badge/${encodeURIComponent(badgeTaskId)}/${which === 'apple' ? 'apple-link' : 'google'}`
        : (which === 'apple' ? 'apple-link' : 'google')
      const res = await fetch(`${apiUrl}/wallet/${path}`, { headers: auth() })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.url) throw new Error(d.error || tr('Could not make your wallet card.'))
      window.location.href = d.url
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }
  return (
    <>
      {on.apple && (
        <button type="button" className={className} onClick={() => open('apple')} disabled={busy === 'apple'}>
          <Wallet className="w-4 h-4" />{' '}{busy === 'apple' ? tr('Making your card…') : tr('Add to Apple Wallet')}
        </button>
      )}
      {on.google && (
        <button type="button" className={className} onClick={() => open('google')} disabled={busy === 'google'}>
          <Wallet className="w-4 h-4" />{' '}{busy === 'google' ? tr('Making your card…') : tr('Save to Google Wallet')}
        </button>
      )}
      {error && <p role="alert" className={badgeTaskId ? 'text-sm text-red-200' : 'text-sm text-red-500'}>{error}</p>}
    </>
  )
}
