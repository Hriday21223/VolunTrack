import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, UserPlus, History, Copy, Check, RefreshCw } from 'lucide-react'
import Card from '@/components/Card.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'
const base = `${apiUrl}/admin/team`
const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('voluntrack:auth_token')}` })

const when = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

// Admin → Users (#909), main admin only: invite more admins, remove them, and
// read what every admin did. Other admins don't see this card.
export default function AdminTeamCard() {
  const [team, setTeam] = useState(null)
  const [err, setErr] = useState('')
  const [form, setForm] = useState({ name: '', email: '', permissions: [] })
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(null) // { emailSent, link }
  const [copied, setCopied] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [activity, setActivity] = useState([])
  const [who, setWho] = useState('')
  const [loadingLog, setLoadingLog] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { headers: headers() })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not load the admin team.')
      setTeam(d)
    } catch (e) { setErr(e.message) }
  }, [])

  const loadLog = useCallback(async (adminId) => {
    setLoadingLog(true)
    try {
      const q = adminId ? `?adminId=${encodeURIComponent(adminId)}` : ''
      const res = await fetch(`${base}/activity${q}`, { headers: headers() })
      const d = await res.json().catch(() => ({}))
      if (res.ok) setActivity(d.activity || [])
    } finally { setLoadingLog(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (team?.isMain) loadLog(who) }, [team?.isMain, who, loadLog])

  if (!team?.isMain) return null

  const invite = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(''); setSent(null); setCopied(false)
    try {
      const res = await fetch(`${base}/invite`, { method: 'POST', headers: headers(), body: JSON.stringify(form) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not send the invite.')
      setSent(d); setForm({ name: '', email: '', permissions: [] })
      load()
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  const remove = async (id) => {
    setConfirmRemove(null)
    const res = await fetch(`${base}/${id}`, { method: 'DELETE', headers: headers() })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) setErr(d.error || 'Could not remove the admin.')
    load()
  }

  // Which parts of the panel an admin may use (#911). Saved at once.
  const setPermissions = async (id, permissions) => {
    setTeam((t) => ({ ...t, admins: t.admins.map((a) => (a.id === id ? { ...a, permissions } : a)) }))
    const res = await fetch(`${base}/${id}/permissions`, { method: 'PUT', headers: headers(), body: JSON.stringify({ permissions }) })
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error || 'Could not save the access.'); load() }
  }
  const toggle = (list, area) => (list.includes(area) ? list.filter((a) => a !== area) : [...list, area])
  const Areas = ({ value, onChange }) => (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
      {Object.entries(team.areas || {}).map(([id, label]) => (
        <label key={id} className="flex items-center gap-1.5 text-xs text-earth-300">
          <input type="checkbox" checked={value.includes(id)} onChange={() => onChange(toggle(value, id))} /> {label}
        </label>
      ))}
    </div>
  )

  const cancelInvite = async (id) => {
    await fetch(`${base}/invite/${id}`, { method: 'DELETE', headers: headers() })
    load()
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(sent.link); setCopied(true) } catch { /* selectable */ }
  }

  return (
    <Card>
      <h3 className="font-display font-semibold mb-1 flex items-center gap-2"><ShieldCheck className="w-4 h-4" aria-hidden="true" /> Admin team</h3>
      <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">
        Only you, the main admin, see this. Invited admins choose their own password and must set up two-step sign-in the first time they sign in. Removing one signs them out everywhere at once.
      </p>

      <ul className="divide-y divide-earth-200 dark:divide-earth-800 mb-4">
        {team.admins.map((a) => (
          <li key={a.id} className="py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{a.name}{a.main && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-brand-500/15 text-brand-300">Main admin</span>}</p>
              <p className="text-xs text-earth-500">{a.email} · {a.twoStep ? 'Two-step on' : 'Two-step not set up yet'}{a.main ? ' · Can use everything' : ''}</p>
              {!a.main && <Areas value={a.permissions || []} onChange={(p) => setPermissions(a.id, p)} />}
            </div>
            {!a.main && (confirmRemove === a.id ? (
              <span className="flex gap-1">
                <button onClick={() => remove(a.id)} className="btn-sm bg-red-600 text-white hover:bg-red-700">Remove</button>
                <button onClick={() => setConfirmRemove(null)} className="btn-sm btn-ghost">Keep</button>
              </span>
            ) : (
              <button onClick={() => setConfirmRemove(a.id)} className="text-xs text-red-400 hover:text-red-300">Remove</button>
            ))}
          </li>
        ))}
        {team.invites.map((i) => (
          <li key={i.id} className="py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{i.name} <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">Invited</span></p>
              <p className="text-xs text-earth-500">{i.email} · link expires {new Date(i.expiresAt).toLocaleDateString()}</p>
            </div>
            <button onClick={() => cancelInvite(i.id)} className="text-xs text-earth-400 hover:text-earth-200">Cancel invite</button>
          </li>
        ))}
      </ul>

      <form onSubmit={invite} className="flex flex-wrap gap-2 items-end mb-2">
        <div className="flex-1 min-w-[10rem]">
          <label className="label" htmlFor="at-name">Name</label>
          <input id="at-name" className="input" maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="flex-1 min-w-[14rem]">
          <label className="label" htmlFor="at-email">Email</label>
          <input id="at-email" type="email" className="input" maxLength={254} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="basis-full">
          <p className="text-xs text-earth-400">What they can use:</p>
          <Areas value={form.permissions} onChange={(p) => setForm({ ...form, permissions: p })} />
        </div>
        <button type="submit" disabled={busy || !form.name.trim() || !form.email.trim() || form.permissions.length === 0} className="btn-primary btn-sm">
          <UserPlus className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> {busy ? 'Inviting…' : 'Invite admin'}
        </button>
      </form>
      {sent && (
        <div className="text-sm rounded-xl bg-brand-500/10 border border-brand-500/30 p-3 mb-2">
          <p>{sent.emailSent ? 'Invite emailed.' : 'The email didn’t go out, so send them this link yourself.'} The link works once and expires in 7 days.</p>
          <div className="flex gap-2 mt-2 items-center">
            <code className="text-xs break-all flex-1 select-all">{sent.link}</code>
            <button type="button" onClick={copy} className="btn-ghost btn-sm shrink-0">{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}</button>
          </div>
        </div>
      )}
      {err && <p role="alert" className="text-sm text-red-500 mb-2">{err}</p>}

      <div className="mt-6 border-t border-earth-200 dark:border-earth-800 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h4 className="font-semibold flex items-center gap-2"><History className="w-4 h-4" aria-hidden="true" /> What admins did</h4>
          <div className="flex items-center gap-2">
            <select className="input py-1 text-sm w-auto" aria-label="Show activity for" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Everyone</option>
              {team.admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button onClick={() => loadLog(who)} className="text-xs text-earth-400 hover:text-earth-200 inline-flex items-center gap-1">
              <RefreshCw className={`w-3 h-3 ${loadingLog ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </div>
        {activity.length === 0 ? (
          <p className="text-sm text-earth-400">Nothing yet.</p>
        ) : (
          <ul className="space-y-1 max-h-96 overflow-y-auto text-sm">
            {activity.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-x-3 py-1 border-b border-earth-200/40 dark:border-earth-800/60">
                <span className="text-earth-500 w-28 shrink-0">{when(a.at)}</span>
                <span className="font-medium w-36 shrink-0 truncate">{a.who}</span>
                <span className={a.ok ? '' : 'text-red-400'}>{a.label}{a.ok ? '' : ' (failed)'}</span>
                <span className="text-xs text-earth-500 font-mono truncate">{a.method} {a.path}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-earth-500 mt-2">Kept for a year. Only the page or action is recorded, never what was typed.</p>
      </div>
    </Card>
  )
}
