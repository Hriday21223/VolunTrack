// Proof as a link (#955): instead of uploading a file, a student may paste a
// link to it in a file-sharing service they already use, and their school opens
// the link. VolunTrack stores only the address. Shared with the Log Hours form
// through the `@proofLink` alias (vite.config.js / jsconfig.json), so the form
// and POST|PATCH /api/logs accept exactly the same links.
//
// Only well-known file-sharing sites are accepted, over https: school staff
// click these links, so a student must not be able to send them to any site at
// all (a look-alike sign-in page, a download). Matching is on the hostname
// itself or a subdomain of it, never a substring, so
// "drive.google.com.evil.example" is refused.

export const PROOF_LINK_MAX = 1000

// [host, label] — the label is what the form lists as accepted.
export const PROOF_LINK_HOSTS = [
  ['drive.google.com', 'Google Drive'],
  ['docs.google.com', 'Google Docs'],
  ['photos.google.com', 'Google Photos'],
  ['photos.app.goo.gl', 'Google Photos'],
  ['onedrive.live.com', 'OneDrive'],
  ['1drv.ms', 'OneDrive'],
  ['sharepoint.com', 'OneDrive / SharePoint'],
  ['dropbox.com', 'Dropbox'],
  ['icloud.com', 'iCloud'],
  ['box.com', 'Box'],
]

function hostAllowed(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return PROOF_LINK_HOSTS.some(([allowed]) => host === allowed || host.endsWith(`.${allowed}`))
}

/**
 * Checks a pasted proof link. Returns `{ url }` with the cleaned address, or
 * `{ error }` with a sentence to show. An empty value is `{ url: null }`
 * (no link), which callers treat as "none" or "clear it".
 */
export function cleanProofLink(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return { url: null }
  if (text.length > PROOF_LINK_MAX) return { error: 'That link is too long.' }
  let parsed
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`)
  } catch {
    return { error: 'That doesn\'t look like a link. Copy it from the Share button in Google Drive, OneDrive or Dropbox.' }
  }
  if (parsed.protocol !== 'https:') return { error: 'Use a link that starts with https://.' }
  if (parsed.username || parsed.password) return { error: 'That link can\'t be used.' }
  if (!hostAllowed(parsed.hostname)) {
    return { error: 'Use a link from Google Drive, OneDrive, Dropbox, iCloud or Box.' }
  }
  return { url: parsed.href }
}
