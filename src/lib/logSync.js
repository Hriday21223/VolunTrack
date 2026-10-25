// Sync of a student's logs with the server, for authenticated (server-backed)
// accounts only. The create/update/delete helpers are write-through (local →
// server); syncPullLogs goes the other way (server → local), on every sign-in,
// so a device gets back hours it never held locally — an app installed after
// a year of logging on the website must not open on 0 hours. Never throws — a
// failed sync just means that log stays local-only, matching the app's
// existing dual-mode design.
//
// A write that fails because the server couldn't be reached (offline, or the
// backend still waking up) is retried by flushLogOutbox() rather than lost:
// a new log is marked syncPending, and edits and deletes wait in an outbox
// kept in local storage. A refusal (4xx) isn't retried — it would fail again.

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
  ['reflection', ['reflection'], (l) => l.reflection || ''],
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

const unreachable = (res) => !res || res.status >= 500

function readOutbox() {
  const box = read(keys.logOutbox, null)
  return { deletes: Array.isArray(box?.deletes) ? box.deletes : [], edits: box?.edits && typeof box.edits === 'object' ? box.edits : {} }
}

function writeOutbox(box) {
  try { write(keys.logOutbox, box) } catch { /* storage full: nothing more we can do */ }
}

// { id, retry }: retry is true when the server couldn't be reached, so the
// caller can mark the log for flushLogOutbox() instead of leaving it local.
export async function createLogOnServer(log) {
  const headers = authHeaders()
  if (!headers) return { id: null, retry: false }
  let res = null
  try {
    res = await fetch(`${apiUrl}/logs`, { method: 'POST', headers, body: JSON.stringify(toServerLog(log)) })
  } catch { /* unreachable */ }
  if (!res || !res.ok) return { id: null, retry: unreachable(res) }
  const body = await res.json().catch(() => ({}))
  return { id: body.id || null, retry: false }
}

export async function syncCreateLog(log) {
  return (await createLogOnServer(log)).id
}

async function sendUpdate(headers, serverId, body) {
  let res = null
  try {
    res = await fetch(`${apiUrl}/logs/${serverId}`, { method: 'PATCH', headers, body: JSON.stringify(body) })
  } catch { /* unreachable */ }
  return !unreachable(res)
}

export async function syncUpdateLog(serverId, patch) {
  const headers = authHeaders()
  if (!headers || !serverId) return
  const body = toServerLog(patch, patch)
  // Nothing the server keeps changed (e.g. a local verification status).
  if (Object.keys(body).length === 0) return
  if (await sendUpdate(headers, serverId, body)) return
  const box = readOutbox()
  box.edits[serverId] = { ...(box.edits[serverId] || {}), ...body }
  writeOutbox(box)
}

async function sendDelete(headers, serverId) {
  let res = null
  try {
    res = await fetch(`${apiUrl}/logs/${serverId}`, { method: 'DELETE', headers })
  } catch { /* unreachable */ }
  return !unreachable(res)
}

export async function syncDeleteLog(serverId) {
  const headers = authHeaders()
  if (!headers || !serverId) return
  if (await sendDelete(headers, serverId)) return
  // Until it lands, syncPullLogs must not bring the entry back from the server.
  const box = readOutbox()
  delete box.edits[serverId]
  if (!box.deletes.includes(serverId)) box.deletes.push(serverId)
  writeOutbox(box)
}

// Retries what couldn't reach the server earlier: logs created while
// unreachable (syncPending), then queued deletes and edits. Returns how many
// local logs changed, so the caller knows to re-read them.
export async function flushLogOutbox() {
  const headers = authHeaders()
  if (!headers) return 0
  let changed = 0
  for (const log of read(keys.logs, []).filter((l) => l.syncPending && !l.serverId)) {
    const { id, retry } = await createLogOnServer(log)
    if (!id && retry) break // still unreachable; try again next time
    const logs = read(keys.logs, [])
    const i = logs.findIndex((l) => l.id === log.id)
    if (i === -1) continue
    logs[i] = { ...logs[i], syncPending: false, ...(id ? { serverId: id } : {}) }
    write(keys.logs, logs)
    changed++
  }
  const box = readOutbox()
  const deletes = []
  for (const serverId of box.deletes) if (!(await sendDelete(headers, serverId))) deletes.push(serverId)
  const edits = {}
  for (const [serverId, body] of Object.entries(box.edits)) if (!(await sendUpdate(headers, serverId, body))) edits[serverId] = body
  writeOutbox({ deletes, edits })
  return changed
}

// Pull the account's logs from the server into local storage. Called right
// after a successful SyncLogin, so a device that just adopted an account
// shows the hours already recorded on it. Best-effort: any failure returns 0
// and leaves local storage untouched — the sync-login itself still succeeds.
//
// Dedup is by serverId: a server row already represented locally (this
// device pushed it, or a previous pull brought it down) isn't added again, so
// re-syncing never duplicates. Its approval is still brought up to date: a
// task organizer's sign-off, or a supervisor's on another device, happens on
// the server, and the device holding the entry otherwise never heard of it. Rows are mapped from the server's snake_case
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
    // Anything but a real list tells us nothing, and is never read as
    // "the server has no logs", which would remove them here (below).
    if (!Array.isArray(body.logs)) return 0
    serverLogs = body.logs
  } catch {
    return 0
  }
  // A delete still waiting in the outbox: the server has the row, this device
  // doesn't want it back.
  const deleting = new Set(readOutbox().deletes)
  serverLogs = serverLogs.filter((row) => !deleting.has(row?.id))
  const local = read(keys.logs, [])
  // An entry the server once held but no longer does was deleted on another
  // device; keeping it here would count those hours on this one forever.
  // Entries that never reached the server (no serverId) are left alone.
  const onServer = new Set(serverLogs.map((row) => row?.id).filter(Boolean))
  const kept = local.filter((l) => !l.serverId || onServer.has(l.serverId))
  const removed = local.length - kept.length
  local.length = 0
  local.push(...kept)
  const known = new Set(local.map((l) => l.serverId).filter(Boolean))
  const additions = []
  // Only a final decision is taken from the server. A request this device sent
  // is 'pending' here before the server row says so, and must not be undone.
  const decided = new Map(serverLogs
    .filter((row) => row?.id && (row.verification_status === 'approved' || row.verification_status === 'rejected'))
    .map((row) => [row.id, row]))
  const updated = []
  for (const l of local) {
    const row = l.serverId && decided.get(l.serverId)
    if (!row || l.verificationStatus === row.verification_status) continue
    l.verificationStatus = row.verification_status
    l.verified = row.verification_status === 'approved'
    l.organizerSigned = Boolean(row.organizerSigned)
    updated.push(l)
  }
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
      reflection: row.reflection ?? '',
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
  if (additions.length === 0 && updated.length === 0 && removed === 0) return 0

  // A task organizer signs in VolunTrack itself, so their signature is the one
  // image that comes back — fetched only for the entries just added or decided.
  const changed = [...additions, ...updated]
  const organizerSigned = changed.filter((l) => l.organizerSigned && !l.supervisorSignature).map((l) => l.serverId)
  if (organizerSigned.length > 0) {
    try {
      const res = await fetch(`${apiUrl}/logs/${userId}/organizer-signatures?ids=${organizerSigned.map(encodeURIComponent).join(',')}`, { headers })
      const { signatures = {} } = res.ok ? await res.json() : {}
      for (const l of changed) if (signatures[l.serverId]) l.supervisorSignature = signatures[l.serverId]
    } catch {
      // The hours still come back; only the signature image is missing.
    }
  }

  try {
    write(keys.logs, [...local, ...additions])
  } catch {
    return 0
  }
  return additions.length + updated.length + removed
}
