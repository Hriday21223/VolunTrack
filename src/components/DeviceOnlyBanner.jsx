import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CloudUpload } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth.jsx'
import { tr } from '@/lib/i18n.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// A device-only account (made when our server couldn't be reached, #917):
// its hours live only here, so a reset phone loses them. Once the server
// answers, offer to save them to a free account.
export default function DeviceOnlyBanner() {
  const { user, leaveDeviceAccountKeepingHours } = useAuth()
  const nav = useNavigate()
  const [reachable, setReachable] = useState(false)
  const deviceOnly = Boolean(user) && !localStorage.getItem('voluntrack:auth_token') && ['student', 'volunteer'].includes(user.role || 'student')

  useEffect(() => {
    if (!deviceOnly) return
    fetch(`${apiUrl}/status/ping`).then((r) => setReachable(r.ok)).catch(() => setReachable(false))
  }, [deviceOnly])

  if (!deviceOnly || !reachable) return null

  const go = (path) => {
    try { sessionStorage.setItem('voluntrack:signup-draft', JSON.stringify({ name: user.name || '', email: user.email || '' })) } catch { /* */ }
    leaveDeviceAccountKeepingHours()
    nav(path)
  }

  return (
    <div role="status" className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
      <p className="font-medium flex items-center gap-2"><CloudUpload className="w-4 h-4" aria-hidden="true" /> {tr('Your hours are saved only on this device')}</p>
      <p className="text-earth-600 dark:text-earth-300 mt-1">{tr('If this phone is reset or lost, they’re gone. Save them to a free account so they’re safe and on every device.')}</p>
      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" onClick={() => go(user.role === 'volunteer' ? '/register/organizer' : '/register/student')} className="btn-primary btn-sm">{tr('Save my hours to an account')}</button>
        <button type="button" onClick={() => go('/login')} className="btn-ghost btn-sm">{tr('I already have an account')}</button>
      </div>
    </div>
  )
}
