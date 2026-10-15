import { query, hasDatabase } from './db.js'
import { encryptSecret, decryptSecret, hasEncryptionKey } from './secrets.js'
import { setEmailOverrides } from './email.js'

// Email provider keys an admin set in Admin → Settings, so a revoked Brevo key
// or Gmail app password can be replaced without editing Render and waiting for
// a redeploy. Stored in one site_settings row as encrypted fields; whatever is
// set wins over the matching env var (see server/email.js), and clearing a
// field falls back to the env var again. See #302.

const SETTINGS_KEY = 'email_overrides'

// Request field → stored field. The request names are what the admin UI sends.
export const EMAIL_KEY_FIELDS = {
  brevoApiKey: 'brevoKeyEnc',
  smtpPassword: 'smtpPasswordEnc',
}

async function readStored() {
  const { rows } = await query('SELECT value FROM site_settings WHERE key = $1', [SETTINGS_KEY])
  if (rows.length === 0) return {}
  try {
    return JSON.parse(rows[0].value) || {}
  } catch {
    return {}
  }
}

function decryptField(stored, field) {
  try {
    return decryptSecret(stored[field])
  } catch (error) {
    // Usually APP_ENCRYPTION_KEY was rotated. Keep sending with the env var
    // rather than failing every email; the admin can re-enter the key.
    console.error(`email override ${field} could not be decrypted — using the env var instead:`, error.message)
    return null
  }
}

// Called at startup and after every save. Never throws: email must keep
// working on the env vars even if this row can't be read.
export async function loadEmailOverrides() {
  if (!hasDatabase() || !hasEncryptionKey()) return
  try {
    const stored = await readStored()
    setEmailOverrides({
      brevoKey: decryptField(stored, 'brevoKeyEnc'),
      smtpPassword: decryptField(stored, 'smtpPasswordEnc'),
    })
  } catch (error) {
    console.error('loading email overrides failed:', error.message)
  }
}

// `set` maps request field names to new plaintext values; `clear` lists request
// field names to drop. Callers validate both and check hasEncryptionKey() first.
export async function saveEmailOverrides({ set = {}, clear = [] }) {
  const stored = await readStored()
  for (const [field, value] of Object.entries(set)) {
    stored[EMAIL_KEY_FIELDS[field]] = encryptSecret(value)
  }
  for (const field of clear) delete stored[EMAIL_KEY_FIELDS[field]]

  if (Object.values(stored).some(Boolean)) {
    await query(
      `INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
      [SETTINGS_KEY, JSON.stringify(stored)],
    )
  } else {
    // value is NOT NULL, and an empty row would only mean "no overrides" anyway.
    await query('DELETE FROM site_settings WHERE key = $1', [SETTINGS_KEY])
  }
  await loadEmailOverrides()
}
