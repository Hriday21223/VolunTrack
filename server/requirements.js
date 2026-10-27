// Tenant-defined requirements ("how this school wants hours logged").
//
// A school — or the organization that owns it — describes its own rules here
// instead of every tenant getting the one hard-coded form. Six sections, each
// independently inheritable:
//
//   logRules     what an hour entry must contain to be accepted
//   customFields extra questions this tenant adds to the Log Hours form
//   goals        the service-hour requirement a student is working toward
//   signIn       how this tenant's students are allowed to authenticate
//   signatures   whether an entry must be signed, by whom, or carry a signed form
//   certificates who signs the certificates the school prints, and what they say
//
// Inheritance is per section, not per field: a school either overrides a whole
// section or inherits the org's. Per-field merging reads fine in a diff and
// terribly in a UI — "where did this number come from?" needs one answer.
//
// Every default is fully permissive. Adding this feature must change nothing
// for a tenant that has not configured it, so an empty policy has to behave
// exactly like the form did before.

export const POLICY_VERSION = 1

export const SECTIONS = ['logRules', 'customFields', 'goals', 'signIn', 'signatures', 'certificates']

export const DEFAULT_LOG_RULES = {
  proofRequired: false,
  supervisorRequired: false,
  locationRequired: false,
  orgNameRequired: false,
  notesMinLength: 0,
  minHoursPerEntry: null,
  maxHoursPerEntry: null,
  maxHoursPerDay: null,
  maxBackdateDays: null,
  allowFutureDates: true,
  allowedCategories: [],
}

export const DEFAULT_GOALS = {
  totalHours: null,
  byGrade: {},
  deadline: null,
  note: '',
}

export const DEFAULT_SIGN_IN = {
  ssoOnly: false,
  allowedEmailDomains: [],
}

// mode    'none'      — nothing to sign (the default)
//         'signature' — the entry itself is signed, drawn on screen
//         'paperForm' — the school's own form, filled in or signed and handed back
// signer  who signs: 'supervisor', 'student' or 'both'
// formUrl where the school's form lives. A Google Form is filled in right on
//         the Log Hours page; anything else is a file to print, sign and upload.
export const SIGNATURE_MODES = ['none', 'signature', 'paperForm']
export const SIGNERS = ['supervisor', 'student', 'both']

export const DEFAULT_SIGNATURES = {
  mode: 'none',
  signer: 'supervisor',
  formUrl: '',
  note: '',
}

// Blank fields fall back when printing: the signer to the school's name, the
// title to "Adviser", the heading to the school's name, the note to the usual
// thank-you line. Often it's the principal or a counselor who signs, not the adviser.
// signStyle  'typed' — the signer's name in a script font (the default)
//            'drawn' — a signature drawn once on screen (signatureImage, a PNG)
//            'blank' — an empty line, to sign each printed copy with a pen
export const CERTIFICATE_SIGN_STYLES = ['typed', 'drawn', 'blank']

export const DEFAULT_CERTIFICATES = {
  signStyle: 'typed',
  signatureImage: '',
  signerName: '',
  signerTitle: '',
  title: '',
  note: '',
}

export const DEFAULTS = {
  logRules: DEFAULT_LOG_RULES,
  customFields: [],
  goals: DEFAULT_GOALS,
  signIn: DEFAULT_SIGN_IN,
  signatures: DEFAULT_SIGNATURES,
  certificates: DEFAULT_CERTIFICATES,
}

export const CUSTOM_FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'checkbox']

export const MAX_CUSTOM_FIELDS = 12
export const MAX_SELECT_OPTIONS = 30

// ---------------------------------------------------------------------------
// Normalization
//
// Policies are written by tenant admins through the API, so nothing that comes
// back out of the database is trusted to have the right shape: a row written by
// an older version, or by a caller poking at the endpoint, is coerced here
// rather than at every read site.
// ---------------------------------------------------------------------------

function bool(value, fallback = false) {
  if (value === true || value === false) return value
  return fallback
}

function posNumber(value, { max = 1000 } = {}) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(n, max)
}

function posInt(value, { max = 100000 } = {}) {
  const n = posNumber(value, { max })
  return n === null ? null : Math.round(n)
}

function text(value, max) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

function isoDate(value) {
  const s = text(value, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null
}

// A domain, not a URL and not an email. Stored lowercase and bare so the login
// check is a plain suffix comparison rather than a parse.
function domain(value) {
  const s = text(value, 253).toLowerCase().replace(/^@/, '')
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s) ? s : null
}

function normalizeLogRules(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const categories = Array.isArray(raw.allowedCategories)
    ? [...new Set(raw.allowedCategories.map((c) => text(c, 60)).filter(Boolean))].slice(0, 40)
    : []
  const min = posNumber(raw.minHoursPerEntry, { max: 24 })
  let max = posNumber(raw.maxHoursPerEntry, { max: 24 })
  // A max below the min can never be satisfied, so it would reject every entry
  // with two contradictory messages. Drop the max instead of shipping a policy
  // nobody can comply with.
  if (min !== null && max !== null && max < min) max = null
  return {
    proofRequired: bool(raw.proofRequired),
    supervisorRequired: bool(raw.supervisorRequired),
    locationRequired: bool(raw.locationRequired),
    orgNameRequired: bool(raw.orgNameRequired),
    notesMinLength: posInt(raw.notesMinLength, { max: 2000 }) || 0,
    minHoursPerEntry: min,
    maxHoursPerEntry: max,
    maxHoursPerDay: posNumber(raw.maxHoursPerDay, { max: 24 }),
    maxBackdateDays: posInt(raw.maxBackdateDays, { max: 3650 }),
    allowFutureDates: bool(raw.allowFutureDates, true),
    allowedCategories: categories,
  }
}

// Keys address a stored answer forever, so they are slugged once here and then
// left alone — renaming a field's label must not orphan the answers already
// filed under it.
function fieldKey(value, index) {
  const slug = text(value, 40).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return slug || `field_${index + 1}`
}

function normalizeCustomFields(input) {
  if (!Array.isArray(input)) return []
  const seen = new Set()
  const out = []
  for (const raw of input.slice(0, MAX_CUSTOM_FIELDS)) {
    if (!raw || typeof raw !== 'object') continue
    const label = text(raw.label, 80)
    if (!label) continue
    let key = fieldKey(raw.key || label, out.length)
    while (seen.has(key)) key = `${key}_${out.length + 1}`
    seen.add(key)
    const type = CUSTOM_FIELD_TYPES.includes(raw.type) ? raw.type : 'text'
    const options = type === 'select' && Array.isArray(raw.options)
      ? [...new Set(raw.options.map((o) => text(o, 80)).filter(Boolean))].slice(0, MAX_SELECT_OPTIONS)
      : []
    // A select with no options is an unanswerable required question.
    if (type === 'select' && options.length === 0) continue
    out.push({
      key,
      label,
      type,
      required: bool(raw.required),
      help: text(raw.help, 200),
      options,
    })
  }
  return out
}

function normalizeGoals(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const byGrade = {}
  if (raw.byGrade && typeof raw.byGrade === 'object' && !Array.isArray(raw.byGrade)) {
    for (const [grade, hours] of Object.entries(raw.byGrade).slice(0, 20)) {
      const g = gradeKey(text(grade, 20))
      const h = posNumber(hours, { max: 10000 })
      if (g && h !== null) byGrade[g] = h
    }
  }
  return {
    totalHours: posNumber(raw.totalHours, { max: 10000 }),
    byGrade,
    deadline: isoDate(raw.deadline),
    note: text(raw.note, 300),
  }
}

function normalizeSignIn(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const domains = Array.isArray(raw.allowedEmailDomains)
    ? [...new Set(raw.allowedEmailDomains.map(domain).filter(Boolean))].slice(0, 20)
    : []
  return {
    ssoOnly: bool(raw.ssoOnly),
    allowedEmailDomains: domains,
  }
}

// https only: the link is shown to students and, for a Google Form, framed
// inside the app — a javascript: or http: URL has no business in either.
function httpsUrl(value) {
  const s = text(value, 500)
  if (!s) return ''
  try {
    const url = new URL(s)
    return url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

function normalizeSignatures(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const mode = SIGNATURE_MODES.includes(raw.mode) ? raw.mode : 'none'
  return {
    mode,
    signer: SIGNERS.includes(raw.signer) ? raw.signer : 'supervisor',
    formUrl: mode === 'paperForm' ? httpsUrl(raw.formUrl) : '',
    note: text(raw.note, 300),
  }
}

// SignaturePad exports a 400×150 PNG, a few KB; the cap keeps a pasted photo
// out of a policy every student downloads.
const SIGNATURE_PNG = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/
const MAX_SIGNATURE_CHARS = 100_000

/** A signature drawn on SignaturePad: a PNG data URL of sane size. */
export function isSignaturePng(value) {
  return typeof value === 'string' && value.length <= MAX_SIGNATURE_CHARS && SIGNATURE_PNG.test(value)
}

function normalizeCertificates(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const signStyle = CERTIFICATE_SIGN_STYLES.includes(raw.signStyle) ? raw.signStyle : 'typed'
  const image = typeof raw.signatureImage === 'string' ? raw.signatureImage : ''
  return {
    signStyle,
    signatureImage: signStyle === 'drawn' && isSignaturePng(image) ? image : '',
    signerName: text(raw.signerName, 80),
    signerTitle: text(raw.signerTitle, 60),
    title: text(raw.title, 80),
    note: text(raw.note, 200),
  }
}

/**
 * What kind of form link a school pasted:
 *   { kind: 'embed', embedUrl } — a public Google Form, filled in on Log Hours
 *   { kind: 'editor' }  — a Google Form's edit link: students hit a sign-in wall
 *   { kind: 'short' }   — a forms.gle link: its redirect drops `embedded=true`
 *   { kind: 'file' }    — anything else: downloaded, signed and uploaded
 * or null for something that isn't a URL. The settings editor warns from the
 * same answer the Log Hours form acts on.
 */
export function classifyFormUrl(formUrl) {
  let url
  try { url = new URL(formUrl) } catch { return null }
  if (url.hostname === 'forms.gle') return { kind: 'short' }
  if (url.hostname === 'docs.google.com' && url.pathname.startsWith('/forms/d/')) {
    const match = url.pathname.match(/^\/forms\/d\/e\/([A-Za-z0-9_-]+)\/(viewform|formResponse)?\/?$/)
    if (match && url.protocol === 'https:') {
      return { kind: 'embed', embedUrl: `https://docs.google.com/forms/d/e/${match[1]}/viewform?embedded=true` }
    }
    if (!url.pathname.startsWith('/forms/d/e/')) return { kind: 'editor' }
  }
  return { kind: 'file' }
}

/** The embeddable address of a Google Form, or null for any other link. */
export function googleFormEmbedUrl(formUrl) {
  return classifyFormUrl(formUrl)?.embedUrl ?? null
}

/** What one entry has to carry to satisfy the signatures section. */
export function signatureNeeds(policy) {
  const sig = policy?.signatures || DEFAULT_SIGNATURES
  const supervisor = sig.signer === 'supervisor' || sig.signer === 'both'
  const student = sig.signer === 'student' || sig.signer === 'both'
  const googleForm = sig.mode === 'paperForm' ? googleFormEmbedUrl(sig.formUrl) : null
  return {
    supervisorSignature: sig.mode === 'signature' && supervisor,
    studentSignature: sig.mode === 'signature' && student,
    // A Google Form's answers land with the school, never with us, so the
    // student's word that they sent it is all there is to check.
    formSubmitted: sig.mode === 'paperForm' && Boolean(googleForm),
    signedFormUpload: sig.mode === 'paperForm' && !googleForm,
    googleForm,
  }
}

const NORMALIZERS = {
  logRules: normalizeLogRules,
  customFields: normalizeCustomFields,
  goals: normalizeGoals,
  signIn: normalizeSignIn,
  signatures: normalizeSignatures,
  certificates: normalizeCertificates,
}

/**
 * Coerce a stored or submitted policy into its canonical shape.
 *
 * A section that is absent or null stays absent — that is what "inherit" is
 * stored as, and collapsing it into defaults here would silently turn every
 * school into an overrider the first time it saved anything.
 */
export function normalizePolicy(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const out = { version: POLICY_VERSION }
  for (const section of SECTIONS) {
    if (raw[section] === undefined || raw[section] === null) continue
    out[section] = NORMALIZERS[section](raw[section])
  }
  return out
}

/**
 * Resolve the policy a student actually has to satisfy.
 *
 * Returns the fully-populated policy plus, per section, where that section came
 * from — the UI says "inherited from <org>" rather than leaving an admin
 * guessing why a rule they never set is being enforced.
 */
export function resolvePolicy({ schoolPolicy, orgPolicy, orgName } = {}) {
  const school = normalizePolicy(schoolPolicy)
  const org = normalizePolicy(orgPolicy)
  const policy = { version: POLICY_VERSION }
  const sources = {}
  for (const section of SECTIONS) {
    if (school[section] !== undefined) {
      policy[section] = school[section]
      sources[section] = 'school'
    } else if (org[section] !== undefined) {
      policy[section] = org[section]
      sources[section] = 'organization'
    } else {
      policy[section] = NORMALIZERS[section](DEFAULTS[section])
      sources[section] = 'default'
    }
  }
  return { policy, sources, orgName: orgName || null }
}

// ---------------------------------------------------------------------------
// Grades
// ---------------------------------------------------------------------------

// A student's grade is free text on the account, and a school's per-grade
// overrides are keyed by whatever the admin typed. Matching those two exactly
// meant an override for "11" silently missed every student who wrote "11th
// grade" or "Junior" — the rule looked configured and applied to nobody.
// Both sides now go through this, so they meet in the middle.
const GRADE_WORDS = {
  k: 'K', kinder: 'K', kindergarten: 'K',
  first: '1', second: '2', third: '3', fourth: '4', fifth: '5',
  sixth: '6', seventh: '7', eighth: '8',
  ninth: '9', tenth: '10', eleventh: '11', twelfth: '12',
  freshman: '9', freshmen: '9', fresh: '9',
  sophomore: '10', soph: '10',
  junior: '11', jr: '11',
  senior: '12', sr: '12',
  college: 'College', university: 'College', uni: 'College',
}

// 5th grade through 12th, plus College, for the sign-up and profile pickers.
// The matcher below still understands other years, so a school's own older
// data keeps resolving.
export const SCHOOL_GRADES = ['5', '6', '7', '8', '9', '10', '11', '12', 'College']

// What a student in each year is called. Middle school goes by the ordinal,
// high school by the class name a US transcript or reference letter uses —
// which is also what a school admin is most likely to type into a per-grade
// rule, so these double as matching vocabulary in GRADE_WORDS above.
export const GRADE_NAMES = {
  5: 'Fifth grader', 6: 'Sixth grader', 7: 'Seventh grader', 8: 'Eighth grader',
  9: 'Freshman', 10: 'Sophomore', 11: 'Junior', 12: 'Senior',
}

const ORDINAL_SUFFIX = { 1: 'st', 2: 'nd', 3: 'rd' }

/**
 * Canonical form of a grade, for storing and for matching.
 * "11th grade", "Grade 11", "junior", " 11 " → "11". Anything unrecognized
 * keeps its own trimmed text, so a school using its own labels ("Year 12",
 * "Sixth form") still matches students who were given that same label.
 */
export function gradeKey(input) {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  const lower = raw.toLowerCase()

  const letters = lower.replace(/[^a-z]/g, '')
  const word = GRADE_WORDS[letters] || GRADE_WORDS[letters.replace(/(grader|grade|year)$/, '')]
  if (word) return word

  // The first number in the string, when the rest is only grade noise
  // ("11th grade", "grade 11", "yr 11"). A label carrying anything else
  // ("11 and up") is left alone rather than guessed at.
  const match = lower.match(/^(?:grade|yr|year|g)?\s*(\d{1,2})(?:st|nd|rd|th)?\s*(?:grade|yr|year)?$/)
  if (match) {
    const n = Number(match[1])
    if (n >= 1 && n <= 12) return String(n)
  }

  return raw
}

/** How a grade reads in the UI: "11th Grade", "Kindergarten", or as given. */
export function gradeLabel(input) {
  const key = gradeKey(input)
  if (!key) return null
  if (key === 'K') return 'Kindergarten'
  if (!/^\d{1,2}$/.test(key)) return key
  const n = Number(key)
  const teen = n % 100 >= 11 && n % 100 <= 13
  return `${n}${teen ? 'th' : ORDINAL_SUFFIX[n % 10] || 'th'} Grade`
}

/** What a student in that grade is called — "Junior" — where there is a name. */
export function gradeName(input) {
  const key = gradeKey(input)
  return (key && GRADE_NAMES[key]) || null
}

/** Both, for a picker: "11th Grade — Junior". */
export function gradeOptionLabel(input) {
  const label = gradeLabel(input)
  const name = gradeName(input)
  return name ? `${label} — ${name}` : label
}

/** The hour target that applies to one student, grade override first. */
export function goalHoursFor(policy, grade) {
  const goals = policy?.goals || DEFAULT_GOALS
  const key = gradeKey(grade)
  if (key && goals.byGrade) {
    // Exact first — a tenant's own label wins over anything inferred.
    if (goals.byGrade[key] != null) return goals.byGrade[key]
    for (const [stored, hours] of Object.entries(goals.byGrade)) {
      if (hours != null && gradeKey(stored) === key) return hours
    }
  }
  return goals.totalHours ?? null
}

// ---------------------------------------------------------------------------
// Enforcement
// ---------------------------------------------------------------------------

function dayDiff(a, b) {
  return Math.round((a.getTime() - b.getTime()) / 86400000)
}

function parseLogDate(value) {
  const s = typeof value === 'string' ? value.slice(0, 10) : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  // Compared against a UTC-midnight "today" below, so both sides are built the
  // same way — a local-time Date here would make the comparison drift by a day
  // for anyone west of UTC.
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

function todayUtc(now) {
  const d = now instanceof Date ? now : new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/**
 * Check one hour entry against the effective policy.
 *
 * Returns `[{ field, message }]` — empty when the entry complies. The same
 * function backs the client form and the API, so a student sees the rule before
 * they submit and cannot get past it by not being the form.
 *
 * @param {object} entry
 *   date, activity, category, hours, notes, location, orgName, supervisorName,
 *   supervisorEmail, supervisorSignedInPerson, taskId, hasProof, hasStudentSignature,
 *   formSubmitted, customFields,
 *   sameDayHours (hours already logged on that date, excluding this entry)
 */
export function validateLogAgainstPolicy(policy, entry = {}, { now = new Date() } = {}) {
  const rules = policy?.logRules || DEFAULT_LOG_RULES
  const fields = policy?.customFields || []
  const errors = []
  const add = (field, message) => errors.push({ field, message })

  const hours = Number(entry.hours)
  if (Number.isFinite(hours) && hours > 0) {
    if (rules.minHoursPerEntry != null && hours < rules.minHoursPerEntry) {
      add('hours', `Your school requires at least ${rules.minHoursPerEntry} hour(s) per entry.`)
    }
    if (rules.maxHoursPerEntry != null && hours > rules.maxHoursPerEntry) {
      add('hours', `Your school allows at most ${rules.maxHoursPerEntry} hour(s) per entry.`)
    }
    if (rules.maxHoursPerDay != null) {
      const same = Number(entry.sameDayHours) || 0
      if (same + hours > rules.maxHoursPerDay) {
        add('hours', `Your school allows at most ${rules.maxHoursPerDay} hour(s) on one day (you already have ${same} logged that day).`)
      }
    }
  }

  const date = parseLogDate(entry.date)
  if (date) {
    const today = todayUtc(now)
    if (!rules.allowFutureDates && dayDiff(date, today) > 0) {
      add('date', 'Your school does not accept hours dated in the future.')
    }
    // One day of slack: "today" here is UTC's, already tomorrow on a US
    // evening, which would refuse an entry exactly maxBackdateDays old.
    if (rules.maxBackdateDays != null && dayDiff(today, date) > rules.maxBackdateDays + 1) {
      add('date', `Your school requires hours to be logged within ${rules.maxBackdateDays} day(s) of the activity.`)
    }
  }

  if (rules.allowedCategories.length > 0) {
    const category = typeof entry.category === 'string' ? entry.category : ''
    if (!rules.allowedCategories.includes(category)) {
      add('category', `Your school only accepts these categories: ${rules.allowedCategories.join(', ')}.`)
    }
  }

  if (rules.notesMinLength > 0) {
    const notes = typeof entry.notes === 'string' ? entry.notes.trim() : ''
    if (notes.length < rules.notesMinLength) {
      add('notes', `Your school requires a description of at least ${rules.notesMinLength} characters.`)
    }
  }

  if (rules.locationRequired && !text(entry.location, 200)) {
    add('location', 'Your school requires a location for every entry.')
  }
  if (rules.orgNameRequired && !text(entry.orgName, 200)) {
    add('orgName', 'Your school requires the organization you volunteered with.')
  }
  if (rules.supervisorRequired) {
    if (!text(entry.supervisorName, 200)) add('supervisorName', 'Your school requires a supervisor name.')
    if (!text(entry.supervisorEmail, 200)) add('supervisorEmail', 'Your school requires a supervisor email.')
  }
  if (rules.proofRequired && !entry.hasProof) {
    add('proof', 'Your school requires a proof file with every entry.')
  }

  // The supervisor signs on the review link they're emailed, so what the entry
  // needs is somebody to send it to. Skipped when logRules already asked, so
  // the student isn't told the same thing twice.
  const needs = signatureNeeds(policy)
  // Signing in person, on the student's device, needs no email — the email is
  // only how a supervisor who isn't there gets the signing link. Nor does an
  // entry on a VolunTrack task: its organizer signs on their My Tasks page.
  if (needs.supervisorSignature && !rules.supervisorRequired && !entry.taskId) {
    if (!text(entry.supervisorName, 200)) add('supervisorName', 'Your school requires your supervisor to sign — add their name.')
    if (!entry.supervisorSignedInPerson && !text(entry.supervisorEmail, 200)) {
      add('supervisorEmail', 'Your school requires your supervisor to sign — have them sign here, or add their email so they get the signing link.')
    }
  }
  if (needs.studentSignature && !entry.hasStudentSignature) {
    add('studentSignature', 'Your school requires you to sign this entry.')
  }
  if (needs.formSubmitted && !entry.formSubmitted) {
    add('formSubmitted', 'Your school requires its form — fill it in, then tick the box to say you sent it.')
  }
  if (needs.signedFormUpload && !entry.hasProof && !rules.proofRequired) {
    add('proof', 'Your school requires its signed form — upload a photo or scan of it.')
  }

  const answers = entry.customFields && typeof entry.customFields === 'object' ? entry.customFields : {}
  for (const field of fields) {
    const value = answers[field.key]
    const empty = value === undefined || value === null || value === '' || value === false
    if (field.required && empty) {
      add(`custom:${field.key}`, `${field.label} is required by your school.`)
      continue
    }
    if (empty) continue
    if (field.type === 'select' && !field.options.includes(String(value))) {
      add(`custom:${field.key}`, `${field.label} must be one of: ${field.options.join(', ')}.`)
    }
    if (field.type === 'number' && !Number.isFinite(Number(value))) {
      add(`custom:${field.key}`, `${field.label} must be a number.`)
    }
    if (field.type === 'date' && !isoDate(value)) {
      add(`custom:${field.key}`, `${field.label} must be a date.`)
    }
  }

  return errors
}

/**
 * Keep only the answers the policy actually asks for, coerced to the declared
 * type. A client can post anything; what lands in the column is exactly the
 * shape the tenant defined, so a later policy change can't leave junk behind.
 */
export function sanitizeCustomFieldValues(policy, input) {
  const fields = policy?.customFields || []
  if (fields.length === 0) return null
  const answers = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const out = {}
  for (const field of fields) {
    const value = answers[field.key]
    if (value === undefined || value === null || value === '') continue
    if (field.type === 'checkbox') {
      if (value === true || value === 'true') out[field.key] = true
      continue
    }
    if (field.type === 'number') {
      const n = Number(value)
      if (Number.isFinite(n)) out[field.key] = n
      continue
    }
    if (field.type === 'date') {
      const d = isoDate(value)
      if (d) out[field.key] = d
      continue
    }
    if (field.type === 'select') {
      const s = text(value, 80)
      if (field.options.includes(s)) out[field.key] = s
      continue
    }
    out[field.key] = text(value, field.type === 'textarea' ? 2000 : 200)
  }
  return Object.keys(out).length > 0 ? out : null
}

/** Whether an email may sign in under a tenant's domain allowlist. */
export function emailAllowedBySignIn(policy, email) {
  const domains = policy?.signIn?.allowedEmailDomains || []
  if (domains.length === 0) return true
  const at = String(email || '').toLowerCase().lastIndexOf('@')
  if (at === -1) return false
  const host = String(email).toLowerCase().slice(at + 1)
  return domains.some((d) => host === d || host.endsWith(`.${d}`))
}
