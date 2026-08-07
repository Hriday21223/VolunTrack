// Write-through sync of a student's goals to the server, for authenticated
// (server-backed) accounts only. Never throws — a failed sync just means
// that goal stays local-only, matching the same dual-mode design as
// src/lib/logSync.js. The local goal shape (title/targetHours/primary)
// differs from the server's column names (label/target/is_primary), so the
// mapping happens here rather than pushing that translation up into
// useData.jsx.

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } : null
}

export async function syncCreateGoal(goal) {
  const headers = authHeaders()
  if (!headers) return null
  try {
    const res = await fetch(`${apiUrl}/goals`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        label: goal.title,
        target: goal.targetHours,
        period: goal.period || null,
        deadline: goal.deadline || null,
        isPrimary: Boolean(goal.primary),
      }),
    })
    if (!res.ok) return null
    const body = await res.json().catch(() => ({}))
    return body.id || null
  } catch {
    return null
  }
}

export async function syncUpdateGoal(serverId, patch) {
  const headers = authHeaders()
  if (!headers || !serverId) return
  const body = {}
  if (patch.title !== undefined) body.label = patch.title
  if (patch.targetHours !== undefined) body.target = patch.targetHours
  if (patch.period !== undefined) body.period = patch.period
  if (patch.deadline !== undefined) body.deadline = patch.deadline
  if (patch.primary !== undefined) body.isPrimary = Boolean(patch.primary)
  try {
    await fetch(`${apiUrl}/goals/${serverId}`, { method: 'PATCH', headers, body: JSON.stringify(body) })
  } catch {
    // best-effort
  }
}

export async function syncDeleteGoal(serverId) {
  const headers = authHeaders()
  if (!headers || !serverId) return
  try {
    await fetch(`${apiUrl}/goals/${serverId}`, { method: 'DELETE', headers })
  } catch {
    // best-effort
  }
}
