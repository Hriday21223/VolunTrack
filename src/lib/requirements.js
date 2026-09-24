// Client side of tenant-defined requirements. The rules themselves live in
// server/requirements.js and are imported here through the @policy alias, so
// the Log Hours form and the API apply one implementation rather than two that
// drift apart. See server/routes/requirements.js for the endpoints.

import { useEffect, useState } from 'react'
import { resolvePolicy, validateLogAgainstPolicy, goalHoursFor } from '@policy'

export { validateLogAgainstPolicy, goalHoursFor }
export { CUSTOM_FIELD_TYPES, SECTIONS, DEFAULTS, normalizePolicy } from '@policy'

const apiUrl = import.meta.env.VITE_API_URL || '/api'

function authHeaders() {
  const token = localStorage.getItem('voluntrack:auth_token')
  return token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } : null
}

// What an account with no school — or no backend at all — is held to. The app
// is fully usable in client-only mode, so this has to be a real answer rather
// than a loading state that never resolves.
export const NO_TENANT = (() => {
  const { policy, sources } = resolvePolicy({})
  return { policy, sources, schoolName: null, organizationName: null, goalHours: null, grade: null }
})()

export async function fetchMyRequirements() {
  const headers = authHeaders()
  if (!headers) return NO_TENANT
  try {
    const res = await fetch(`${apiUrl}/requirements/mine`, { headers })
    if (!res.ok) return NO_TENANT
    const body = await res.json()
    return { ...NO_TENANT, ...body }
  } catch {
    return NO_TENANT
  }
}

/** The caller's effective requirements, with the permissive default up front. */
export function useMyRequirements() {
  const [state, setState] = useState({ ...NO_TENANT, loading: true })
  useEffect(() => {
    let live = true
    fetchMyRequirements().then((r) => { if (live) setState({ ...r, loading: false }) })
    return () => { live = false }
  }, [])
  return state
}

/**
 * Which of the form's own long-standing required fields still apply.
 *
 * Location, supervisor and proof have always been mandatory on this form, and
 * a tenant that has configured nothing keeps that — the permissive server
 * defaults exist so the *API* behaves as it always did, not to quietly relax
 * the form for every school at once.
 *
 * Once a school or org does define logRules, that policy is the answer,
 * including switching one of these off: a tenant that says proof is optional
 * has said so deliberately.
 */
export function formFieldRequirements({ policy, sources }) {
  const configured = sources?.logRules === 'school' || sources?.logRules === 'organization'
  const rules = policy?.logRules || {}
  if (!configured) {
    return { locationRequired: true, supervisorRequired: true, proofRequired: true, orgNameRequired: false }
  }
  return {
    locationRequired: Boolean(rules.locationRequired),
    supervisorRequired: Boolean(rules.supervisorRequired),
    proofRequired: Boolean(rules.proofRequired),
    orgNameRequired: Boolean(rules.orgNameRequired),
  }
}

/** Human-readable list of the extra rules, for a "what my school asks" panel. */
export function describePolicy(policy) {
  const rules = policy?.logRules
  if (!rules) return []
  const out = []
  if (rules.proofRequired) out.push('A proof file on every entry')
  if (rules.supervisorRequired) out.push('A supervisor name and email')
  if (rules.locationRequired) out.push('A location')
  if (rules.orgNameRequired) out.push('The organization you volunteered with')
  if (rules.notesMinLength > 0) out.push(`A description of at least ${rules.notesMinLength} characters`)
  if (rules.minHoursPerEntry != null) out.push(`At least ${rules.minHoursPerEntry} hour(s) per entry`)
  if (rules.maxHoursPerEntry != null) out.push(`At most ${rules.maxHoursPerEntry} hour(s) per entry`)
  if (rules.maxHoursPerDay != null) out.push(`At most ${rules.maxHoursPerDay} hour(s) on one day`)
  if (rules.maxBackdateDays != null) out.push(`Logged within ${rules.maxBackdateDays} day(s) of the activity`)
  if (!rules.allowFutureDates) out.push('No future-dated entries')
  if (rules.allowedCategories?.length) out.push(`Only these categories: ${rules.allowedCategories.join(', ')}`)
  return out
}

// ---------------------------------------------------------------------------
// Admin editor
// ---------------------------------------------------------------------------

export async function fetchSchoolRequirements() {
  const headers = authHeaders()
  if (!headers) throw new Error('Sign in to manage requirements.')
  const res = await fetch(`${apiUrl}/requirements/school`, { headers })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'Could not load requirements.')
  return body
}

export async function saveSchoolRequirements(policy) {
  const headers = authHeaders()
  if (!headers) throw new Error('Sign in to manage requirements.')
  const res = await fetch(`${apiUrl}/requirements/school`, { method: 'PUT', headers, body: JSON.stringify(policy) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'Could not save requirements.')
  return body
}

export async function fetchOrgRequirements() {
  const headers = authHeaders()
  if (!headers) throw new Error('Sign in to manage requirements.')
  const res = await fetch(`${apiUrl}/requirements/organization`, { headers })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'Could not load requirements.')
  return body
}

export async function saveOrgRequirements(policy) {
  const headers = authHeaders()
  if (!headers) throw new Error('Sign in to manage requirements.')
  const res = await fetch(`${apiUrl}/requirements/organization`, { method: 'PUT', headers, body: JSON.stringify(policy) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'Could not save requirements.')
  return body
}
