import { useState, useEffect, useMemo, useRef } from 'react'
import SkillsPicker from '@/components/SkillsPicker.jsx'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Save, Trash2, Upload, Mail, User, ShieldCheck, Building2, Phone, MapPin, ClipboardList, FileSignature, ExternalLink, Copy, Send, X, Repeat } from 'lucide-react'
import { useData } from '@/hooks/useData.jsx'
import { useAuth } from '@/hooks/useAuth.jsx'
import { uploadProof } from '@/lib/proofUpload.js'
import AppLayout from '@/components/AppLayout.jsx'
import Card from '@/components/Card.jsx'
import FileDrop from '@/components/FileDrop.jsx'
import SignaturePad from '@/components/SignaturePad.jsx'
import Toast from '@/components/Toast.jsx'
import LocationPicker from '@/components/LocationPicker.jsx'
import { ACTIVITY_CATEGORIES, categoryColor } from '@/lib/categories.js'
import { useMyRequirements, formFieldRequirements, validateLogAgainstPolicy, describePolicy, signatureNeeds, isLockedDate, lockedMessage, placeApproved } from '@/lib/requirements.js'
import { listShifts } from '@/lib/shifts.js'
import { hoursBetween, fmtHours, fmtDate, fmtDateLong } from '@/utils/date.js'
import { notifySupervisor, createVerificationLink } from '@/lib/supervisorNotify.js'
import ScanPaperLog from '@/components/ScanPaperLog.jsx'
import VerificationBadge from '@/components/VerificationBadge.jsx'
import { addDays, format, parseISO } from 'date-fns'
import { hapticSuccess } from '@/lib/platform.js'
import { tr } from '@/lib/i18n.js'

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
  reflection: '',
  skills: [],
  orgName: '',
  orgAddress: '',
  orgPhone: '',
  supervisorName: '',
  supervisorEmail: '',
  supervisorSignature: '',
  proof: null,
  // The school's signatures rule. The image stays on this device; the server
  // is only told that one exists — studentSigned is that fact, for an entry
  // pulled back from the server without its image.
  studentSignature: '',
  studentSigned: false,
  formSubmitted: false,
  // When the supervisor has to sign: are they next to the student right now?
  // null until the student answers — see signerHere below for the default.
  signerHere: null,
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
  // A second tap on Save while the first is still working saved the entry
  // twice. The ref blocks it at once (state only updates on the next render).
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [myTasks, setMyTasks] = useState([])
  // What this student's school asks for. Starts at the permissive default, so
  // the form is usable on the first paint and in client-only mode, and
  // tightens once the policy lands.
  const requirements = useMyRequirements()
  const approvedPlaces = requirements.policy?.logRules?.approvedPlaces || []
  const [showAllPlaces, setShowAllPlaces] = useState(false)
  // Editing an entry the school has locked (#569): show why, and allow no changes.
  const editingLocked = Boolean(editId) && isLockedDate(requirements.policy, logs.find((l) => l.id === editId)?.date)
  const { policy, sources } = requirements
  const customFields = policy.customFields || []
  const policyNotes = describePolicy(policy)
  const signing = signatureNeeds(policy)
  const signatures = policy.signatures
  const hasStudentSignature = Boolean(form.studentSignature || form.studentSigned)
  const linkedTask = myTasks.find((t) => t.id === form.taskId) || null

  // Links a task you were approved for: its organizer signs off hours on it,
  // and it says what, when and where, so fill those in without overwriting
  // anything already typed.
  const linkTask = (taskId) => {
    const task = myTasks.find((t) => t.id === taskId)
    const lat = task?.latitude != null ? Number(task.latitude) : null
    const lng = task?.longitude != null ? Number(task.longitude) : null
    setForm((f) => ({
      ...f,
      taskId,
      supervisorName: f.supervisorName || task?.creator_name || '',
      supervisorEmail: f.supervisorEmail || task?.creator_email || '',
      ...(!f.location?.trim() && task?.location
        ? { location: task.location, latitude: Number.isFinite(lat) ? lat : null, longitude: Number.isFinite(lng) ? lng : null }
        : {}),
    }))
  }

  // /log?task=<id>, from the "Did you volunteer at …?" email (#474): pick that
  // task once the list loads, and fill in its title and date too.
  const [searchParams] = useSearchParams()
  const taskFromLink = searchParams.get('task')
  const appliedTaskLink = useRef(false)
  useEffect(() => {
    if (!taskFromLink || appliedTaskLink.current || editId) return
    const task = myTasks.find((t) => t.id === taskFromLink)
    if (!task) return
    appliedTaskLink.current = true
    linkTask(task.id)
    setForm((f) => ({
      ...f,
      activity: f.activity?.trim() ? f.activity : (task.title || ''),
      ...(task.date ? { date: String(task.date).slice(0, 10) } : {}),
      // The task's start time, when it's a plain HH:MM; the end is theirs to add.
      ...(!f.startTime && /^\d{1,2}:\d{2}$/.test(String(task.time || '').trim())
        ? { startTime: String(task.time).trim().padStart(5, '0') }
        : {}),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskFromLink, myTasks, editId])
  // /log?shift=<id>&date=YYYY-MM-DD, from "Did you go?" on the dashboard
  // (#571): fill the form from the student's regular shift, once.
  const shiftFromLink = searchParams.get('shift')
  const shiftDate = searchParams.get('date')
  const appliedShiftLink = useRef(false)
  useEffect(() => {
    if (!shiftFromLink || appliedShiftLink.current || editId) return
    appliedShiftLink.current = true
    listShifts().then((list) => {
      const s = list.find((x) => x.id === shiftFromLink)
      if (!s) return
      setForm((f) => ({
        ...f,
        activity: s.activity,
        category: s.category || f.category,
        orgName: s.orgName || f.orgName,
        location: s.location || f.location,
        latitude: s.latitude ?? f.latitude,
        longitude: s.longitude ?? f.longitude,
        supervisorName: s.supervisorName || f.supervisorName,
        supervisorEmail: s.supervisorEmail || f.supervisorEmail,
        startTime: s.startTime,
        endTime: s.endTime,
        ...(/^\d{4}-\d{2}-\d{2}$/.test(shiftDate || '') ? { date: shiftDate } : {}),
      }))
    }).catch(() => {})
  }, [shiftFromLink, shiftDate, editId])
  // Until the student says otherwise: a supervisor is assumed to be right
  // there, a task's organizer not (they sign it off on My Tasks).
  const signerHere = form.signerHere ?? !linkedTask
  // How the supervisor's sign-off happens, when the school asks for one:
  // on this device, by the task organizer in the app, or from a link the
  // student is handed to send.
  const signoffRoute = !signing.supervisorSignature ? null
    : signerHere ? 'inPerson'
    : linkedTask ? 'organizer'
    : 'studentLink'
  const signsInPerson = signoffRoute === 'inPerson'
  const signedInPerson = signsInPerson && Boolean(form.supervisorSignature)
  const required = formFieldRequirements(requirements, { taskLinked: Boolean(linkedTask), signsInPerson })
  // The supervisor named is the task's own organizer, who reviews it in-app.
  const organizerOnFile = Boolean(linkedTask?.creator_email)
    && form.supervisorEmail?.trim().toLowerCase() === linkedTask.creator_email.trim().toLowerCase()
  // The ready-made email for a supervisor who wasn't there, shown after save.
  const [emailDraft, setEmailDraft] = useState(null)
  // An empty list means the school did not restrict categories.
  const categories = policy.logRules.allowedCategories.length > 0
    ? policy.logRules.allowedCategories
    : ACTIVITY_CATEGORIES

  useEffect(() => {
    const token = localStorage.getItem('voluntrack:auth_token')
    if (!token) return
    fetch(`${apiUrl}/school/public-tasks/signups/mine`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : { signups: [] }))
      .then((d) => setMyTasks((d.signups || []).filter((s) => s.signup_status === 'approved' && s.task_status !== 'cancelled')))
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

  // An end time earlier than the start is an overnight session (10 PM to
  // 1 AM), not a mistake to refuse: it ends the next day. Shown beside the
  // duration so a typo still stands out.
  const endsNextDay = Boolean(form.date && form.startTime && form.endTime && form.endTime < form.startTime)
  const endDate = endsNextDay ? format(addDays(parseISO(form.date), 1), 'yyyy-MM-dd') : form.date
  const hours = hoursBetween(
    form.date && form.startTime ? `${form.date}T${form.startTime}:00` : null,
    form.date && form.endTime   ? `${endDate}T${form.endTime}:00`   : null,
  )

  const onChange = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  // "Log again": the student's last few regular activities, one tap to copy
  // into a new entry dated today. Entries from a one-off task or an imported
  // transcript aren't repeats, and neither the paperwork (signatures, proof,
  // sign-off) nor the old date comes along.
  const [repeatedFrom, setRepeatedFrom] = useState(null)
  const repeatable = useMemo(() => {
    if (editId) return []
    const seen = new Set()
    const out = []
    const recent = [...logs]
      .filter((l) => !l.taskId && !l.importedTranscriptId && l.activity)
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''))
    for (const l of recent) {
      const key = `${l.activity.trim().toLowerCase()}|${(l.orgName || '').trim().toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(l)
      if (out.length === 3) break
    }
    return out
  }, [logs, editId])
  const logAgain = (l) => {
    setForm({
      ...blank(),
      activity: l.activity,
      category: l.category || blank().category,
      startTime: l.startTime || '',
      endTime: l.endTime || '',
      location: l.location || '',
      latitude: l.latitude ?? null,
      longitude: l.longitude ?? null,
      orgName: l.orgName || '',
      orgAddress: l.orgAddress || '',
      orgPhone: l.orgPhone || '',
      supervisorName: l.supervisorName || '',
      supervisorEmail: l.supervisorEmail || '',
      customFields: l.customFields || {},
    })
    setRepeatedFrom(l)
    setError('')
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    if (savingRef.current) return
    setError('')
    if (!form.activity.trim()) { setError(tr('Please enter an activity name.')); return }
    if (hours <= 0)             { setError(tr('The start and end times are the same.')); return }
    if (required.locationRequired && !form.location.trim()) { setError(tr('Please enter a location or use the button below to detect it.')); return }
    if (required.supervisorNameRequired && !form.supervisorName.trim()) { setError(tr("Please enter your supervisor's name.")); return }
    if (required.supervisorEmailRequired && !form.supervisorEmail.trim()) {
      setError(signing.supervisorSignature
        ? tr("Please enter your supervisor's email so you can send them the signing link.")
        : tr("Please enter your supervisor's email."))
      return
    }
    if (signsInPerson && !form.supervisorSignature) { setError(tr('Have your supervisor sign in the box under Signatures.')); return }
    if (required.proofRequired && !form.proof) {
      setError(signing.signedFormUpload
        ? tr('Please upload a photo or scan of your signed school form.')
        : tr('Please upload proof — a sign-in sheet, thank-you email, or other supporting document.'))
      return
    }

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
      hasStudentSignature,
      supervisorSignedInPerson: signedInPerson,
      sameDayHours,
    })
    if (violations.length > 0) { setError(violations[0].message); return }

    savingRef.current = true
    setSaving(true)
    try {
      // hasLocalProof tells the API that a proof file exists even when it never
      // leaves this device — without tenant storage the bytes stay in
      // localStorage, so the pointer the server would otherwise look for is
      // never created. See POST /api/logs.
      let payload = {
        ...form,
        hours,
        hasLocalProof: Boolean(form.proof),
        studentSigned: hasStudentSignature,
        supervisorSignedInPerson: signedInPerson,
        // A drawing from "not next to me" was never theirs to keep.
        supervisorSignature: signsInPerson ? form.supervisorSignature : '',
      }

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
        setRepeatedFrom(null)
        setToast(true)
        hapticSuccess()
        if (signoffRoute === 'inPerson' || signoffRoute === 'organizer') {
          // Signed already, or the organizer signs it on their My Tasks page.
        } else if (signoffRoute === 'studentLink') {
          // Not there to sign: the student sends the link themselves, from
          // their own email, rather than VolunTrack mailing it.
          const serverId = await created.whenSynced.catch(() => null)
          const result = await createVerificationLink({
            supervisorEmail: payload.supervisorEmail,
            supervisorName: payload.supervisorName,
            hours: payload.hours,
            activity: payload.activity,
            logId: serverId,
          })
          if (result.ok) {
            editLog(created.id, { verificationStatus: 'pending', verificationToken: result.statusToken })
            setEmailDraft(buildSigningEmail({
              to: payload.supervisorEmail,
              supervisorName: payload.supervisorName,
              studentName: result.studentName || user?.name || '',
              hours: payload.hours,
              activity: payload.activity,
              date: payload.date,
              taskTitle: linkedTask?.title || '',
              link: result.verifyUrl,
              logId: created.id,
              serverId,
            }))
          } else {
            setError(tr('Your hours are saved, but we couldn’t make the signing link — check you’re online and signed in. Your supervisor can still sign in person.'))
          }
        } else if (payload.supervisorEmail?.trim() && !organizerOnFile) {
          // No signature rule: the named supervisor is emailed to verify —
          // unless it's the linked task's organizer, who reviews it on My Tasks.
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
      setError(tr('Could not save — your proof file might be too large. Try a smaller image.'))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <AppLayout
      title={editId ? tr('Edit volunteer hours') : tr('Log volunteer hours')}
      subtitle={tr('Capture the who, what, when, and where of your service.')}
    >
      <form onSubmit={onSubmit} className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {!editId && <ScanPaperLog onAdd={(entry) => { addLog({ ...blank(), ...entry }); setToast(true) }} />}
          {emailDraft && (
            <SigningEmailCard
              draft={emailDraft}
              onChange={setEmailDraft}
              onClose={() => setEmailDraft(null)}
              onSendForMe={async () => {
                const result = await notifySupervisor({
                  supervisorEmail: emailDraft.to,
                  supervisorName: emailDraft.supervisorName,
                  hours: emailDraft.hours,
                  activity: emailDraft.activity,
                  logId: emailDraft.serverId,
                })
                if (result.statusToken) {
                  editLog(emailDraft.logId, { verificationStatus: 'pending', verificationToken: result.statusToken })
                  setEmailDraft(null)
                  setToast(true)
                } else {
                  setError(tr('We couldn’t send the email. Copy it and send it yourself instead.'))
                }
              }}
            />
          )}
          {repeatable.length > 0 && (
            <Card>
              <SectionTitle>{tr('Log again')}</SectionTitle>
              <p className="text-sm text-earth-400 -mt-2 mb-3">{tr('Same place as before? Copy a recent entry, dated today.')}</p>
              <div className="flex flex-wrap gap-2">
                {repeatable.map((l) => (
                  <button key={l.id} type="button" onClick={() => logAgain(l)} className={`btn-sm ${repeatedFrom?.id === l.id ? 'btn-primary' : 'btn-ghost'}`}>
                    <Repeat className="w-3.5 h-3.5 mr-1" />
                    {l.activity}{l.orgName ? ` · ${l.orgName}` : ''}
                  </button>
                ))}
              </div>
              {repeatedFrom && (
                <p className="text-xs text-earth-400 mt-3">
                  {tr('Copied from')}{' '}{fmtDate(repeatedFrom.date)}. {repeatedFrom.startTime && repeatedFrom.endTime ? tr('Check the times, then save.') : tr('Add the start and end times, then save.')}
                </p>
              )}
            </Card>
          )}
          <Card>
            <SectionTitle>{tr('Activity')}</SectionTitle>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">{tr('What did you do? *')}</label>
                <input
                  className="input"
                  placeholder={tr('Park cleanup, food drive, tutoring…')}
                  value={form.activity} onChange={onChange('activity')} required
                />
              </div>
              <div>
                <label className="label">{tr('Category')}</label>
                <select className="input" value={form.category} onChange={onChange('category')}>
                  {categories.map((c) => <option key={c} value={c}>{tr(c)}</option>)}
                </select>
                <div className="mt-2">
                  <span className={`chip ${categoryColor(form.category)}`}>{tr(form.category)}</span>
                </div>
              </div>
            </div>
            {myTasks.length > 0 && (
              <div className="mt-4">
                <label className="label">{tr("Link to a task you're approved for (optional)")}</label>
                <select
                  className="input"
                  value={form.taskId}
                  onChange={(e) => linkTask(e.target.value)}
                >
                  <option value="">{tr('Not linked to a task')}</option>
                  {myTasks.map((t) => (
                    <option key={t.id} value={t.id}>{t.title}{t.date ? ` — ${fmtDate(t.date)}` : ''}</option>
                  ))}
                </select>
                <p className="text-xs text-earth-400 mt-1">
                  {tr("Linking lets the task's organizer review and verify this entry directly.")}
                </p>
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle>{tr('When')}</SectionTitle>
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="label">{tr('Date *')}</label>
                <input className="input" type="date" required value={form.date} onChange={onChange('date')} />
              </div>
              <div>
                <label className="label">{tr('Start time *')}</label>
                <input className="input" type="time" required value={form.startTime} onChange={onChange('startTime')} />
              </div>
              <div>
                <label className="label">{tr('End time *')}</label>
                <input className="input" type="time" required value={form.endTime} onChange={onChange('endTime')} />
              </div>
            </div>
            <div className="mt-4 text-sm text-earth-600 dark:text-earth-300">
              {tr('Duration:')}{' '}<span className="font-semibold text-brand-700 dark:text-brand-300">{fmtHours(hours)}</span>
              {endsNextDay && <span className="ml-1 text-earth-500 dark:text-earth-400">{tr('(ends the next day)')}</span>}
            </div>
          </Card>

          <Card>
            <SectionTitle>{tr('Where')}</SectionTitle>
            {/* Location gets the full width: beside Notes, with the "Current"
                button next to it, a place name was cut off while typing. */}
            <div className="grid gap-4">
              <div>
                <label className="label">{tr('Location')}{' '}{required.locationRequired ? '*' : ''}</label>
                <LocationPicker
                  address={form.location}
                  lat={form.latitude}
                  lng={form.longitude}
                  placeholder={tr('123 Main St, Library, Online, etc.')}
                  required={required.locationRequired}
                  onChange={({ address, lat, lng }) => setForm((f) => ({ ...f, location: address, latitude: lat, longitude: lng }))}
                />
              </div>
              <div>
                <label className="label">{tr('Notes')}</label>
                <textarea className="input min-h-[100px] resize-y" placeholder={tr('Anything worth remembering…')} value={form.notes} onChange={onChange('notes')} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">{tr('What did you learn?')} <span className="text-earth-400 font-normal">{tr('(optional, only you see this)')}</span></label>
                <textarea className="input min-h-[90px] resize-y" maxLength={2000} placeholder={tr('A moment that stuck with you, a skill you used, why it mattered…')} value={form.reflection} onChange={onChange('reflection')} />
                <p className="text-xs text-earth-400 mt-1">{tr('Handy later for NHS reflections, scholarships and college essays.')}</p>
              </div>
              <div className="sm:col-span-2">
                <SkillsPicker value={form.skills || []} onChange={(skills) => setForm((f) => ({ ...f, skills }))} />
              </div>
            </div>
          </Card>

          <Card>
            <SectionTitle icon={Building2}>{tr('Organization')}</SectionTitle>
            <p className="text-sm text-earth-500 dark:text-earth-400 -mt-2 mb-4">
              {tr('The nonprofit or group you volunteered with — many schools require this on a verification form.')}
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field icon={Building2} label={`${tr('Organization name')} ${required.orgNameRequired ? '*' : ''}`} value={form.orgName} onChange={onChange('orgName')} placeholder={tr('Riverside Food Bank')} />
              <Field icon={Phone}     label={tr('Organization phone')} value={form.orgPhone} onChange={onChange('orgPhone')} placeholder="(555) 123-4567" type="tel" />
              <div className="sm:col-span-2">
                <label className="label flex items-center gap-1.5"><MapPin className="w-4 h-4" />{' '}{tr('Organization address')}</label>
                <input className="input" placeholder={tr('123 Main St, Springfield, IL')} value={form.orgAddress} onChange={onChange('orgAddress')} />
              </div>
            </div>
            {/* The school's approved places (#591): a place off the list is
                still logged, and the adviser checks it. */}
            {approvedPlaces.length > 0 && (
              <div className="mt-4 text-sm">
                {form.orgName.trim() && !placeApproved(requirements.policy, form.orgName) && (
                  <p className="mb-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 px-3 py-2">
                    {tr("{place} isn't on your school's list of approved places. You can still log it, and your adviser will check it.", { place: form.orgName.trim() })}
                  </p>
                )}
                <p className="text-earth-500 dark:text-earth-400 mb-1.5">{tr('Approved places:')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {(showAllPlaces ? approvedPlaces : approvedPlaces.slice(0, 8)).map((p) => (
                    <button key={p} type="button" className="chip hover:ring-1 hover:ring-brand-400" onClick={() => setForm((f) => ({ ...f, orgName: p }))}>{p}</button>
                  ))}
                  {approvedPlaces.length > 8 && !showAllPlaces && (
                    <button type="button" className="text-xs text-brand-500 underline" onClick={() => setShowAllPlaces(true)}>{tr('and {n} more', { n: approvedPlaces.length - 8 })}</button>
                  )}
                </div>
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle icon={ShieldCheck}>{tr('Supervisor verification')}</SectionTitle>
            <p className="text-sm text-earth-500 dark:text-earth-400 -mt-2 mb-4">
              {tr('Capture who can vouch for this work. Schools typically require a name and email.')}
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field icon={User}        label={`${tr('Supervisor name')} ${required.supervisorNameRequired ? '*' : ''}`}  value={form.supervisorName} onChange={onChange('supervisorName')} placeholder={tr('Mr. Johnson')} required={required.supervisorNameRequired} />
              <Field icon={Mail}        label={`${tr('Supervisor email')} ${required.supervisorEmailRequired ? '*' : ''}`} value={form.supervisorEmail} onChange={onChange('supervisorEmail')} placeholder={tr('johnson@school.edu')} type="email" required={required.supervisorEmailRequired} />
              {form.supervisorEmail?.trim() ? (
                <div className="sm:col-span-2">
                  <VerificationBadge status={form.verificationStatus} bySchool={form.reviewedBySchool} note={form.reviewNote} />
                  {(!form.verificationStatus || form.verificationStatus === 'none') && (
                    <p className="text-xs text-earth-400 mt-1">
                      {organizerOnFile
                        ? tr('{organizer} reviews and signs this on their My Tasks page in VolunTrack — no email is sent.', { organizer: linkedTask.creator_name || tr('The task organizer') })
                        : tr("Your supervisor will get an email with a link to review these hours. If they approve, they'll sign right there to confirm it — if they reject, no signature is needed. This usually takes a day or two.")}
                    </p>
                  )}
                  {form.verificationStatus === 'approved' && (
                    <>
                      {form.supervisorSignature && (
                        <img src={form.supervisorSignature} alt={tr('Supervisor signature')} className="mt-2 h-16 rounded-lg border border-earth-200 dark:border-[#1f2e25] bg-white" />
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
                    {signsInPerson && !required.supervisorEmailRequired
                      ? tr('Add your supervisor’s name — they’ll sign under Signatures below.')
                      : required.supervisorEmailRequired
                        ? tr('Supervisor name and email are required so this entry can be verified.')
                        : tr('Add a supervisor to have this entry verified — optional at your school.')}
                  </p>
                </div>
              )}
            </div>
          </Card>

          {signatures.mode !== 'none' && (
            <Card>
              <SectionTitle icon={FileSignature}>
                {signatures.mode === 'paperForm' ? tr('Your school’s form') : tr('Signatures')}
              </SectionTitle>
              {signatures.note && (
                <p className="text-sm text-earth-500 dark:text-earth-400 -mt-2 mb-4">{signatures.note}</p>
              )}

              {signoffRoute && linkedTask && (
                <div className="mb-5">
                  <p className="text-sm text-earth-600 dark:text-earth-300">
                    <strong>{linkedTask.creator_name || tr('The task organizer')}</strong>{' '}{tr('will sign this on their My Tasks page — nothing to send.')}
                  </p>
                  <label className="flex items-center gap-2 text-sm mt-3">
                    <input
                      type="checkbox"
                      checked={signerHere}
                      onChange={(e) => setForm((f) => ({ ...f, signerHere: e.target.checked }))}
                    />
                    {tr('They’re next to me now — have them sign here instead')}
                  </label>
                  {signerHere && <SignatureField label={tr('Organizer signature *')} form={form} setForm={setForm} field="supervisorSignature" />}
                </div>
              )}

              {signoffRoute && !linkedTask && (
                <div className="mb-5">
                  <p className="label">{tr('Is the person signing next to you right now?')}</p>
                  <div className="flex flex-wrap gap-2">
                    {[[true, 'Yes, they’re next to me'], [false, 'No, they’re not next to me']].map(([here, label]) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, signerHere: here }))}
                        className={`btn-sm ${signerHere === here ? 'btn-primary' : 'btn-ghost'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {signerHere ? (
                    <SignatureField
                      label={tr('Supervisor signature *')}
                      form={form}
                      setForm={setForm}
                      field="supervisorSignature"
                      help="Hand them your device to sign. Add their name under Supervisor verification."
                    />
                  ) : (
                    <p className="text-sm text-earth-500 dark:text-earth-400 mt-3">
                      {tr('Add their name and email above. When you save, we’ll give you a ready-made email to send them with a link to sign.')}
                    </p>
                  )}
                </div>
              )}

              {signing.studentSignature && (
                <SignatureField
                  label={tr('Your signature *')}
                  form={form}
                  setForm={setForm}
                  field="studentSignature"
                  help={form.studentSigned && !form.studentSignature ? 'You signed this entry on another device.' : null}
                />
              )}

              {signing.googleForm && (
                <div className="space-y-3">
                  <iframe
                    src={signing.googleForm}
                    title={tr('Your school’s form')}
                    className="w-full h-[640px] rounded-xl border border-earth-200 dark:border-[#1f2e25] bg-white"
                    loading="lazy"
                  />
                  <a href={signatures.formUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 dark:text-brand-400 inline-flex items-center gap-1">
                    <ExternalLink className="w-3.5 h-3.5" />{' '}{tr('Form not loading? Open it in a new tab')}
                  </a>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={Boolean(form.formSubmitted)}
                      onChange={(e) => setForm((f) => ({ ...f, formSubmitted: e.target.checked }))}
                    />
                    {tr('I filled in and sent the form *')}
                  </label>
                </div>
              )}

              {signing.signedFormUpload && (
                <p className="text-sm text-earth-500 dark:text-earth-400">
                  {signatures.formUrl ? (
                    <a href={signatures.formUrl} target="_blank" rel="noopener noreferrer" className="text-brand-600 dark:text-brand-400 font-medium inline-flex items-center gap-1">
                      <ExternalLink className="w-4 h-4" />{' '}{tr('Download your school’s form')}
                    </a>
                  ) : tr('Use the form your school gave you.')}
                  {' '}
                  {FORM_SIGNING_STEPS[signatures.signer]}
                </p>
              )}
            </Card>
          )}

          {customFields.length > 0 && (
            <Card>
              <SectionTitle icon={ClipboardList}>
                {requirements.schoolName ? tr('{school} asks', { school: requirements.schoolName }) : tr('Your school asks')}
              </SectionTitle>
              <p className="text-sm text-earth-500 dark:text-earth-400 -mt-2 mb-4">
                {tr('Extra questions your school added to this form.')}
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
                {requirements.schoolName ? tr('{school} requires', { school: requirements.schoolName }) : tr('Your requirements')}
              </SectionTitle>
              {requirements.goalHours != null && (
                <p className="text-sm mb-2">
                  <span className="font-semibold text-brand-700 dark:text-brand-300">{requirements.goalHours}{' '}{tr('hours')}</span>
                  {policy.goals.deadline ? ` ${tr('by')} ${policy.goals.deadline}` : tr(' total')}
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
                <p className="text-xs text-earth-400 mt-2">{tr('Set by')}{' '}{requirements.organizationName}.</p>
              )}
            </Card>
          )}
          <Card>
            <SectionTitle icon={Upload}>{signing.signedFormUpload ? tr('Signed form') : tr('Proof')} {required.proofRequired ? '*' : ''}</SectionTitle>
            <p className="text-sm text-earth-500 dark:text-earth-400 -mt-2 mb-4">
              {signing.signedFormUpload
                ? tr('Upload a photo or scan of your school’s form, signed.')
                : tr('Upload a photo of a sign-in sheet, a thank-you email, or any supporting document.')}
            </p>
            <FileDrop
              value={form.proof}
              onFile={(f) => setForm((s) => ({ ...s, proof: f }))}
              onClear={() => setForm((s) => ({ ...s, proof: null }))}
            />
          </Card>

          <Card>
            {error && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 rounded-lg mb-3">{error}</div>}
            {editingLocked && (
              <div className="text-sm text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-300 px-3 py-2 rounded-lg mb-3">{tr(lockedMessage(requirements.policy))}</div>
            )}
            <button type="submit" disabled={saving || editingLocked} className="btn-primary w-full disabled:opacity-60">
              <Save className="w-4 h-4" /> {saving ? tr('Saving…') : editId ? tr('Save changes') : tr('Save hours')}
            </button>
            {editId && !editingLocked && (
              <button
                type="button"
                className="btn-ghost w-full mt-2 text-red-600"
                onClick={() => { removeLog(editId); onCloseEdit?.() }}
              >
                <Trash2 className="w-4 h-4" />{' '}{tr('Delete this entry')}
              </button>
            )}
            <button
              type="button"
              className="btn-ghost w-full mt-2"
              onClick={() => nav('/calendar')}
            >
              {tr('View all entries')}
            </button>
          </Card>
        </div>
      </form>

      <Toast open={toast} onClose={() => setToast(false)}>
        {editId ? tr('Entry updated') : tr('Hours saved — nice work!')}
      </Toast>
    </AppLayout>
  )
}

// What to do with the school's printable form, by who has to sign it.
const FORM_SIGNING_STEPS = {
  student: tr('Sign it, then upload a photo or scan under Signed form.'),
  supervisor: tr('Have your supervisor sign it, then upload a photo or scan under Signed form.'),
  both: tr('Sign it and have your supervisor sign it, then upload a photo or scan under Signed form.'),
}

// A signature pad bound to one form field (a PNG data URL).
function SignatureField({ label, form, setForm, field, help }) {
  return (
    <div className="mt-4 first:mt-0">
      <label className="label flex items-center gap-1.5">{label}</label>
      <SignaturePad
        value={form[field]}
        onChange={(sig) => setForm((f) => ({ ...f, [field]: sig }))}
      />
      {help && <p className="text-xs text-earth-400 mt-1">{help}</p>}
    </div>
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
          <option value="">{tr('Select…')}</option>
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

// The email a student sends their supervisor — or the task's organizer — when
// they weren't there to sign. Plain text, so it reads the same pasted into any
// mail app.
function buildSigningEmail({ to, supervisorName, studentName, hours, activity, date, taskTitle, link, logId, serverId }) {
  const when = fmtDateLong(date)
  const subject = `Please confirm my volunteer hours: ${activity}, ${when}`
  const body = [
    supervisorName ? `Hi ${supervisorName},` : 'Hi,',
    '',
    `I volunteered ${hours} hour(s) on ${when} for "${activity}"${taskTitle ? ` (${taskTitle})` : ''}. My school asks for a signature to confirm it.`,
    '',
    'Could you take a minute to review and sign here?',
    link,
    '',
    'It opens in your browser — no account needed.',
    '',
    'Thank you!',
    studentName || '',
  ].join('\n').trim()
  return { to, supervisorName, hours, activity, subject, body, logId, serverId }
}

function SigningEmailCard({ draft, onChange, onClose, onSendForMe }) {
  const [copied, setCopied] = useState(false)
  const [sending, setSending] = useState(false)
  const mailto = `mailto:${encodeURIComponent(draft.to || '')}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.body}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <SectionTitle icon={Mail}>{tr('Send this to get it signed')}</SectionTitle>
        <button type="button" onClick={onClose} className="btn-sm btn-ghost" aria-label={tr('Close')}>
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="text-sm text-earth-500 dark:text-earth-400 -mt-2 mb-4">
        {tr('Your hours are saved. Send this from your own email — the link lets them sign, and this entry updates once they do.')}
      </p>
      <div className="space-y-3">
        <div>
          <label className="label">{tr('To')}</label>
          <input className="input" type="email" value={draft.to || ''} onChange={(e) => onChange({ ...draft, to: e.target.value })} />
        </div>
        <div>
          <label className="label">{tr('Subject')}</label>
          <input className="input" value={draft.subject} onChange={(e) => onChange({ ...draft, subject: e.target.value })} />
        </div>
        <div>
          <label className="label">{tr('Message')}</label>
          <textarea className="input min-h-[220px] resize-y font-mono text-xs" value={draft.body} onChange={(e) => onChange({ ...draft, body: e.target.value })} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        <a href={mailto} className="btn-primary btn-sm"><Send className="w-4 h-4" />{' '}{tr('Open in my email app')}</a>
        <button type="button" onClick={copy} className="btn-secondary btn-sm"><Copy className="w-4 h-4" /> {copied ? tr('Copied!') : tr('Copy email')}</button>
        <button
          type="button"
          disabled={sending || !draft.to}
          onClick={async () => { setSending(true); await onSendForMe(); setSending(false) }}
          className="btn-ghost btn-sm"
        >
          {sending ? tr('Sending…') : tr('Email it for me instead')}
        </button>
      </div>
    </Card>
  )
}
