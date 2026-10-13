// Input checks shared by the routes. Each one exists because the database
// would otherwise either accept nonsense or answer with a 500.

// No single session is longer than a day.
export const MAX_HOURS_PER_ENTRY = 24

// 'YYYY-MM-DD' that is also a real calendar day. Postgres rejects anything
// else with a DateTimeParseError, which surfaced as a 500.
export function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

// Text fields on a log. The body limit alone allowed a megabyte in each.
export const LOG_TEXT_LIMITS = [
  ['Activity', 'activity', 200],
  ['Category', 'category', 100],
  ['Notes', 'notes', 2000],
  ['Location', 'location', 300],
  ['Organization name', 'orgName', 200],
  ['Supervisor name', 'supervisorName', 200],
]

export function logTextError(body) {
  for (const [label, key, max] of LOG_TEXT_LIMITS) {
    const value = body[key]
    if (value != null && (typeof value !== 'string' || value.length > max)) {
      return `${label} must be text of at most ${max} characters.`
    }
  }
  return null
}

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', '12345678', '123456789',
  '1234567890', '11111111', '00000000', 'qwertyui', 'qwerty123', 'qwertyuiop',
  'iloveyou', 'letmein1', 'welcome1', 'admin123', 'abc12345', 'abcd1234',
  'voluntrack', 'volunteer', 'football', 'baseball', 'sunshine', 'princess',
])

// Deliberately narrow: only passwords an attacker tries first. Applied when a
// password is set, never at sign-in, so nobody is locked out of an account.
export function isWeakPassword(password) {
  const p = String(password || '')
  if (/^(.)\1+$/.test(p)) return true
  return COMMON_PASSWORDS.has(p.toLowerCase())
}

export const WEAK_PASSWORD_MESSAGE = 'That password is too easy to guess. Please choose a different one.'
