import { useEffect, useState } from 'react'
import { CloudOff, RefreshCw } from 'lucide-react'
import { useData } from '@/hooks/useData.jsx'
import { tr } from '@/lib/i18n.js'

// Entries saved with no connection wait on the device and send themselves when
// it comes back (#635). This says how many are waiting and offers a retry.
export default function UnsentBanner() {
  const { logs, sendPendingNow } = useData()
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const [sending, setSending] = useState(false)
  const [stillWaiting, setStillWaiting] = useState(false)

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  const waiting = logs.filter((l) => l.syncPending && !l.serverId).length
  if (waiting === 0) return null

  const send = async () => {
    setSending(true)
    setStillWaiting(false)
    const left = await sendPendingNow().catch(() => waiting)
    setSending(false)
    setStillWaiting(left > 0)
  }

  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-800 dark:text-sky-200">
      <CloudOff className="w-4 h-4 shrink-0" aria-hidden="true" />
      <p className="flex-1 min-w-[12rem]">
        {waiting === 1
          ? tr('1 entry is saved on this device and waiting to send.')
          : tr('{n} entries are saved on this device and waiting to send.', { n: waiting })}{' '}
        {online
          ? (stillWaiting ? tr('Couldn’t reach VolunTrack yet. It keeps trying by itself.') : '')
          : tr('They send by themselves when you’re back online.')}
      </p>
      {online && (
        <button type="button" className="btn-ghost text-sm inline-flex items-center gap-1.5" onClick={send} disabled={sending}>
          <RefreshCw className={`w-4 h-4 ${sending ? 'animate-spin' : ''}`} aria-hidden="true" />
          {sending ? tr('Sending…') : tr('Send now')}
        </button>
      )}
    </div>
  )
}
