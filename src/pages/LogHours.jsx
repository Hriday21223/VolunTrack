import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Save, Trash2, Upload, Mail, User, FileSignature, ShieldCheck, MapPin, Navigation } from 'lucide-react'
import { useData } from '@/hooks/useData.jsx'
import { useAuth } from '@/hooks/useAuth.jsx'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import FileDrop from '@/components/FileDrop.jsx'
import Toast from '@/components/Toast.jsx'
import { ACTIVITY_CATEGORIES, categoryColor } from '@/lib/categories.js'
import { hoursBetween, fmtHours } from '@/utils/date.js'
import { notifySupervisor } from '@/lib/supervisorNotify.js'
import VerificationBadge from '@/components/VerificationBadge.jsx'
import { format } from 'date-fns'

// Rotating appreciation notes for the student once a supervisor approves.
// Built as opener x closer combinations (10 x 10 = 100 unique notes) rather
// than 100 flat strings, so the pool stays reviewable while rarely repeating.
const STUDENT_THANKS_OPENERS = [
  'Nice work — your supervisor confirmed this entry',
  'Verified',
  "Great job — that one's confirmed",
  'Confirmed by your supervisor',
  'That entry just got the green light',
  'Your supervisor signed off on this one',
  'Locked in — this entry is now verified',
  'One more verified entry in the books',
  'Solid — your supervisor backed this one up',
  'Officially confirmed',
]
const STUDENT_THANKS_CLOSERS = [
  'Keep it up!',
  'that entry now carries extra weight on reports and transcripts.',
  'your hours are adding up.',
  'nice consistency.',
  'that record is looking strong.',
  "verified hours like this are what colleges and scholarships actually check.",
  'keep logging like this.',
  'this is exactly what a clean record looks like.',
  "that's one less thing to worry about at report time.",
  'well earned.',
]

function pickComboSimple(openers, closers) {
  const opener = openers[Math.floor(Math.random() * openers.length)]
  const closer = closers[Math.floor(Math.random() * closers.length)]
  return `${opener} — ${closer}`
}

const blank = () => ({
  activity: '',
  category: ACTIVITY_CATEGORIES[0],
  date: format(new Date(), 'yyyy-MM-dd'),
  startTime: '',
  endTime: '',
  location: '',
  notes: '',
  supervisorName: '',
  supervisorEmail: '',
  supervisorSignature: '',
  proof: null,
  verified: false,
  verificationStatus: 'none',
  verificationToken: null,
})

export default function LogHours({ editId, onCloseEdit }) {
  const { logs, addLog, editLog, removeLog } = useData()
  const { user } = useAuth()
  const nav = useNavigate()
  const [form, setForm] = useState(blank())
  const [toast, setToast] = useState(false)
  const [error, setError] = useState('')
  const [locating, setLocating] = useState(false)
  const [locError, setLocError] = useState('')
  // Re-rolled per log entry (editId/verificationToken), not on every
  // render — the picker itself doesn't read these, it just gates when a
  // fresh random note should be picked.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const studentThanksNote = useMemo(() => pickComboSimple(STUDENT_THANKS_OPENERS, STUDENT_THANKS_CLOSERS), [editId, form.verificationToken])

  useEffect(() => {
    if (editId) {
      const log = logs.find((l) => l.id === editId)
      if (log) setForm({ ...blank(), ...log })
    }
  }, [editId, logs])

  const hours = hoursBetween(
    form.date && form.startTime ? `${form.date}T${form.startTime}:00` : null,
    form.date && form.endTime   ? `${form.date}T${form.endTime}:00`   : null,
  )

  const onChange = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.activity.trim()) { setError('Please enter an activity name.'); return }
    if (!form.location.trim()) { setError('Please enter a location or use the button below to detect it.'); return }
    if (hours <= 0)             { setError('End time must be after start time.'); return }

    try {
      const payload = { ...form, hours }
      if (editId) {
        editLog(editId, payload)
        setToast(true)
        onCloseEdit?.()
      } else {
        const created = addLog(payload)
        setForm(blank())
        setToast(true)
        if (payload.supervisorEmail?.trim()) {
          const serverId = await created.whenSynced.catch(() => null)
          notifySupervisor({
            supervisorEmail: payload.supervisorEmail,
            supervisorName: payload.supervisorName,
            studentName: user?.name || 'A VolunTrack student',
            studentEmail: user?.email || null,
            hours: payload.hours,
            activity: payload.activity,
            logId: serverId,
          }).then((result) => {
            if (result.token) {
              editLog(created.id, { verificationStatus: 'pending', verificationToken: result.token })
            }
          })
        }
      }
    } catch (err) {
      setError('Could not save — your proof file might be too large. Try a smaller image.')
    }
  }

  const getCurrentLocation = async () => {
    setLocating(true)
    setLocError('')
    try {
      if (!navigator.geolocation) {
        throw new Error('Geolocation is not supported by your browser.')
      }
      const getPosition = (options) => new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, options)
      })
      let position
      try {
        // Standard accuracy first — fast, and works on desktops without GPS
        // hardware (Wi-Fi/IP based). High accuracy alone often times out on
        // those devices while it waits for a GPS fix that never comes.
        position = await getPosition({ enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 })
      } catch {
        position = await getPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
      }

      const { latitude, longitude } = position.coords
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
        {
          headers: {
            'Accept-Language': 'en',
            'User-Agent': 'VolunTrack/1.0',
          },
        }
      )

      if (!response.ok) {
        throw new Error('Failed to look up address.')
      }

      const data = await response.json()
      const address = data.display_name || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
      setForm((f) => ({ ...f, location: address }))
    } catch (err) {
      setLocError(err.message || 'Could not get your location.')
    } finally {
      setLocating(false)
    }
  }

  return (
    <AppLayout
      title={editId ? 'Edit volunteer hours' : 'Log volunteer hours'}
      subtitle="Capture the who, what, when, and where of your service."
    >
      <form onSubmit={onSubmit} className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Card>
            <SectionTitle>Activity</SectionTitle>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">What did you do? *</label>
                <input
                  className="input"
                  placeholder="Park cleanup, food drive, tutoring…"
                  value={form.activity} onChange={onChange('activity')} required
                />
              </div>
              <div>
                <label className="label">Category</label>
                <select className="input" value={form.category} onChange={onChange('category')}>
                  {ACTIVITY_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <div className="mt-2">
                  <span className={`chip ${categoryColor(form.category)}`}>{form.category}</span>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <SectionTitle>When</SectionTitle>
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="label">Date *</label>
                <input className="input" type="date" required value={form.date} onChange={onChange('date')} />
              </div>
              <div>
                <label className="label">Start time *</label>
                <input className="input" type="time" required value={form.startTime} onChange={onChange('startTime')} />
              </div>
              <div>
                <label className="label">End time *</label>
                <input className="input" type="time" required value={form.endTime} onChange={onChange('endTime')} />
              </div>
            </div>
            <div className="mt-4 text-sm text-earth-600 dark:text-earth-300">
              Duration: <span className="font-semibold text-brand-700 dark:text-brand-300">{fmtHours(hours)}</span>
            </div>
          </Card>

          <Card>
            <SectionTitle>Where</SectionTitle>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Location *</label>
                <div className="flex gap-2">
                  <input
                    className="input flex-1"
                    placeholder="123 Main St, Library, Online, etc."
                    value={form.location}
                    onChange={onChange('location')}
                    required
                  />
                  <button
                    type="button"
                    onClick={getCurrentLocation}
                    disabled={locating}
                    className="btn-ghost inline-flex items-center gap-1.5 whitespace-nowrap"
                    title="Use current location"
                  >
                    <Navigation className={`w-4 h-4 ${locating ? 'animate-spin' : ''}`} />
                    {locating ? 'Locating…' : 'Current'}
                  </button>
                </div>
                {locError && <div className="text-xs text-red-600 mt-1">{locError}</div>}
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea className="input min-h-[100px] resize-y" placeholder="Anything worth remembering…" value={form.notes} onChange={onChange('notes')} />
              </div>
            </div>
          </Card>

          <Card>
            <SectionTitle icon={ShieldCheck}>Supervisor verification</SectionTitle>
            <p className="text-sm text-earth-500 dark:text-earth-400 -mt-2 mb-4">
              Capture who can vouch for this work. Schools typically require a name and email.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field icon={User}        label="Supervisor name"  value={form.supervisorName} onChange={onChange('supervisorName')} placeholder="Mr. Johnson" />
              <Field icon={Mail}        label="Supervisor email" value={form.supervisorEmail} onChange={onChange('supervisorEmail')} placeholder="johnson@school.edu" type="email" />
              <div className="sm:col-span-2">
                <label className="label flex items-center gap-1.5"><FileSignature className="w-4 h-4" /> Digital signature (typed name)</label>
                <input className="input" placeholder="Type your full name to sign" value={form.supervisorSignature} onChange={onChange('supervisorSignature')} />
                <div className="hint">By typing your name, you confirm this work was completed as described.</div>
              </div>
              {form.supervisorEmail?.trim() ? (
                <div className="sm:col-span-2">
                  <VerificationBadge status={form.verificationStatus} />
                  {(!form.verificationStatus || form.verificationStatus === 'none') && (
                    <p className="text-xs text-earth-400 mt-1">
                      Verification is set by your supervisor, not by you — they'll get an email with an approve/reject link once you save. This usually takes a day or two.
                    </p>
                  )}
                  {form.verificationStatus === 'approved' && (
                    <p className="text-xs text-brand-600 dark:text-brand-400 mt-1 font-medium">
                      {studentThanksNote}
                    </p>
                  )}
                </div>
              ) : (
                <div className="sm:col-span-2">
                  <p className="text-xs text-amber-500">
                    No supervisor listed — this entry won't be verified. Add a supervisor email above if you need it verified.
                  </p>
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <SectionTitle icon={Upload}>Proof</SectionTitle>
            <p className="text-sm text-earth-500 dark:text-earth-400 -mt-2 mb-4">
              Upload a photo of a sign-in sheet, a thank-you email, or any supporting document.
            </p>
            <FileDrop
              value={form.proof}
              onFile={(f) => setForm((s) => ({ ...s, proof: f }))}
              onClear={() => setForm((s) => ({ ...s, proof: null }))}
            />
          </Card>

          <Card>
            {error && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg mb-3">{error}</div>}
            <button type="submit" className="btn-primary w-full">
              <Save className="w-4 h-4" /> {editId ? 'Save changes' : 'Save hours'}
            </button>
            {editId && (
              <button
                type="button"
                className="btn-ghost w-full mt-2 text-red-600"
                onClick={() => { removeLog(editId); onCloseEdit?.() }}
              >
                <Trash2 className="w-4 h-4" /> Delete this entry
              </button>
            )}
            <button
              type="button"
              className="btn-ghost w-full mt-2"
              onClick={() => nav('/calendar')}
            >
              View all entries
            </button>
          </Card>
        </div>
      </form>

      <Toast open={toast} onClose={() => setToast(false)}>
        {editId ? 'Entry updated' : 'Hours saved — nice work!'}
      </Toast>
    </AppLayout>
  )
}

function SectionTitle({ children, icon: Icon }) {
  return (
    <h2 className="font-display font-semibold text-lg flex items-center gap-2 mb-4">
      {Icon && <Icon className="w-4 h-4 text-brand-600" />}
      {children}
    </h2>
  )
}

function Field({ icon: Icon, label, ...rest }) {
  return (
    <div>
      <label className="label flex items-center gap-1.5">{Icon && <Icon className="w-4 h-4" />}{label}</label>
      <input className="input" {...rest} />
    </div>
  )
}
