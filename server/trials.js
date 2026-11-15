import { query } from './db.js'
import { uid } from './ids.js'

// Free trials (#892). A school or organization on a trial has
// payment_status 'paid' and a trial_ends_at. Once that passes, this turns it
// unpaid (a school plan then locks until the admin marks it paid, as for any
// unpaid school). Marking it paid or unpaid by hand clears the trial.
//
// Run hourly by .github/workflows/end-trials.yml, and on server start.
export async function endExpiredTrials() {
  const ended = { schools: 0, organizations: 0 }
  for (const [table, entity] of [['schools', 'school'], ['organizations', 'organization']]) {
    const { rows } = await query(
      `UPDATE ${table} SET payment_status = 'unpaid', paid_at = NULL, trial_ends_at = NULL
        WHERE trial_ends_at IS NOT NULL AND trial_ends_at <= now()
        RETURNING id`,
    )
    for (const r of rows) {
      await query(
        `INSERT INTO payment_events (id, entity_type, entity_id, event_type, notes) VALUES ($1, $2, $3, 'status_unpaid', 'Free trial ended')`,
        [uid('pev'), entity, r.id],
      ).catch((e) => console.error('trial end event failed:', e.message))
    }
    ended[table] = rows.length
  }
  return ended
}


// Starts a free trial of `days` on a school or organization: paid until then.
export async function startTrial(entity, entityId, days) {
  if (!days) return
  const table = entity === 'organization' ? 'organizations' : 'schools'
  await query(
    `UPDATE ${table} SET payment_status = 'paid', paid_at = now(), trial_ends_at = now() + make_interval(days => $2::int) WHERE id = $1`,
    [entityId, days],
  )
  await query(
    `INSERT INTO payment_events (id, entity_type, entity_id, event_type, notes) VALUES ($1, $2, $3, 'status_paid', $4)`,
    [uid('pev'), entity, entityId, `Free trial (${days} days)`],
  ).catch((e) => console.error('trial start event failed:', e.message))
}

// A registration code's free trial, if it has one (#892).
export async function trialDaysOfRegistrationCode(codeId) {
  if (!codeId) return null
  const { rows } = await query('SELECT trial_days FROM registration_codes WHERE id = $1', [codeId])
  return rows[0]?.trial_days || null
}
