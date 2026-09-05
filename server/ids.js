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
