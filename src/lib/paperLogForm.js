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
