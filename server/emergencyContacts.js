// Emergency contact for a student at volunteer events (#639). A linked parent
// sets a name and phone; the event's organizer (or co-host) sees it on the
// check-in list on the day of the event and the day either side (time zones),
// and nowhere else: not in exports, reports, the API or emails.
//
// The phone is encrypted at rest when APP_ENCRYPTION_KEY is set.
import { query } from './db.js'
import { encryptSecret, decryptSecret, hasEncryptionKey } from './secrets.js'

const ENC = 'enc:'

/** A cleaned phone number, or null if it doesn't look like one. */
export function cleanPhone(value) {
  const raw = String(value ?? '').trim()
  if (!/^[+(\d][\d\s().-]{5,24}$/.test(raw)) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return null
  return raw.replace(/\s+/g, ' ')
}

function seal(phone) {
  return hasEncryptionKey() ? ENC + encryptSecret(phone) : phone
}
function open(stored) {
  if (!stored) return null
  if (!stored.startsWith(ENC)) return stored
  try { return decryptSecret(stored.slice(ENC.length)) } catch { return null }
}

export async function saveEmergencyContact(childId, parentId, { name, phone }) {
  await query(
    `INSERT INTO emergency_contacts (child_id, parent_id, name, phone, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (child_id) DO UPDATE SET parent_id = $2, name = $3, phone = $4, updated_at = now()`,
    [childId, parentId, name, seal(phone)],
  )
}

export async function deleteEmergencyContact(childId) {
  await query('DELETE FROM emergency_contacts WHERE child_id = $1', [childId])
}

/** Map of childId → { name, phone } for the given children. */
export async function emergencyContactsFor(childIds) {
  const out = new Map()
  if (!childIds?.length) return out
  const { rows } = await query('SELECT child_id, name, phone FROM emergency_contacts WHERE child_id = ANY($1::text[])', [childIds])
  for (const r of rows) {
    const phone = open(r.phone)
    if (phone) out.set(r.child_id, { name: r.name || null, phone })
  }
  return out
}
