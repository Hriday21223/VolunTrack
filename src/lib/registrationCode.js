// Client side of the one-time registration codes (#287). The server ignores
// case, spaces and dashes, so this only formats for readability.
export function formatRegistrationCode(value) {
  const raw = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)
  return raw.match(/.{1,4}/g)?.join('-') || ''
}

export const isCompleteRegistrationCode = (value) => String(value || '').replace(/[^A-Za-z0-9]/g, '').length === 16
