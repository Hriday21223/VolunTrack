import { useState, useEffect, useCallback } from 'react'
import { MapPin, Calendar as CalIcon, CheckCircle, XCircle, MinusCircle, Clock3, ClipboardList } from 'lucide-react'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import { format } from 'date-fns'
import { fmtDate } from '@/utils/date.js'
import CancelSignup from '@/components/CancelSignup.jsx'
import Toast from '@/components/Toast.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

// Task dates are calendar days (YYYY-MM-DD); compare them as days in the
// viewer's own timezone, never as UTC instants.
const todayDay = () => format(new Date(), 'yyyy-MM-dd')
const dayOf = (date) => String(date || '').slice(0, 10)

const SIGNUP_LABELS = {
  approved: { label: 'Approved', className: 'bg-emerald-500/10 text-emerald-400' },
  pending: { label: 'Pending approval', className: 'bg-amber-500/10 text-amber-400' },
  rejected: { label: 'Rejected', className: 'bg-red-500/10 text-red-400' },
  waitlisted: { label: 'Waitlist', className: 'bg-sky-500/10 text-sky-300' },
}
const CANCELLED_LABEL = { label: 'Cancelled', className: 'bg-earth-500/10 text-earth-400' }

const ATTENDANCE_META = {
  present: { label: 'Present', icon: CheckCircle, className: 'text-emerald-400' },
  absent: { label: 'Absent', icon: XCircle, className: 'text-red-400' },
  excused: { label: 'Excused', icon: MinusCircle, className: 'text-amber-400' },
}

function SignupRow({ s, onChanged }) {
  const cancelled = s.task_status === 'cancelled'
  const signup = cancelled ? CANCELLED_LABEL : (SIGNUP_LABELS[s.signup_status] || SIGNUP_LABELS.pending)
  const attendance = !cancelled && s.attendance_status ? ATTENDANCE_META[s.attendance_status] : null
  const isPast = dayOf(s.date) < todayDay()

  return (
    <Card padded={false} className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{s.title}</p>
          {s.creator_name && <p className="text-xs text-earth-500 mt-0.5">Posted by {s.creator_name}</p>}
          <div className="flex flex-wrap gap-3 mt-2 text-xs text-earth-500">
            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {s.location}</span>
            <span className="flex items-center gap-1"><CalIcon className="w-3 h-3" /> {fmtDate(dayOf(s.date))}{s.time ? ` · ${s.time}` : ''}</span>
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${signup.className}`}>{signup.label}{!cancelled && s.signup_status === 'waitlisted' && s.waitlist_position ? ` #${s.waitlist_position}` : ''}</span>
          {attendance ? (
            <span className={`text-xs flex items-center gap-1 font-medium ${attendance.className}`}>
              <attendance.icon className="w-3.5 h-3.5" /> {attendance.label}
            </span>
          ) : !cancelled && s.signup_status === 'approved' && isPast ? (
            <span className="text-xs flex items-center gap-1 text-earth-500">
              <Clock3 className="w-3.5 h-3.5" /> Not marked yet
            </span>
          ) : null}
          {!cancelled && !isPast && !s.attendance_status && ['pending', 'approved', 'waitlisted'].includes(s.signup_status) && (
            <CancelSignup task={s} onDone={(msg) => onChanged?.(msg)} onError={(msg) => onChanged?.(msg, true)} />
          )}
        </div>
      </div>
    </Card>
  )
}

export default function Attendance() {
  const [signups, setSignups] = useState([])
  const [loading, setLoading] = useState(true)
  const [toastMsg, setToastMsg] = useState('')
  const changed = (msg, failed) => { setToastMsg(msg); if (!failed) load() }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('voluntrack:auth_token')
      const res = await fetch(`${apiUrl}/school/public-tasks/signups/mine`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) { const d = await res.json(); setSignups(d.signups || []) }
    } catch {} finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const today = todayDay()
  // A cancelled task is never upcoming, even when its date is still ahead.
  const isUpcoming = (s) => s.task_status !== 'cancelled' && dayOf(s.date) >= today
  const upcoming = signups.filter(isUpcoming)
  const past = signups.filter((s) => !isUpcoming(s))

  return (
    <AppLayout title="Attendance" subtitle="Your signup and attendance status across tasks">
      <div className="max-w-3xl mx-auto space-y-6">
        {loading ? (
          <Card><p className="text-center text-earth-500 py-8">Loading…</p></Card>
        ) : signups.length === 0 ? (
          <Card>
            <div className="text-center py-12 text-earth-500">
              <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-earth-900 dark:text-earth-100">No signups yet</p>
              <p className="text-sm mt-1">Sign up for a volunteer opportunity from the dashboard to see your attendance here.</p>
            </div>
          </Card>
        ) : (
          <>
            {upcoming.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-medium text-earth-400 uppercase tracking-wider">Upcoming</p>
                {upcoming.map((s) => <SignupRow key={s.id} s={s} onChanged={changed} />)}
              </div>
            )}
            {past.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-medium text-earth-400 uppercase tracking-wider">Past</p>
                {past.map((s) => <SignupRow key={s.id} s={s} onChanged={changed} />)}
              </div>
            )}
          </>
        )}
      </div>
      <Toast open={Boolean(toastMsg)} onClose={() => setToastMsg('')}>{toastMsg}</Toast>
    </AppLayout>
  )
}
