import { randomBytes } from 'crypto'

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
  const bytes = randomBytes(8)
  let s = ''
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return `${s.slice(0, 4)}-${s.slice(4)}`
}
