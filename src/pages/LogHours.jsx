import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Save, Trash2, Upload, Mail, User, ShieldCheck, Building2, Phone, MapPin, ClipboardList } from 'lucide-react'
import { useData } from '@/hooks/useData.jsx'
import { useAuth } from '@/hooks/useAuth.jsx'
import { uploadProof } from '@/lib/proofUpload.js'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import FileDrop from '@/components/FileDrop.jsx'
import Toast from '@/components/Toast.jsx'
import LocationPicker from '@/components/LocationPicker.jsx'
import { ACTIVITY_CATEGORIES, categoryColor } from '@/lib/categories.js'
import { useMyRequirements, formFieldRequirements, validateLogAgainstPolicy, describePolicy } from '@/lib/requirements.js'
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

const apiUrl = import.meta.env.VITE_API_URL || '/api'

const blank = () => ({
  activity: '',
  taskId: '',
  category: ACTIVITY_CATEGORIES[0],
  date: format(new Date(), 'yyyy-MM-dd'),
  startTime: '',
  endTime: '',
  location: '',
  latitude: null,
  longitude: null,
  notes: '',
  orgName: '',
  orgAddress: '',
  orgPhone: '',
  supervisorName: '',
  supervisorEmail: '',
  supervisorSignature: '',
  proof: null,
  // Answers to the extra questions this student's school added to the form.
  customFields: {},
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
  const [myTasks, setMyTasks] = useState([])
  // What this student's school asks for. Starts at the permissive default, so
  // the form is usable on the first paint and in client-only mode, and
  // tightens once the policy lands.
  const requirements = useMyRequirements()
  const { policy, sources } = requirements
  const required = formFieldRequirements(requirements)
  const customFields = policy.customFields || []
  const policyNotes = describePolicy(policy)
  // An empty list means the school did not restrict categories.
  const categories = policy.logRules.allowedCategories.length > 0
    ? policy.logRules.allowedCategories
    : ACTIVITY_CATEGORIES

  useEffect(() => {
    const token = localStorage.getItem('voluntrack:auth_token')
    if (!token) return
    fetch(`${apiUrl}/school/public-tasks/signups/mine`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : { signups: [] }))
      .then((d) => setMyTasks((d.signups || []).filter((s) => s.signup_status === 'approved')))
      .catch(() => setMyTasks([]))
  }, [])
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

  // A school can narrow the category list after an entry was drafted — or the
  // policy can arrive a moment after the form's default. Snap to something
  // valid rather than submitting a category the school will reject.
  useEffect(() => {
    if (categories.length > 0 && !categories.includes(form.category)) {
      setForm((f) => ({ ...f, category: categories[0] }))
    }
  }, [categories, form.category])

  const setCustomField = (key) => (value) =>
    setForm((f) => ({ ...f, customFields: { ...(f.customFields || {}), [key]: value } }))

  const hours = hoursBetween(
    form.date && form.startTime ? `${form.date}T${form.startTime}:00` : null,
    form.date && form.endTime   ? `${form.date}T${form.endTime}:00`   : null,
  )

  const onChange = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.activity.trim()) { setError('Please enter an activity name.'); return }
    if (hours <= 0)             { setError('End time must be after start time.'); return }
    if (required.locationRequired && !form.location.trim()) { setError('Please enter a location or use the button below to detect it.'); return }
    if (required.supervisorRequired && !form.supervisorName.trim()) { setError("Please enter your supervisor's name."); return }
    if (required.supervisorRequired && !form.supervisorEmail.trim()) { setError("Please enter your supervisor's email."); return }
    if (required.proofRequired && !form.proof) { setError('Please upload proof — a sign-in sheet, thank-you email, or other supporting document.'); return }

    // The school's own rules, checked with the same function the API uses, so
    // a student reads the rule here instead of having a save fail silently.
    // sameDayHours is the one rule that can't be checked from the form alone;
    // it comes from the entries already on this device, and the server
    // re-checks it against the real roster.
    const sameDayHours = logs
      .filter((l) => l.date === form.date && l.id !== editId)
      .reduce((sum, l) => sum + (Number(l.hours) || 0), 0)
    const violations = validateLogAgainstPolicy(policy, {
      ...form,
      hours,
      hasProof: Boolean(form.proof),
      sameDayHours,
    })
    if (violations.length > 0) { setError(violations[0].message); return }

    try {
      // hasLocalProof tells the API that a proof file exists even when it never
      // leaves this device — without tenant storage the bytes stay in
      // localStorage, so the pointer the server would otherwise look for is
      // never created. See POST /api/logs.
      let payload = { ...form, hours, hasLocalProof: Boolean(form.proof) }

      // Try the school's own bucket first. On success the bytes live there and
      // the log keeps only a pointer — so the data URL is dropped from the
      // local copy rather than sitting in localStorage as well. If there's no
      // tenant storage (or the upload fails), payload is untouched and the
      // file stays local exactly as before.
      const pointer = await uploadProof(form.proof)
      if (pointer) {
        payload = {
          ...payload,
          proofKey: pointer.key,
          proofStorageId: pointer.storageId,
          proofMime: pointer.mime,
          proofBytes: pointer.bytes,
          proof: { name: form.proof.name, size: form.proof.size, mimeType: form.proof.mimeType, dataUrl: null, stored: true },
        }
      }

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
            hours: payload.hours,
            activity: payload.activity,
            logId: serverId,
          }).then((result) => {
            if (result.statusToken) {
              editLog(created.id, { verificationStatus: 'pending', verificationToken: result.statusToken })
            }
          })
        }
      }
    } catch (err) {
      setError('Could not save — your proof file might be too large. Try a smaller image.')
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
                  {categories.map((c) => <option key={c}>{c}</option>)}
                </select>
                <div className="mt-2">
                  <span className={`chip ${categoryColor(form.category)}`}>{form.category}</span>
                </div>
              </div>
            </div>
            {myTasks.length > 0 && (
              <div className="mt-4">
                <label className="label">Link to a task you're approved for (optional)</label>
                <select className="input" value={form.taskId} onChange={onChange('taskId')}>
                  <option value="">Not linked to a task</option>
                  {myTasks.map((t) => (
                    <option key={t.id} value={t.id}>{t.title}{t.date ? ` — ${t.date}` : ''}</option>
                  ))}
                </select>
                <p className="text-xs text-earth-400 mt-1">
                  Linking lets the task's organizer review and verify this entry directly.
                </p>
              </div>
            )}
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
                <label className="label">Location {required.locationRequired ? '*' : ''}</label>
                <LocationPicker
                  address={form.location}
                  lat={form.latitude}
                  lng={form.longitude}
                  placeholder="123 Main St, Library, Online, etc."
                  required={required.locationRequired}
                  onChange={({ address, lat, lng }) => setForm((f) => ({ ...f, location: address, latitude: lat, longitude: lng }))}
                />
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea className="input min-h-[100px] resize-y" placeholder="Anything worth remembering…" value={form.notes} onChange={onChange('notes')} />
              </div>
            </div>
          </Card>

          <Card>
            <SectionTitle icon={Building2}>Organization</SectionTitle>
            <p className="text-sm text-earth-500 dark:text-earth-400 -mt-2 mb-4">
              The nonprofit or group you volunteered with — many schools require this on a verification form.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field icon={Building2} label={`Organization name ${required.orgNameRequired ? '*' : ''}`} value={form.orgName} onChange={onChange('orgName')} placeholder="Riverside Food Bank" />
              <Field icon={Phone}     label="Organization phone" value={form.orgPhone} onChange={onChange('orgPhone')} placeholder="(555) 123-4567" type="tel" />
              <div className="sm:col-span-2">
                <label className="label flex items-center gap-1.5"><MapPin className="w-4 h-4" /> Organization address</label>
                <input className="input" placeholder="123 Main St, Springfield, IL" value={form.orgAddress} onChange={onChange('orgAddress')} />
              </div>
            </div>
          </Card>

          <Card>
            <SectionTitle icon={ShieldCheck}>Supervisor verification</SectionTitle>
            <p className="text-sm text-earth-500 dark:text-earth-400 -mt-2 mb-4">
              Capture who can vouch for this work. Schools typically require a name and email.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field icon={User}        label={`Supervisor name ${required.supervisorRequired ? '*' : ''}`}  value={form.supervisorName} onChange={onChange('supervisorName')} placeholder="Mr. Johnson" required={required.supervisorRequired} />
              <Field icon={Mail}        label={`Supervisor email ${required.supervisorRequired ? '*' : ''}`} value={form.supervisorEmail} onChange={onChange('supervisorEmail')} placeholder="johnson@school.edu" type="email" required={required.supervisorRequired} />
              {form.supervisorEmail?.trim() ? (
                <div className="sm:col-span-2">
                  <VerificationBadge status={form.verificationStatus} />
                  {(!form.verificationStatus || form.verificationStatus === 'none') && (
                    <p className="text-xs text-earth-400 mt-1">
                      Your supervisor will get an email with a link to review these hours. If they approve, they'll sign right there to confirm it — if they reject, no signature is needed. This usually takes a day or two.
                    </p>
                  )}
                  {form.verificationStatus === 'approved' && (
                    <>
                      {form.supervisorSignature && (
                        <img src={form.supervisorSignature} alt="Supervisor signature" className="mt-2 h-16 rounded-lg border border-earth-200 dark:border-[#1f2e25] bg-white" />
                      )}
                      <p className="text-xs text-brand-600 dark:text-brand-400 mt-1 font-medium">
                        {studentThanksNote}
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <div className="sm:col-span-2">
                  <p className="text-xs text-amber-500">
                    {required.supervisorRequired
                      ? 'Supervisor name and email are required so this entry can be verified.'
                      : 'Add a supervisor to have this entry verified — optional at your school.'}
                  </p>
                </div>
              )}
            </div>
          </Card>

          {customFields.length > 0 && (
            <Card>
              <SectionTitle icon={ClipboardList}>
                {requirements.schoolName ? `${requirements.schoolName} asks` : 'Your school asks'}
              </SectionTitle>
              <p className="text-sm text-earth-500 dark:text-earth-400 -mt-2 mb-4">
                Extra questions your school added to this form.
              </p>
              <div className="grid sm:grid-cols-2 gap-4">
                {customFields.map((field) => (
                  <CustomField
                    key={field.key}
                    field={field}
                    value={form.customFields?.[field.key]}
                    onChange={setCustomField(field.key)}
                  />
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          {(policyNotes.length > 0 || requirements.goalHours != null) && (
            <Card>
              <SectionTitle icon={ClipboardList}>
                {requirements.schoolName ? `${requirements.schoolName} requires` : 'Your requirements'}
              </SectionTitle>
              {requirements.goalHours != null && (
                <p className="text-sm mb-2">
                  <span className="font-semibold text-brand-700 dark:text-brand-300">{requirements.goalHours} hours</span>
                  {policy.goals.deadline ? ` by ${policy.goals.deadline}` : ' total'}
                </p>
              )}
              {policy.goals.note && (
                <p className="text-xs text-earth-500 dark:text-earth-400 mb-2">{policy.goals.note}</p>
              )}
              {policyNotes.length > 0 && (
                <ul className="text-sm text-earth-600 dark:text-earth-300 list-disc pl-5 space-y-1">
                  {policyNotes.map((note) => <li key={note}>{note}</li>)}
                </ul>
              )}
              {sources.logRules === 'organization' && requirements.organizationName && (
                <p className="text-xs text-earth-400 mt-2">Set by {requirements.organizationName}.</p>
              )}
            </Card>
          )}
          <Card>
            <SectionTitle icon={Upload}>Proof {required.proofRequired ? '*' : ''}</SectionTitle>
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

// One tenant-defined question. The type list is closed (see
// CUSTOM_FIELD_TYPES in server/requirements.js), so an unknown type can only
// come from a policy newer than this build — it falls through to a text box
// rather than rendering nothing and quietly losing the answer.
function CustomField({ field, value, onChange }) {
  const label = (
    <label className="label flex items-center gap-1.5">
      {field.label}{field.required ? ' *' : ''}
    </label>
  )
  const help = field.help ? <p className="text-xs text-earth-400 mt-1">{field.help}</p> : null

  if (field.type === 'checkbox') {
    return (
      <div className={field.help ? '' : 'self-end'}>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            required={field.required}
          />
          {field.label}{field.required ? ' *' : ''}
        </label>
        {help}
      </div>
    )
  }

  if (field.type === 'select') {
    return (
      <div>
        {label}
        <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} required={field.required}>
          <option value="">Select…</option>
          {field.options.map((o) => <option key={o}>{o}</option>)}
        </select>
        {help}
      </div>
    )
  }

  if (field.type === 'textarea') {
    return (
      <div className="sm:col-span-2">
        {label}
        <textarea
          className="input min-h-[80px] resize-y"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
        />
        {help}
      </div>
    )
  }

  return (
    <div>
      {label}
      <input
        className="input"
        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        required={field.required}
      />
      {help}
    </div>
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
