// Sign-up age rules, shared by the form (src/pages/Register.jsx, via the
// @ageRules alias) and POST /api/auth/register, which enforces them. The date
// of birth is used only to apply these rules and is never stored; the server
// keeps just users.under_13.
//
// - student:   under 13 needs a parent or guardian's emailed approval
// - volunteer: 13 or older
// - parent:    18 or older

export const MIN_AGE = { volunteer: 13, parent: 18 }
export const CONSENT_AGE = 13

const ROLE_TOO_YOUNG = {
  volunteer: "Volunteer Task Maker accounts are for people 13 or older. If you're younger, sign up as a student instead — we'll ask a parent or guardian to approve it.",
  parent: 'Parent accounts are for adults 18 or older. If you are a student, sign up as a student instead.',
}

// 'YYYY-MM-DD' (what <input type="date"> gives) → { y, m, d }, or null if it
// isn't a real calendar date.
export function parseBirthDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''))
  if (!match) return null
  const [y, m, d] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return { y, m, d }
}

// Whole years old on `today` (local calendar date).
export function ageOn({ y, m, d }, today = new Date()) {
  const ty = today.getFullYear()
  const tm = today.getMonth() + 1
  const td = today.getDate()
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0)
}

// → { error } when the date is missing or invalid or the role's minimum isn't
// met; otherwise { age, under13 }.
export function checkSignupAge(role, dateOfBirth, today = new Date()) {
  const birth = parseBirthDate(dateOfBirth)
  if (!birth) return { error: 'Enter your date of birth.' }
  const age = ageOn(birth, today)
  if (age < 0) return { error: "Your date of birth can't be in the future." }
  if (age > 120) return { error: 'Check the year of your date of birth.' }
  if (MIN_AGE[role] && age < MIN_AGE[role]) return { error: ROLE_TOO_YOUNG[role], tooYoung: true }
  return { age, under13: age < CONSENT_AGE }
}
