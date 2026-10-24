// Invite a friend (#493). The friend's code is kept on this device from the
// moment they open /invite/<code>, so it still reaches sign-up if they look
// around the site first. It expires after 30 days, and is cleared once an
// account is made.
import { isNativeApp } from '@/lib/platform.js'

const KEY = 'voluntrack:invite'
const TTL_MS = 30 * 24 * 60 * 60 * 1000
const CODE_RE = /^[a-z2-9]{10}$/

// Links made in the phone app point at the public site, not its localhost.
const SITE = ((isNativeApp && import.meta.env.VITE_SITE_URL) || window.location.origin).replace(/\/$/, '')

export function inviteUrl(code) {
  return `${SITE}/invite/${encodeURIComponent(code)}`
}

export function cleanInviteCode(raw) {
  const code = String(raw || '').trim().toLowerCase()
  return CODE_RE.test(code) ? code : ''
}

export function rememberInvite(raw) {
  const code = cleanInviteCode(raw)
  if (!code) return
  try { localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() })) } catch { /* storage blocked */ }
}

export function readInvite() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!saved?.code || Date.now() - Number(saved.at || 0) > TTL_MS) return ''
    return cleanInviteCode(saved.code)
  } catch {
    return ''
  }
}

export function clearInvite() {
  try { localStorage.removeItem(KEY) } catch { /* storage blocked */ }
}
