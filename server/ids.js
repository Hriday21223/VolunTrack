import { randomBytes, randomInt } from 'crypto'

// Prefixed, reasonably-unique ids that mirror the client's uid() style.
export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`
}

// Unguessable token for links that grant access with no login (e.g. a
// supervisor approving hours via an emailed link).
export function generateToken() {
  return randomBytes(32).toString('hex')
}

// Short, human-shareable code (e.g. "K7XQ-2M9P") for a parent to type in to
// link to their child's account. Avoids visually ambiguous characters
// (0/O, 1/I/L).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function generateChildLinkCode() {
  // randomInt() is rejection-sampled, so every character is equally likely —
  // `randomBytes()[i] % 30` would skew toward the start of the alphabet.
  let s = ''
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return `${s.slice(0, 4)}-${s.slice(4)}`
}

// Permanent, human-quotable billing identifier for a school or organization
// (e.g. "VT-SCH-4F2K9A"). Shown on invoices and payment notices so a customer
// has something short to put in a bank transfer reference, and the admin has
// something to match the incoming payment against. Reuses CODE_ALPHABET so the
// code survives being read aloud or copied off a printed invoice.
export function generateAccountCode(kind) {
  let s = ''
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return `VT-${kind}-${s}`
}

// A school's own shareable referral code (e.g. "LINCOLN-R7K2"). Unlike the
// account code this is meant to be passed around — printed in an invite email,
// read out at a conference — so it leads with a slug of the customer's own name
// to make it recognisable, and falls back to a generic prefix for a name with
// no usable letters. The random tail is what actually makes it unique;
// the slug is only there to make it memorable.
export function generateReferralCode(name) {
  // First word only, so "Lincoln High School" reads LINCOLN-… rather than
  // being chopped mid-word into LINCOLNHIG-….
  const slug = (String(name || '').toUpperCase().match(/[A-Z]+/) || [''])[0].slice(0, 10)
  let tail = ''
  for (let i = 0; i < 4; i++) tail += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return `${slug || 'VOLUN'}-${tail}`
}

// Numeric one-time code for emailed recovery flows. From the CSPRNG, not
// Math.random(): this is a credential, and a predictable one lets an attacker
// guess the code that was mailed to someone else. Zero-padded so a leading
// zero survives, and rejection-sampled by randomInt() so every value is
// equally likely.
export function generateNumericCode(digits = 6) {
  return String(randomInt(0, 10 ** digits)).padStart(digits, '0')
}
