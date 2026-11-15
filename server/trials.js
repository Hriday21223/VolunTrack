import { query } from './db.js'
import { uid } from './ids.js'
import { clubStudentCount, CLUB_STUDENT_LIMIT } from './plans.js'
import { sendTrialEndingEmail, sendTrialEndedEmail, sendAdminTrialEndedEmail } from './email.js'

// Free trials (#892, #894). A school or organization on a trial has
// payment_status 'paid' and a trial_ends_at. Marking it paid or unpaid by
// hand clears the trial.
//
// runTrialJob() (hourly from .github/workflows/end-trials.yml, and on server
// start) does two things:
//  - emails the main account 7 days and 1 day before the end
//    (trial_reminder_days remembers the last one sent, so none repeats);
//  - ends trials that are over. A club that upgraded with a code
//    (trial_from_club) and still has at most CLUB_STUDENT_LIMIT students goes
//    back to the free club plan; anything else turns unpaid, and a school
//    plan then locks until the admin marks it paid.
const KINDS = [
  { table: 'schools', entity: 'school', role: 'school', owner: 'school_id' },
  { table: 'organizations', entity: 'organization', role: 'org', owner: 'organization_id' },
]

// Main account(s) to tell, never @test.com fixtures.
async function recipients(kind, id) {
  const { rows } = await query(
    `SELECT email, name, language FROM users
      WHERE ${kind.owner} = $1 AND role = $2 AND email IS NOT NULL AND LOWER(email) NOT LIKE '%@test.com'`,
    [id, kind.role],
  )
  return rows
}

// Whether a school would go back to a free club when its trial ends.
async function backToClub(kind, row) {
  if (kind.entity !== 'school' || !row.trial_from_club) return false
  return (await clubStudentCount(row.id)) <= CLUB_STUDENT_LIMIT
}

export async function sendTrialReminders() {
  let sent = 0
  for (const kind of KINDS) {
    // Claim first, so two runs at once can't both send.
    const { rows } = await query(
      `UPDATE ${kind.table} t SET trial_reminder_days = x.stage
         FROM (SELECT id, CASE WHEN trial_ends_at <= now() + interval '1 day' THEN 1 ELSE 7 END AS stage
                 FROM ${kind.table}
                WHERE trial_ends_at > now() AND trial_ends_at <= now() + interval '7 days') x
        WHERE t.id = x.id AND (t.trial_reminder_days IS NULL OR t.trial_reminder_days > x.stage)
        RETURNING t.id, t.name, t.trial_ends_at, ${kind.entity === 'school' ? 't.trial_from_club' : 'false AS trial_from_club'}`,
    )
    for (const row of rows) {
      const toClub = await backToClub(kind, row)
      for (const r of await recipients(kind, row.id)) {
        await sendTrialEndingEmail({ to: r.email, name: r.name, language: r.language, accountName: row.name, endsAt: row.trial_ends_at, backToClub: toClub })
          .then(() => { sent++ })
          .catch((e) => console.error('trial reminder failed:', e.message))
      }
    }
  }
  return sent
}

export async function endExpiredTrials() {
  const ended = { schools: 0, organizations: 0, backToClub: 0 }
  for (const kind of KINDS) {
    const { rows } = await query(
      `SELECT id, name, contact_email, ${kind.entity === 'school' ? 'trial_from_club' : 'false AS trial_from_club'}
         FROM ${kind.table} WHERE trial_ends_at IS NOT NULL AND trial_ends_at <= now()`,
    )
    for (const row of rows) {
      const toClub = await backToClub(kind, row)
      // Guarded on trial_ends_at, so a second run (or a hand change) wins once.
      const { rowCount } = toClub
        ? await query(
          `UPDATE schools SET plan = 'club', payment_status = 'unpaid', paid_at = NULL, trial_ends_at = NULL,
                  trial_from_club = false, trial_reminder_days = NULL
            WHERE id = $1 AND trial_ends_at IS NOT NULL AND trial_ends_at <= now()`,
          [row.id],
        )
        : await query(
          `UPDATE ${kind.table} SET payment_status = 'unpaid', paid_at = NULL, trial_ends_at = NULL, trial_reminder_days = NULL
                  ${kind.entity === 'school' ? ', trial_from_club = false' : ''}
            WHERE id = $1 AND trial_ends_at IS NOT NULL AND trial_ends_at <= now()`,
          [row.id],
        )
      if (!rowCount) continue
      ended[kind.table]++
      if (toClub) ended.backToClub++
      await query(
        `INSERT INTO payment_events (id, entity_type, entity_id, event_type, notes) VALUES ($1, $2, $3, 'status_unpaid', $4)`,
        [uid('pev'), kind.entity, row.id, toClub ? 'Free trial ended: back to the free club plan' : 'Free trial ended'],
      ).catch((e) => console.error('trial end event failed:', e.message))
      // And the admin, to follow up (#897); not for @test.com fixtures.
      if (!String(row.contact_email || '').toLowerCase().endsWith('@test.com')) {
        await sendAdminTrialEndedEmail({ accountName: row.name, entity: kind.entity, backToClub: toClub, contactEmail: row.contact_email })
          .catch((e) => console.error('admin trial ended email failed:', e.message))
      }
      for (const r of await recipients(kind, row.id)) {
        await sendTrialEndedEmail({ to: r.email, name: r.name, language: r.language, accountName: row.name, backToClub: toClub })
          .catch((e) => console.error('trial ended email failed:', e.message))
      }
    }
  }
  return ended
}

export async function runTrialJob() {
  const reminders = await sendTrialReminders()
  const ended = await endExpiredTrials()
  return { reminders, ...ended }
}

// Starts a free trial of `days` on a school or organization: paid until then.
export async function startTrial(entity, entityId, days) {
  if (!days) return
  const table = entity === 'organization' ? 'organizations' : 'schools'
  await query(
    `UPDATE ${table} SET payment_status = 'paid', paid_at = now(), trial_ends_at = now() + make_interval(days => $2::int), trial_reminder_days = NULL${table === 'schools' ? ', had_trial_at = COALESCE(had_trial_at, now())' : ''} WHERE id = $1`,
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
