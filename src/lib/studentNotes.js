// Private adviser notes on a student (#567). server/routes/school.js.

const apiUrl = import.meta.env.VITE_API_URL || '/api'

export async function notesCall(path, { method = 'GET', body } = {}) {
  let token = null
  try { token = localStorage.getItem('voluntrack:auth_token') } catch { /* private mode */ }
  const res = await fetch(`${apiUrl}/school${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.')
  return data
}

export const fetchNoteCounts = () => notesCall('/student-notes/counts').then((d) => d.counts || {}).catch(() => ({}))
