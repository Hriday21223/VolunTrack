// A relative path (not the @policy alias) so the unit tests can load it too.
import { signatureNeeds } from '../../server/requirements.js'

// Fits Scan a paper log to the student's school (src/components/ScanPaperLog.jsx):
// the blank log's columns follow what that school's Log Hours asks for, and
// what can't be written on paper is listed so the student knows to add it
// in VolunTrack after scanning. Pure, so the PDF and the card agree.

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Column titles for the blank paper log, in order. */
export function paperLogColumns(policy) {
  const rules = policy?.logRules || {}
  const needs = signatureNeeds(policy)
  const cols = ['Date', 'Activity / Place', 'Hours']
  if (rules.allowedCategories?.length) cols.push('Category')
  if (rules.orgNameRequired) cols.push('Organization')
  if (rules.locationRequired) cols.push('Location')
  cols.push('Supervisor')
  if (rules.supervisorRequired || needs.supervisorSignature) cols.push('Supervisor email')
  if (rules.notesMinLength > 0) cols.push('What you did')
  for (const f of policy?.customFields || []) {
    cols.push(clip(`${f.label}${f.required ? ' *' : ''}${f.type === 'checkbox' ? ' (yes/no)' : ''}`, 28))
  }
  cols.push('Supervisor signature')
  if (needs.studentSignature) cols.push('Your signature')
  return cols
}

/** What the school asks for that can't go on paper; added in VolunTrack after scanning. */
export function paperLogLaterItems(policy) {
  const rules = policy?.logRules || {}
  const needs = signatureNeeds(policy)
  const out = []
  if (rules.proofRequired || needs.signedFormUpload) out.push(needs.signedFormUpload ? 'a photo of your school’s signed form' : 'a proof file')
  if (needs.studentSignature) out.push('your signature in the app')
  if (needs.formSubmitted) out.push('your school’s online form')
  return out
}

/**
 * The fields the school asks for beyond date, activity, hours, organization
 * and supervisor name, for the scan's review list: each scanned row gets a box
 * for them, so what the student wrote in those columns on paper can be typed
 * in (or checked, when the reader filled it) without leaving the list.
 * Keys match the Log Hours entry: location, supervisorEmail, category,
 * description (saved into notes), and custom:<key> for the school's own.
 */
export function paperLogExtraFields(policy) {
  const rules = policy?.logRules || {}
  const needs = signatureNeeds(policy)
  const out = []
  if (rules.allowedCategories?.length) out.push({ key: 'category', label: 'Category', type: 'select', options: rules.allowedCategories, required: true })
  if (rules.locationRequired) out.push({ key: 'location', label: 'Location', type: 'text', required: true })
  if (rules.supervisorRequired || needs.supervisorSignature) out.push({ key: 'supervisorEmail', label: 'Supervisor email', type: 'email', required: true })
  if (rules.notesMinLength > 0) out.push({ key: 'description', label: 'Description', type: 'text', required: true, minLength: rules.notesMinLength })
  for (const f of policy?.customFields || []) {
    out.push({ key: `custom:${f.key}`, label: f.label, type: f.type || 'text', options: f.options || [], required: Boolean(f.required), custom: true })
  }
  return out
}
