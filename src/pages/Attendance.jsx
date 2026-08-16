import { useState, useEffect, useCallback } from 'react'
import { MapPin, Calendar as CalIcon, CheckCircle, XCircle, MinusCircle, Clock3, ClipboardList } from 'lucide-react'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

const SIGNUP_LABELS = {
  approved: { label: 'Approved', className: 'bg-emerald-500/10 text-emerald-400' },
  pending: { label: 'Pending approval', className: 'bg-amber-500/10 text-amber-400' },
  rejected: { label: 'Rejected', className: 'bg-red-500/10 text-red-400' },
}

const ATTENDANCE_META = {
  present: { label: 'Present', icon: CheckCircle, className: 'text-emerald-400' },
  absent: { label: 'Absent', icon: XCircle, className: 'text-red-400' },
  excused: { label: 'Excused', icon: MinusCircle, className: 'text-amber-400' },
}

function SignupRow({ s }) {
  const signup = SIGNUP_LABELS[s.signup_status] || SIGNUP_LABELS.pending
  const attendance = s.attendance_status ? ATTENDANCE_META[s.attendance_status] : null
  const isPast = new Date(s.date) < new Date().setHours(0, 0, 0, 0)

  return (
    <Card padded={false} className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{s.title}</p>
          {s.creator_name && <p className="text-xs text-earth-500 mt-0.5">Posted by {s.creator_name}</p>}
          <div className="flex flex-wrap gap-3 mt-2 text-xs text-earth-500">
            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {s.location}</span>
            <span className="flex items-center gap-1"><CalIcon className="w-3 h-3" /> {new Date(s.date).toLocaleDateString()}{s.time ? ` · ${s.time}` : ''}</span>
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${signup.className}`}>{signup.label}</span>
          {attendance ? (
            <span className={`text-xs flex items-center gap-1 font-medium ${attendance.className}`}>
              <attendance.icon className="w-3.5 h-3.5" /> {attendance.label}
            </span>
          ) : s.signup_status === 'approved' && isPast ? (
            <span className="text-xs flex items-center gap-1 text-earth-500">
              <Clock3 className="w-3.5 h-3.5" /> Not marked yet
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  )
}

export default function Attendance() {
  const [signups, setSignups] = useState([])
  const [loading, setLoading] = useState(true)

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

  const today = new Date().setHours(0, 0, 0, 0)
  const upcoming = signups.filter((s) => new Date(s.date) >= today)
  const past = signups.filter((s) => new Date(s.date) < today)

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
                {upcoming.map((s) => <SignupRow key={s.id} s={s} />)}
              </div>
            )}
            {past.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-medium text-earth-400 uppercase tracking-wider">Past</p>
                {past.map((s) => <SignupRow key={s.id} s={s} />)}
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  )
}
