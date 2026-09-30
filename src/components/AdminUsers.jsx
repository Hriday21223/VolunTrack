import { useState } from 'react'
import { Search, Trash2, AlertTriangle } from 'lucide-react'
import Card from '@/components/Card.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders(extra = {}) {
  const token = localStorage.getItem('voluntrack:auth_token')
  return { Authorization: `Bearer ${token}`, ...extra }
}

// Admin "Users" tab: find one account by exact email and, for the roles that
// may be erased (student, volunteer, parent), delete it. There is no list on
// purpose — see GET /api/auth/admin/users.
export default function AdminUsers() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const [found, setFound] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmEmail, setConfirmEmail] = useState('')

  const lookup = async (e) => {
    e.preventDefault()
    setErr('')
    setNotice('')
    setFound(null)
    setConfirming(false)
    setConfirmEmail('')
    setBusy(true)
    try {
      const res = await fetch(`${apiUrl}/auth/admin/users?email=${encodeURIComponent(email.trim())}`, {
        headers: authHeaders(),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Lookup failed')
      setFound(data.user)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setErr('')
    setBusy(true)
    try {
      const res = await fetch(`${apiUrl}/auth/admin/users/${encodeURIComponent(found.id)}`, {
        method: 'DELETE',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ email: confirmEmail.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      setNotice(`Deleted ${found.email}.`)
      setFound(null)
      setConfirming(false)
      setConfirmEmail('')
      setEmail('')
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const confirmMatches = found && confirmEmail.trim().toLowerCase() === found.email.toLowerCase()

  return (
    <Card>
      <form onSubmit={lookup} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="label" htmlFor="admin-user-email">Find an account by email</label>
          <input
            id="admin-user-email" type="email" required autoComplete="off"
            className="input" placeholder="student@example.com"
            value={email} onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>
          <Search className="w-4 h-4" /> Look up
        </button>
      </form>

      {err && <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{err}</div>}
      {notice && <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">{notice}</div>}

      {found && (
        <div className="mt-5 rounded-xl border border-earth-500/20 p-4">
          <div className="font-semibold">{found.name || '(no name)'}</div>
          <div className="text-sm opacity-80">{found.email}</div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <div><dt className="opacity-60">Role</dt><dd className="capitalize">{found.role.replace('_', ' ')}</dd></div>
            <div><dt className="opacity-60">Joined</dt><dd>{new Date(found.createdAt).toLocaleDateString()}</dd></div>
            <div><dt className="opacity-60">School</dt><dd>{found.schoolName || '—'}</dd></div>
            <div><dt className="opacity-60">Hour logs</dt><dd>{found.logCount}</dd></div>
          </dl>

          {!found.deletable ? (
            <p className="mt-4 text-sm opacity-80">
              {found.role === 'admin' ? 'Admin' : 'School, organization, and staff'} accounts can&apos;t be deleted here — their records need transferring or closing first.
            </p>
          ) : !confirming ? (
            <button type="button" className="btn-ghost mt-4 text-red-400" onClick={() => setConfirming(true)}>
              <Trash2 className="w-4 h-4" /> Delete account
            </button>
          ) : (
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
              <div className="flex items-start gap-2 text-sm text-red-400">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  This permanently deletes the account and everything attached to it — {found.logCount} hour
                  log{found.logCount === 1 ? '' : 's'}, goals, and parent links. It can&apos;t be undone.
                  The deletion is recorded in the audit trail.
                </span>
              </div>
              <label className="label mt-3" htmlFor="admin-user-confirm">Type <strong>{found.email}</strong> to confirm</label>
              <input
                id="admin-user-confirm" type="text" autoComplete="off" className="input"
                value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)}
              />
              <div className="mt-3 flex gap-2">
                <button type="button" className="btn-primary bg-red-600 hover:bg-red-700" disabled={busy || !confirmMatches} onClick={remove}>
                  <Trash2 className="w-4 h-4" /> {busy ? 'Deleting…' : 'Delete permanently'}
                </button>
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => { setConfirming(false); setConfirmEmail('') }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
