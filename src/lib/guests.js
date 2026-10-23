import { tr } from '@/lib/i18n.js'

// Group sign-ups (#439): the same limits as server/spots.js.
export const MAX_GUESTS = 3
export const GUEST_NAME_MAX = 40

// "+2 guests (Ana, Leo)", or '' for none.
export function guestSummary(count, names) {
  const n = Number(count) || 0
  if (n <= 0) return ''
  const label = n === 1 ? tr('+1 guest') : tr('+{n} guests', { n })
  const list = (Array.isArray(names) ? names : []).filter(Boolean)
  return list.length ? `${label} (${list.join(', ')})` : label
}

// The guest rows for the printed sign-in sheet: a named guest, or a blank
// line to write one in, each marked with who brought them.
export function guestSheetRows(signup) {
  const n = Number(signup?.guest_count) || 0
  const host = String(signup?.name || '').trim() || 'Volunteer'
  const names = Array.isArray(signup?.guest_names) ? signup.guest_names.filter(Boolean) : []
  return Array.from({ length: n }, (_, i) => (names[i] ? `${names[i]} (guest of ${host})` : `Guest of ${host}: `))
}
