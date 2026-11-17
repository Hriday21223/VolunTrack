// Client side of the one-time registration codes (#287). The server ignores
// case, spaces and dashes, so this only formats for readability.
export function formatRegistrationCode(value) {
  const raw = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)
  return raw.match(/.{1,4}/g)?.join('-') || ''
}

// 16 for a one-time registration code; an event code from our team (#907) is 6–16.
export const isCompleteRegistrationCode = (value) => {
  const n = String(value || '').replace(/[^A-Za-z0-9]/g, '').length
  return n >= 6 && n <= 16
}
