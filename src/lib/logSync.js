// Sync of a student's logs with the server, for authenticated (server-backed)
// accounts only. The create/update/delete helpers are write-through (local →
// server); syncPullLogs goes the other way (server → local) so a freshly
// synced device gets back hours it never held locally. Never throws — a
// failed sync just means that log stays local-only, matching the app's
// existing dual-mode design.

import { keys, read, write } from '@/lib/storage.js'
import { uid } from '@/utils/id.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } : null
}

export async function syncCreateLog(log) {
  const headers = authHeaders()
  if (!headers) return null
  try {
    const res = await fetch(`${apiUrl}/logs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        date: log.date,
        activity: log.activity,
        category: log.category,
        hours: log.hours,
        notes: log.notes,
        location: log.location || null,
        orgName: log.orgName || null,
        orgAddress: log.orgAddress || null,
        orgPhone: log.orgPhone || null,
        supervisorName: log.supervisorName || null,
        supervisorEmail: log.supervisorEmail || null,
        supervisorSignature: log.supervisorSignature || null,
        taskId: log.taskId || null,
        // Pointer to the proof file in the school's own bucket, when one was
        // uploaded there. The server re-verifies it belongs to this student.
        proofKey: log.proofKey || null,
        proofStorageId: log.proofStorageId || null,
        proofMime: log.proofMime || null,
        proofBytes: Number.isInteger(log.proofBytes) ? log.proofBytes : null,
      }),
    })
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
  try {
    await fetch(`${apiUrl}/logs/${serverId}`, { method: 'PATCH', headers, body: JSON.stringify(patch) })
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
      date: row.date,
      activity: row.activity,
      category: row.category ?? '',
      hours: Number(row.hours) || 0,
      notes: row.notes ?? '',
      location: row.location ?? '',
      orgName: row.org_name ?? '',
      orgAddress: row.org_address ?? '',
      orgPhone: row.org_phone ?? '',
      supervisorName: row.supervisor_name ?? '',
      supervisorEmail: row.supervisor_email ?? '',
      supervisorSignature: row.supervisor_signature ?? '',
      verificationStatus: row.verification_status ?? 'none',
      verified: row.verification_status === 'approved',
      taskId: row.task_id ?? '',
      createdAt: row.created_at ?? new Date().toISOString(),
    })
  }
  if (additions.length === 0) return 0

  try {
    write(keys.logs, [...local, ...additions])
  } catch {
    return 0
  }
  return additions.length
}
