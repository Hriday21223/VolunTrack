import { useState, useEffect, useMemo } from 'react'
import { Bell, Plus, Trash2, Power, BellRing, BellOff, Calendar, Repeat, Clock, Pencil } from 'lucide-react'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import { reminderApi } from '@/hooks/useReminders.js'
import { computeNextAt } from '@/lib/scheduler.js'
import { requestNotificationPermission } from '@/hooks/useReminders.js'
import { pushSupported, getPushConfig, currentSubscription, enablePush, disablePush, syncReminders } from '@/lib/push.js'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import { cn } from '@/utils/cn.js'

const KINDS = [
  { value: 'one-off',  label: 'One time' },
  { value: 'daily',    label: 'Daily' },
  { value: 'weekly',   label: 'Weekly' },
  { value: 'monthly',  label: 'Monthly' },
]

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const blank = () => ({
  title: '',
  body: '',
  kind: 'weekly',
  time: '17:00',
  weekday: 5,
  dayOfMonth: 1,
  startDate: '',
  endDate: '',
  enabled: true,
})

export default function Reminders() {
  const [items, setItems] = useState(() => reminderApi.list())
  const [form, setForm] = useState(blank())
  const [editing, setEditing] = useState(null)
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
  const [toast, setToast] = useState(false)
  const [err, setErr] = useState('')

  // Web Push opt-in. Additive: the in-tab runner keeps working regardless,
  // and everything below no-ops when there is no backend or no VAPID keys.
  const [pushCfg, setPushCfg] = useState({ pushEnabled: false, publicKey: null })
  const [pushOn, setPushOn] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)

  // Re-read whenever the page mounts
  useEffect(() => { setItems(reminderApi.list()) }, [])

  useEffect(() => {
    let cancelled = false
    if (!pushSupported()) return undefined
    getPushConfig().then(async (cfg) => {
      if (cancelled) return
      setPushCfg(cfg)
      if (cfg.pushEnabled) setPushOn(Boolean(await currentSubscription()))
    })
    return () => { cancelled = true }
  }, [])

  // Keep the server's mirror in step with local edits, but only once the user
  // has actually opted in — otherwise we would upload reminders for someone
  // who never asked for push.
  useEffect(() => {
    if (!pushOn) return
    syncReminders(items)
  }, [items, pushOn])

  const onTogglePush = async () => {
    setPushBusy(true)
    setErr('')
    try {
      if (pushOn) {
        await disablePush()
        setPushOn(false)
      } else {
        await enablePush(pushCfg.publicKey)
        setPushOn(true)
        // Send the current set immediately so the first reminder can fire
        // without waiting for another edit.
        await syncReminders(reminderApi.list())
      }
    } catch (e) {
      setErr(e.message)
    } finally {
      setPushBusy(false)
    }
  }

  const onChange = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const startEdit = (r) => {
    setEditing(r.id)
    setForm({
      title: r.title, body: r.body || '', kind: r.kind, time: r.time,
      weekday: r.weekday ?? 5, dayOfMonth: r.dayOfMonth ?? 1,
      startDate: r.startDate || '', endDate: r.endDate || '', enabled: r.enabled,
    })
  }

  const cancelEdit = () => { setEditing(null); setForm(blank()); setErr('') }

  const onSubmit = (e) => {
    e.preventDefault()
    setErr('')
    if (!form.title.trim()) { setErr('Give your reminder a title.'); return }
    const payload = { ...form, title: form.title.trim(), body: form.body.trim() }
    if (editing) reminderApi.update(editing, payload)
    else         reminderApi.create(payload)
    setItems(reminderApi.list())
    cancelEdit()
    setToast(true)
  }

  const onDelete = (id) => {
    if (!confirm('Delete this reminder?')) return
    reminderApi.remove(id)
    setItems(reminderApi.list())
  }

  const onToggle = (r) => {
    reminderApi.update(r.id, { enabled: !r.enabled })
    setItems(reminderApi.list())
  }

  const onAskPermission = async () => {
    const result = await requestNotificationPermission()
    setPerm(result)
  }

  return (
    <AppLayout
      title="Reminders"
      subtitle="Nudges to help you log and stay on track."
    >
      <div className="grid lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-1">
          <h3 className="font-display font-semibold mb-1 flex items-center gap-2">
            <BellRing className="w-4 h-4 text-brand-600" />
            {editing ? 'Edit reminder' : 'New reminder'}
          </h3>
          <p className="text-sm text-earth-500 dark:text-earth-400 mb-4">Set when and how often to be reminded.</p>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="label">Title</label>
              <input className="input" placeholder="Log your hours" value={form.title} onChange={(e) => onChange('title', e.target.value)} required />
            </div>
            <div>
              <label className="label">Note (optional)</label>
              <input className="input" placeholder="Take a moment to record this week." value={form.body} onChange={(e) => onChange('body', e.target.value)} />
            </div>

            <div>
              <label className="label">How often</label>
              <div className="grid grid-cols-4 gap-1.5">
                {KINDS.map((k) => (
                  <button
                    key={k.value} type="button"
                    onClick={() => onChange('kind', k.value)}
                    className={cn(
                      'px-2 py-1.5 text-xs font-medium rounded-lg border transition',
                      form.kind === k.value
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white dark:bg-[#0f1a14] border-earth-200 dark:border-[#243529] hover:border-brand-400',
                    )}
                  >{k.label}</button>
                ))}
              </div>
            </div>

            {form.kind === 'weekly' && (
              <div>
                <label className="label">Day of week</label>
                <div className="grid grid-cols-7 gap-1">
                  {WEEKDAYS.map((d, i) => (
                    <button
                      key={d} type="button"
                      onClick={() => onChange('weekday', i)}
                      className={cn(
                        'py-1.5 text-xs font-medium rounded-lg border',
                        form.weekday === i
                          ? 'bg-brand-600 text-white border-brand-600'
                          : 'bg-white dark:bg-[#0f1a14] border-earth-200 dark:border-[#243529]',
                      )}
                    >{d}</button>
                  ))}
                </div>
              </div>
            )}

            {form.kind === 'monthly' && (
              <div>
                <label className="label">Day of month</label>
                <input type="number" min="1" max="31" className="input" value={form.dayOfMonth} onChange={(e) => onChange('dayOfMonth', Number(e.target.value))} />
              </div>
            )}

            {form.kind !== 'one-off' && (
              <div>
                <label className="label">Time of day</label>
                <input type="time" className="input" value={form.time} onChange={(e) => onChange('time', e.target.value)} />
              </div>
            )}

            {form.kind === 'one-off' && (
              <div>
                <label className="label">When</label>
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" className="input" value={form.startDate} onChange={(e) => onChange('startDate', e.target.value)} />
                  <input type="time" className="input" value={form.time} onChange={(e) => onChange('time', e.target.value)} />
                </div>
              </div>
            )}

            <div>
              <label className="label">Window (optional)</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[11px] text-earth-500 dark:text-earth-400 mb-0.5">Starts</div>
                  <input type="date" className="input" value={form.startDate} onChange={(e) => onChange('startDate', e.target.value)} />
                </div>
                <div>
                  <div className="text-[11px] text-earth-500 dark:text-earth-400 mb-0.5">Ends</div>
                  <input type="date" className="input" value={form.endDate} onChange={(e) => onChange('endDate', e.target.value)} />
                </div>
              </div>
            </div>

            {err && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg">{err}</div>}

            <div className="flex gap-2">
              <button type="submit" className="btn-primary flex-1">
                {editing ? 'Save changes' : 'Add reminder'}
              </button>
              {editing && (
                <button type="button" onClick={cancelEdit} className="btn-secondary">Cancel</button>
              )}
            </div>
          </form>
        </Card>

        <div className="lg:col-span-2 space-y-4">
          <Card>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="font-display font-semibold flex items-center gap-2"><Bell className="w-4 h-4 text-brand-600" /> Browser notifications</div>
                <p className="text-sm text-earth-500 dark:text-earth-400 mt-0.5">
                  {perm === 'granted'  && 'Enabled — reminders will pop on your device.'}
                  {perm === 'default'  && 'Not yet requested. We can ask for permission.'}
                  {perm === 'denied'   && 'Blocked in your browser settings. You can re-enable it there.'}
                  {perm === 'unsupported' && 'Your browser does not support notifications. In-app toasts will still fire.'}
                </p>
              </div>
              {perm !== 'granted' && perm !== 'unsupported' && (
                <button onClick={onAskPermission} className="btn-secondary">Enable notifications</button>
              )}
            </div>

            {/* Only offered when the server actually has VAPID keys — the
                in-tab notification above works with no backend at all. */}
            {pushCfg.pushEnabled && pushSupported() && (
              <div className="mt-4 border-t border-earth-100 dark:border-[#1f2e25] pt-4 flex items-start justify-between gap-4">
                <div>
                  <div className="font-display font-semibold">Notify me when VolunTrack is closed</div>
                  <p className="text-sm text-earth-500 dark:text-earth-400 mt-0.5">
                    {pushOn
                      ? 'On — your reminders are synced so we can notify you even with every tab closed.'
                      : 'Reminders above only fire while a VolunTrack tab is open. Turn this on to be notified anyway.'}
                  </p>
                </div>
                <button onClick={onTogglePush} className={pushOn ? 'btn-ghost' : 'btn-secondary'} disabled={pushBusy}>
                  {pushBusy ? 'Working…' : pushOn ? 'Turn off' : 'Turn on'}
                </button>
              </div>
            )}
          </Card>

          {items.length === 0 ? (
            <Card className="text-center py-10 text-earth-500 dark:text-earth-400">
              <BellOff className="w-8 h-8 mx-auto mb-2 text-earth-400" />
              No reminders yet. Add one on the left to get started.
            </Card>
          ) : (
            <ul className="space-y-3">
              {items.map((r) => (
                <ReminderCard
                  key={r.id}
                  r={r}
                  onEdit={() => startEdit(r)}
                  onDelete={() => onDelete(r.id)}
                  onToggle={() => onToggle(r)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      <Toast open={toast} onClose={() => setToast(false)}>
        {editing ? 'Reminder updated' : 'Reminder added'}
      </Toast>
    </AppLayout>
  )
}

function ReminderCard({ r, onEdit, onDelete, onToggle }) {
  const next = useMemo(() => {
    try { return computeNextAt(r) } catch { return null }
  }, [r])
  const summary = useMemo(() => {
    if (r.kind === 'daily')   return `Every day at ${r.time}`
    if (r.kind === 'weekly')  return `Every ${WEEKDAYS[r.weekday ?? 0]} at ${r.time}`
    if (r.kind === 'monthly') return `Day ${r.dayOfMonth} of each month at ${r.time}`
    if (r.startDate) return `${format(parseISO(r.startDate), 'MMM d, yyyy')} at ${r.time}`
    return 'One-time reminder'
  }, [r])

  return (
    <Card className={cn(!r.enabled && 'opacity-60')}>
      <div className="flex items-start gap-3">
        <div className={cn(
          'w-10 h-10 rounded-xl grid place-items-center shrink-0',
          r.enabled ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300' : 'bg-earth-100 text-earth-500 dark:bg-[#243529]',
        )}>
          {r.enabled ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium">{r.title}</div>
          {r.body && <div className="text-sm text-earth-500 dark:text-earth-400">{r.body}</div>}
          <div className="text-xs text-earth-500 dark:text-earth-400 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1"><Repeat className="w-3 h-3" />{summary}</span>
            {next && r.enabled && (
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Next: {formatDistanceToNow(parseISO(next), { addSuffix: true })}</span>
            )}
            {r.endDate && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />Ends {format(parseISO(r.endDate), 'MMM d')}</span>}
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={onToggle} className="p-2 rounded-lg text-earth-500 hover:bg-earth-100 dark:hover:bg-[#1b2a22]" title={r.enabled ? 'Pause' : 'Resume'}>
            <Power className="w-4 h-4" />
          </button>
          <button onClick={onEdit} className="p-2 rounded-lg text-earth-500 hover:bg-earth-100 dark:hover:bg-[#1b2a22]" title="Edit">
            <Pencil className="w-4 h-4" />
          </button>
          <button onClick={onDelete} className="p-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" title="Delete">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </Card>
  )
}
