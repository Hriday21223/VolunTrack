// Personal goals, synced with the server (server/routes/goals.js) so a goal set
// on one device shows on the others. For signed-in accounts only; goals are
// still kept locally too, so the app works offline.
//
// The whole list goes up on every change. If that fails (offline, server
// asleep) the list is marked unsent, and the next sync sends it before reading
// anything back, so a change made offline isn't replaced by the server's older
// copy. Otherwise the server's list wins, which is how a new device gets them.

import { keys, read, write } from '@/lib/storage.js'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } : null
}

function toServer(goals) {
  return goals.map((g) => ({
    id: g.id,
    title: g.title,
    targetHours: Number(g.targetHours) || 0,
    deadline: g.deadline || null,
    primary: Boolean(g.primary),
    createdAt: g.createdAt || null,
  }))
}

// Uploads go one at a time, each sending the list as it is when its turn
// comes: changes made in a burst ("make primary" saves every goal) can't land
// out of order and leave the server on an older list.
let queue = Promise.resolve(true)

async function sendLatest() {
  const headers = authHeaders()
  if (!headers) return false
  try {
    const goals = read(keys.goals, [])
    const res = await fetch(`${apiUrl}/goals`, { method: 'PUT', headers, body: JSON.stringify({ goals: toServer(goals) }) })
    if (res.ok) {
      write(keys.goalsUnsent, false)
      return true
    }
  } catch { /* unreachable */ }
  write(keys.goalsUnsent, true)
  return false
}

// Returns true once the server has the current list.
export function pushGoals() {
  if (!authHeaders()) return Promise.resolve(false)
  queue = queue.then(sendLatest, sendLatest)
  return queue
}

// Brings this device and the server into line. Returns true when the local
// list changed, so the caller re-reads it.
export async function syncGoals() {
  const headers = authHeaders()
  if (!headers) return false
  const local = read(keys.goals, [])
  if (read(keys.goalsUnsent, false)) {
    await pushGoals()
    return false
  }
  let server
  try {
    const res = await fetch(`${apiUrl}/goals`, { headers })
    if (!res.ok) return false
    const body = await res.json()
    if (!Array.isArray(body.goals)) return false
    server = body.goals
  } catch {
    return false
  }
  // First sync for an account whose goals so far lived only on this device.
  if (server.length === 0) {
    if (local.length > 0) await pushGoals()
    return false
  }
  write(keys.goals, server)
  return true
}
