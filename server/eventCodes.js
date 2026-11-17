import { query } from './db.js'

// Event codes (#907): for an event the VolunTrack team hosts. The admin makes
// one code per team member (e.g. ALEXFAIR26), so they can see who brought in
// whom. Unlike a registration or upgrade code, one event code works for many
// schools, up to max_uses. It can give any mix of:
//  - a free trial (trial_days), on sign-up or on a club upgrade;
//  - a discount (percent_off) on the account's first invoice;
//  - a free club upgrade (club_upgrade): a free club becomes a school plan.
// A school or organization may also sign up with it (it stands in for a
// registration code) when its audience allows.
export const EVENT_AUDIENCES = ['school', 'organization', 'both']
export const EVENT_CODE_MIN = 6
export const EVENT_CODE_MAX = 16

export function normalizeEventCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function validEventCode(code) {
  const c = normalizeEventCode(code)
  return c.length >= EVENT_CODE_MIN && c.length <= EVENT_CODE_MAX ? c : null
}

// An active, unexpired code with uses left, or null.
export async function findEventCode(code) {
  const c = validEventCode(code)
  if (!c) return null
  const { rows } = await query(
    `SELECT * FROM event_codes
      WHERE code = $1 AND active AND (expires_at IS NULL OR expires_at > now())
        AND (max_uses IS NULL OR uses < max_uses)`,
    [c],
  )
  return rows[0] || null
}

function audienceAllows(row, entity) {
  return row.audience === 'both' || row.audience === entity
}

// Spends one use in a single UPDATE, so two sign-ups racing for the last use
// can't both win. `kind` is 'register' or 'upgrade'. → the code row or null.
export async function spendEventCode(code, { entity, kind }) {
  const c = validEventCode(code)
  if (!c) return null
  const { rows } = await query(
    `UPDATE event_codes SET uses = uses + 1
      WHERE code = $1 AND active AND (expires_at IS NULL OR expires_at > now())
        AND (max_uses IS NULL OR uses < max_uses)
        AND (audience = 'both' OR audience = $2)
        AND ($3 <> 'upgrade' OR club_upgrade)
      RETURNING *`,
    [c, entity, kind],
  )
  const row = rows[0]
  return row && audienceAllows(row, entity) ? row : null
}

// Gives a use back when the sign-up it was spent on fails afterwards.
export async function releaseEventCode(id) {
  if (!id) return
  await query('UPDATE event_codes SET uses = GREATEST(uses - 1, 0) WHERE id = $1', [id])
}

// Who used it, for the admin's list.
export async function recordEventCodeUse(codeId, { entity, entityId, kind }) {
  await query(
    `INSERT INTO event_code_uses (code_id, entity_type, entity_id, kind) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [codeId, entity, entityId, kind],
  )
  const table = entity === 'organization' ? 'organizations' : 'schools'
  await query(`UPDATE ${table} SET event_code_id = $1 WHERE id = $2`, [codeId, entityId])
}
