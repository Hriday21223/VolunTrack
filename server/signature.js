// Drawn signatures (src/components/SignaturePad.jsx) arrive as small PNG data
// URLs. Every route that stores one — a supervisor approving from the emailed
// link, a task organizer approving on My Tasks — holds it to this one rule.

export const MAX_SIGNATURE_LENGTH = 200_000

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/

export function isSignatureImage(value) {
  return typeof value === 'string'
    && value.length <= MAX_SIGNATURE_LENGTH
    && PNG_DATA_URL.test(value)
}
