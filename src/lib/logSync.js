// Sync of a student's logs with the server, for authenticated (server-backed)
// accounts only. The create/update/delete helpers are write-through (local →
// server); syncPullLogs goes the other way (server → local), on every sign-in,
// so a device gets back hours it never held locally — an app installed after
// a year of logging on the website must not open on 0 hours. Never throws — a
// failed sync just means that log stays local-only, matching the app's
// existing dual-mode design.

import { keys, read, write } from '@/lib/storage.js'
import { uid } from '@/utils/id.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } : null
}

// What the server is sent for a log, and where each value comes from on the
// local entry. One list for create and edit, so a field that should stay on
// this device — the org's address and phone, signature images, proof bytes —
// can't leak through either path just by not being named here (#186).
// [server field, local fields it is derived from, derive]
const SERVER_FIELDS = [
  ['date', ['date'], (l) => l.date],
  ['activity', ['activity'], (l) => l.activity],
  ['category', ['category'], (l) => l.category],
  ['hours', ['hours'], (l) => l.hours],
  ['notes', ['notes'], (l) => l.notes],
  ['location', ['location'], (l) => l.location || null],
  ['orgName', ['orgName'], (l) => l.orgName || null],
  ['supervisorName', ['supervisorName'], (l) => l.supervisorName || null],
  // The server hashes this and keeps only the hash (#186).
  ['supervisorEmail', ['supervisorEmail'], (l) => l.supervisorEmail || null],
  ['taskId', ['taskId'], (l) => l.taskId || null],
  // Pointer to the proof file in the school's own bucket, when one was
  // uploaded there. The server re-verifies it belongs to this student.
  ['proofKey', ['proofKey'], (l) => l.proofKey || null],
  ['proofStorageId', ['proofStorageId'], (l) => l.proofStorageId || null],
  ['proofMime', ['proofMime'], (l) => l.proofMime || null],
  ['proofBytes', ['proofBytes'], (l) => (Number.isInteger(l.proofBytes) ? l.proofBytes : null)],
  // Answers to the school's own questions.
  ['customFields', ['customFields'], (l) => l.customFields || null],
  // Whether a proof file exists at all — without tenant storage the file
  // never leaves this device, so the pointer above is null even when one
  // was attached.
  ['hasLocalProof', ['hasLocalProof', 'proof'], (l) => Boolean(l.hasLocalProof || l.proof)],
  // That the entry was signed, or the school's form sent — never the images.
  ['hasStudentSignature', ['studentSigned', 'studentSignature'], (l) => Boolean(l.studentSigned || l.studentSignature)],
  ['formSubmitted', ['formSubmitted'], (l) => Boolean(l.formSubmitted)],
  ['supervisorSignedInPerson', ['supervisorSignedInPerson'], (l) => Boolean(l.supervisorSignedInPerson)],
]

// `only` limits the body to fields the change touches: PATCH treats a field
// that is present as a new value, so an edit must not send the rest.
function toServerLog(log, only = null) {
  const body = {}
  for (const [field, sources, derive] of SERVER_FIELDS) {
    if (only && !sources.some((k) => Object.hasOwn(only, k))) continue
    body[field] = derive(log)
  }
  return body
}

export async function syncCreateLog(log) {
  const headers = authHeaders()
  if (!headers) return null
  try {
    const res = await fetch(`${apiUrl}/logs`, { method: 'POST', headers, body: JSON.stringify(toServerLog(log)) })
    if (!res.ok) return null
    const body = await res.json().catch(() => ({}))
    return body.id || null
  } catch {
    return null
  }
}

export async function syncUpdateLog(serverId, patch) {
  const headers = authHeaders()
  if (!headers || !serverId) return
  const body = toServerLog(patch, patch)
  // Nothing the server keeps changed (e.g. a local verification status).
  if (Object.keys(body).length === 0) return
  try {
    await fetch(`${apiUrl}/logs/${serverId}`, { method: 'PATCH', headers, body: JSON.stringify(body) })
  } catch {
    // best-effort
  }
}

export async function syncDeleteLog(serverId) {
  const headers = authHeaders()
  if (!headers || !serverId) return
  try {
    await fetch(`${apiUrl}/logs/${serverId}`, { method: 'DELETE', headers })
  } catch {
    // best-effort
  }
}

// Pull the account's logs from the server into local storage. Called right
// after a successful SyncLogin, so a device that just adopted an account
// shows the hours already recorded on it. Best-effort: any failure returns 0
// and leaves local storage untouched — the sync-login itself still succeeds.
//
// Dedup is by serverId: a server row already represented locally (this
// device pushed it, or a previous pull brought it down) is skipped, so
// re-syncing never duplicates. Rows are mapped from the server's snake_case
// columns to the camelCase shape the Log Hours form produces, and each gets
// a fresh local id with the server id kept as serverId — that's what lets a
// later edit/delete on this device sync back through syncUpdateLog /
// syncDeleteLog.
export async function syncPullLogs(userId) {
  const headers = authHeaders()
  if (!headers || !userId) return 0

  let serverLogs
  try {
    const res = await fetch(`${apiUrl}/logs/${userId}`, { headers })
    if (!res.ok) return 0
    const body = await res.json().catch(() => ({}))
    serverLogs = Array.isArray(body.logs) ? body.logs : []
  } catch {
    return 0
  }
  if (serverLogs.length === 0) return 0

  const local = read(keys.logs, [])
  const known = new Set(local.map((l) => l.serverId).filter(Boolean))
  const additions = []
  for (const row of serverLogs) {
    if (!row || !row.id || known.has(row.id)) continue
    known.add(row.id)
    additions.push({
      id: uid('log'),
      serverId: row.id,
      // Older backends sent the DATE column as a full ISO timestamp.
      date: typeof row.date === 'string' ? row.date.slice(0, 10) : row.date,
      activity: row.activity,
      category: row.category ?? '',
      hours: Number(row.hours) || 0,
      notes: row.notes ?? '',
      location: row.location ?? '',
      orgName: row.org_name ?? '',
      supervisorName: row.supervisor_name ?? '',
      // Not restorable: the server holds only a hash of the supervisor's
      // email, and never the org address/phone or a supervisor's signature
      // image. A device that pulls a log back gets the hours, not the
      // paperwork (#186). A task organizer's signature is the exception.
      orgAddress: '',
      orgPhone: '',
      supervisorEmail: '',
      verificationStatus: row.verification_status ?? 'none',
      verified: row.verification_status === 'approved',
      taskId: row.task_id ?? '',
      customFields: row.customFields ?? {},
      // The image isn't restorable either, but that the entry was signed is.
      studentSignature: '',
      studentSigned: Boolean(row.studentSigned),
      formSubmitted: Boolean(row.formSubmitted),
      supervisorSignedInPerson: Boolean(row.supervisorSignedInPerson),
      // Filled in below for an organizer's sign-off, the one restorable image.
      supervisorSignature: '',
      organizerSigned: Boolean(row.organizerSigned),
      importedTranscriptId: row.importedTranscriptId ?? '',
      createdAt: row.created_at ?? new Date().toISOString(),
    })
  }
  if (additions.length === 0) return 0

  // A task organizer signs in VolunTrack itself, so their signature is the one
  // image that comes back — fetched only for the entries just added.
  const organizerSigned = additions.filter((l) => l.organizerSigned).map((l) => l.serverId)
  if (organizerSigned.length > 0) {
    try {
      const res = await fetch(`${apiUrl}/logs/${userId}/organizer-signatures?ids=${organizerSigned.map(encodeURIComponent).join(',')}`, { headers })
      const { signatures = {} } = res.ok ? await res.json() : {}
      for (const l of additions) if (signatures[l.serverId]) l.supervisorSignature = signatures[l.serverId]
    } catch {
      // The hours still come back; only the signature image is missing.
    }
  }

  try {
    write(keys.logs, [...local, ...additions])
  } catch {
    return 0
  }
  return additions.length
}
