// Editor for tenant-defined requirements, shared by the School and
// Organization dashboards. The policy shape and its rules live in
// server/requirements.js; this is only the form over them.
//
// The central idea in the UI is the same one in the data model: a section is
// either inherited or overridden, never half of each. Every section header
// therefore says where the rules in it come from, because an admin looking at
// a rule they did not set needs that answer on the same screen.

import { useCallback, useEffect, useState } from 'react'
import { ClipboardList, Plus, Trash2, RotateCcw } from 'lucide-react'
import Card from '@/components/Card.jsx'
import Toast from '@/components/Toast.jsx'
import { ACTIVITY_CATEGORIES } from '@/lib/categories.js'
import {
  DEFAULTS, SECTIONS, CUSTOM_FIELD_TYPES,
  fetchSchoolRequirements, saveSchoolRequirements,
  fetchOrgRequirements, saveOrgRequirements,
} from '@/lib/requirements.js'

const SECTION_LABELS = {
  logRules: 'Hour-entry rules',
  customFields: 'Extra questions',
  goals: 'Service-hour requirement',
  signIn: 'Sign-in',
}

const SECTION_HELP = {
  logRules: 'What an entry must contain before your students can save it.',
  customFields: 'Your own questions, added to the bottom of the Log Hours form.',
  goals: 'The total each student is working toward. Shown on their dashboard.',
  signIn: 'How students linked to you are allowed to get into their account.',
}

const FIELD_TYPE_LABELS = {
  text: 'Short text',
  textarea: 'Long text',
  number: 'Number',
  date: 'Date',
  select: 'Choose one',
  checkbox: 'Checkbox',
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

export default function RequirementsSettings({ scope = 'school', readOnly = false }) {
  const isSchool = scope === 'school'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [meta, setMeta] = useState({})
  // null for a section means "inherit" — kept distinct from an empty object,
  // which is a deliberate override that happens to turn everything off.
  const [sections, setSections] = useState({ logRules: null, customFields: null, goals: null, signIn: null })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = isSchool ? await fetchSchoolRequirements() : await fetchOrgRequirements()
      setMeta(data)
      const own = data.own || {}
      setSections({
        logRules: own.logRules ? clone(own.logRules) : null,
        customFields: own.customFields ? clone(own.customFields) : null,
        goals: own.goals ? clone(own.goals) : null,
        signIn: own.signIn ? clone(own.signIn) : null,
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [isSchool])

  useEffect(() => { load() }, [load])

  // Starting an override from the values currently in force, not from blank:
  // an admin who overrides a section means "these, but with one change", and
  // resetting everything to defaults on the first click loses the rest.
  const effectiveFor = (section) => {
    if (isSchool && meta.policy?.[section]) return clone(meta.policy[section])
    if (!isSchool && meta.own?.[section]) return clone(meta.own[section])
    return clone(DEFAULTS[section])
  }

  const override = (section) => setSections((s) => ({ ...s, [section]: effectiveFor(section) }))
  const inherit = (section) => setSections((s) => ({ ...s, [section]: null }))
  const patch = (section, changes) =>
    setSections((s) => ({ ...s, [section]: { ...s[section], ...changes } }))

  const onSave = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = {}
      for (const key of SECTIONS) payload[key] = sections[key]
      const data = isSchool ? await saveSchoolRequirements(payload) : await saveOrgRequirements(payload)
      setMeta((m) => ({ ...m, ...data }))
      setToast('Requirements saved.')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Card><p className="text-sm text-earth-500">Loading requirements…</p></Card>

  const sourceNote = (section) => {
    if (sections[section]) return isSchool ? 'Set by your school' : 'Your default'
    if (!isSchool) return 'Not set — schools use VolunTrack defaults'
    const from = meta.sources?.[section]
    if (from === 'organization') return `Inherited from ${meta.organizationName || 'your organization'}`
    return 'VolunTrack defaults'
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-lg font-semibold flex items-center gap-2 mb-1">
          <ClipboardList className="w-4 h-4 text-brand-600" /> Your requirements
        </h2>
        <p className="text-sm text-earth-500 dark:text-earth-400">
          {isSchool
            ? 'Every rule here applies to the students linked to your school. Anything you leave inherited follows your organization, or VolunTrack’s defaults if you have none.'
            : 'These are the defaults for every school you own. A school that sets its own version of a section keeps it — your changes reach the rest.'}
        </p>
        {!isSchool && meta.schoolCount > 0 && (
          <p className="text-xs text-earth-400 mt-2">
            {meta.schoolCount} school(s){meta.overridingSchoolCount > 0
              ? ` — ${meta.overridingSchoolCount} of them override at least one section.`
              : '.'}
          </p>
        )}
      </Card>

      {SECTIONS.map((section) => (
        <Card key={section}>
          <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
            <div>
              <h3 className="font-semibold">{SECTION_LABELS[section]}</h3>
              <p className="text-xs text-earth-500 dark:text-earth-400">{SECTION_HELP[section]}</p>
              <p className="text-xs text-brand-600 dark:text-brand-400 mt-1">{sourceNote(section)}</p>
            </div>
            {!readOnly && (
              sections[section]
                ? (
                  <button type="button" onClick={() => inherit(section)} className="btn-sm btn-ghost shrink-0">
                    <RotateCcw className="w-3.5 h-3.5 mr-1" /> {isSchool ? 'Inherit' : 'Clear'}
                  </button>
                )
                : (
                  <button type="button" onClick={() => override(section)} className="btn-sm btn-secondary shrink-0">
                    {isSchool ? 'Set our own' : 'Set a default'}
                  </button>
                )
            )}
          </div>

          {sections[section] && (
            <fieldset disabled={readOnly} className="space-y-4">
              {section === 'logRules' && <LogRulesEditor value={sections.logRules} onChange={(c) => patch('logRules', c)} />}
              {section === 'goals' && <GoalsEditor value={sections.goals} onChange={(c) => patch('goals', c)} />}
              {section === 'signIn' && <SignInEditor value={sections.signIn} onChange={(c) => patch('signIn', c)} />}
              {section === 'customFields' && (
                <CustomFieldsEditor
                  value={sections.customFields}
                  onChange={(next) => setSections((s) => ({ ...s, customFields: next }))}
                />
              )}
            </fieldset>
          )}
        </Card>
      ))}

      {error && <p className="text-sm text-red-500">{error}</p>}
      {!readOnly && (
        <button type="button" onClick={onSave} disabled={saving} className="btn-primary w-full">
          {saving ? 'Saving…' : 'Save requirements'}
        </button>
      )}

      <Toast open={Boolean(toast)} onClose={() => setToast('')}>{toast}</Toast>
    </div>
  )
}

function Check({ label, checked, onChange, help }) {
  return (
    <div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {help && <p className="text-xs text-earth-400 ml-6">{help}</p>}
    </div>
  )
}

// An empty box is "no limit", which is a different thing from zero — so the
// value is kept as null rather than coerced to a number the rules would then
// enforce.
function NumberBox({ label, value, onChange, placeholder = 'No limit', step = '0.5', min = '0' }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="input"
        type="number"
        step={step}
        min={min}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    </div>
  )
}

function LogRulesEditor({ value, onChange }) {
  const toggleCategory = (cat) => {
    const current = value.allowedCategories || []
    const next = current.includes(cat) ? current.filter((c) => c !== cat) : [...current, cat]
    onChange({ allowedCategories: next })
  }
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-2">
        <Check label="Require a proof file" checked={value.proofRequired} onChange={(v) => onChange({ proofRequired: v })} />
        <Check label="Require a supervisor name and email" checked={value.supervisorRequired} onChange={(v) => onChange({ supervisorRequired: v })} />
        <Check label="Require a location" checked={value.locationRequired} onChange={(v) => onChange({ locationRequired: v })} />
        <Check label="Require the organization name" checked={value.orgNameRequired} onChange={(v) => onChange({ orgNameRequired: v })} />
        <Check label="Allow future-dated entries" checked={value.allowFutureDates} onChange={(v) => onChange({ allowFutureDates: v })} />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <NumberBox label="Minimum hours per entry" value={value.minHoursPerEntry} onChange={(v) => onChange({ minHoursPerEntry: v })} placeholder="No minimum" />
        <NumberBox label="Maximum hours per entry" value={value.maxHoursPerEntry} onChange={(v) => onChange({ maxHoursPerEntry: v })} />
        <NumberBox label="Maximum hours on one day" value={value.maxHoursPerDay} onChange={(v) => onChange({ maxHoursPerDay: v })} />
        <NumberBox label="Log within N days of the activity" value={value.maxBackdateDays} onChange={(v) => onChange({ maxBackdateDays: v })} step="1" placeholder="Any time after" />
        <NumberBox label="Minimum description length" value={value.notesMinLength || null} onChange={(v) => onChange({ notesMinLength: v || 0 })} step="1" placeholder="No minimum" />
      </div>
      <div>
        <label className="label">Allowed categories</label>
        <p className="text-xs text-earth-400 mb-2">Leave all unchecked to accept every category.</p>
        <div className="flex flex-wrap gap-2">
          {ACTIVITY_CATEGORIES.map((cat) => {
            const on = (value.allowedCategories || []).includes(cat)
            return (
              <button
                type="button"
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={`btn-sm ${on ? 'btn-primary' : 'btn-ghost'}`}
              >
                {cat}
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}

function GoalsEditor({ value, onChange }) {
  const grades = Object.entries(value.byGrade || {})
  const setGrade = (grade, hours) => onChange({ byGrade: { ...(value.byGrade || {}), [grade]: hours } })
  const removeGrade = (grade) => {
    const next = { ...(value.byGrade || {}) }
    delete next[grade]
    onChange({ byGrade: next })
  }
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-4">
        <NumberBox label="Total hours required" value={value.totalHours} onChange={(v) => onChange({ totalHours: v })} placeholder="None" />
        <div>
          <label className="label">Deadline</label>
          <input className="input" type="date" value={value.deadline || ''} onChange={(e) => onChange({ deadline: e.target.value || null })} />
        </div>
      </div>
      <div>
        <label className="label">Note to students</label>
        <input className="input" maxLength={300} value={value.note || ''} onChange={(e) => onChange({ note: e.target.value })} placeholder="Due before senior year begins." />
      </div>
      <div>
        <label className="label">Per-grade overrides</label>
        <p className="text-xs text-earth-400 mb-2">
          A student in one of these grades is held to its number instead of the total above.
        </p>
        <div className="space-y-2">
          {grades.map(([grade, hours]) => (
            <div key={grade} className="flex items-center gap-2">
              <span className="text-sm w-24">Grade {grade}</span>
              <input
                className="input flex-1"
                type="number"
                min="0"
                step="0.5"
                value={hours}
                onChange={(e) => setGrade(grade, e.target.value === '' ? 0 : Number(e.target.value))}
              />
              <button type="button" onClick={() => removeGrade(grade)} className="btn-sm btn-ghost text-red-500">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
        <AddGrade existing={value.byGrade || {}} onAdd={(grade) => setGrade(grade, value.totalHours || 0)} />
      </div>
    </>
  )
}

function AddGrade({ existing, onAdd }) {
  const [grade, setGrade] = useState('')
  return (
    <div className="flex gap-2 mt-2">
      <input
        className="input flex-1"
        placeholder="Grade (e.g. 11)"
        value={grade}
        onChange={(e) => setGrade(e.target.value)}
      />
      <button
        type="button"
        className="btn-sm btn-secondary"
        disabled={!grade.trim() || Object.hasOwn(existing, grade.trim())}
        onClick={() => { onAdd(grade.trim()); setGrade('') }}
      >
        <Plus className="w-3.5 h-3.5 mr-1" /> Add
      </button>
    </div>
  )
}

function SignInEditor({ value, onChange }) {
  return (
    <>
      <Check
        label="Students must sign in with our school account (SSO)"
        checked={value.ssoOnly}
        onChange={(v) => onChange({ ssoOnly: v })}
        help="Password sign-in is refused for these accounts. Set up the connection on the Sign-in tab first, or nobody can get in."
      />
      <div>
        <label className="label">Allowed email domains</label>
        <p className="text-xs text-earth-400 mb-2">
          Comma-separated, e.g. <span className="font-mono">school.edu</span>. Only accounts on these domains can join
          with your school code. Students already linked keep their access.
        </p>
        <input
          className="input"
          value={(value.allowedEmailDomains || []).join(', ')}
          onChange={(e) => onChange({
            allowedEmailDomains: e.target.value.split(',').map((d) => d.trim()).filter(Boolean),
          })}
          placeholder="school.edu, students.school.edu"
        />
      </div>
    </>
  )
}

function CustomFieldsEditor({ value, onChange }) {
  const fields = Array.isArray(value) ? value : []
  const update = (index, changes) =>
    onChange(fields.map((f, i) => (i === index ? { ...f, ...changes } : f)))
  const remove = (index) => onChange(fields.filter((_, i) => i !== index))
  const add = () => onChange([...fields, { key: '', label: '', type: 'text', required: false, help: '', options: [] }])

  return (
    <>
      <div className="space-y-3">
        {fields.map((field, index) => (
          <div key={index} className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Question</label>
                <input
                  className="input"
                  maxLength={80}
                  value={field.label}
                  onChange={(e) => update(index, { label: e.target.value })}
                  placeholder="Advisor name"
                />
              </div>
              <div>
                <label className="label">Answer type</label>
                <select className="input" value={field.type} onChange={(e) => update(index, { type: e.target.value })}>
                  {CUSTOM_FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABELS[t] || t}</option>)}
                </select>
              </div>
            </div>
            {field.type === 'select' && (
              <div>
                <label className="label">Choices</label>
                <input
                  className="input"
                  value={(field.options || []).join(', ')}
                  onChange={(e) => update(index, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })}
                  placeholder="First period, Second period, Third period"
                />
                <p className="text-xs text-earth-400 mt-1">Comma-separated. A question with no choices is dropped when you save.</p>
              </div>
            )}
            <div>
              <label className="label">Helper text (optional)</label>
              <input className="input" maxLength={200} value={field.help || ''} onChange={(e) => update(index, { help: e.target.value })} />
            </div>
            <div className="flex items-center justify-between">
              <Check label="Required" checked={field.required} onChange={(v) => update(index, { required: v })} />
              <button type="button" onClick={() => remove(index)} className="btn-sm btn-ghost text-red-500">
                <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove
              </button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={add} className="btn-sm btn-secondary">
        <Plus className="w-3.5 h-3.5 mr-1" /> Add a question
      </button>
    </>
  )
}
