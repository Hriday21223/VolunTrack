import { flushLogOutbox, unsyncedCount } from '@/lib/logSync.js'
import { tr } from '@/lib/i18n.js'

// Before signing out (#917): try once more to send anything waiting, then,
// if entries still haven't reached the account, ask first. Signing out clears
// this device, so those entries would be gone for good.
export async function okToSignOut() {
  try { await flushLogOutbox() } catch { /* offline: counted below */ }
  const n = unsyncedCount()
  if (n === 0) return true
  const msg = localStorage.getItem('voluntrack:auth_token')
    ? tr('{n} of your changes haven’t reached your account yet, because there’s no internet. If you sign out now, they’ll be lost. Sign out anyway?', { n })
    : tr('Your {n} entries are saved only on this device. If you sign out, they’ll be deleted. Sign out anyway?', { n })
  return window.confirm(msg)
}
