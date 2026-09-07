import { createHmac } from 'crypto'
import { query, hasDatabase } from './db.js'
import { uid } from './ids.js'

// Append-only audit trail for access to student data. See #146.
//
// The rule this module exists to enforce: a *read* of a minor's record must
// leave a trace. Authorization across server/routes/*.js is default-deny and
// sound, but a permitted read used to be invisible — so "which staff member
// opened this student's file?" had no answer anywhere in the system.
//
// Critically, this must be the write path for presigned download URLs (#143
// step 2). A presigned URL is a bearer credential that outlives the request:
// the tenant's object store only ever sees "an access key fetched an object",
// never which VolunTrack user asked for it. The mint call is the only moment
// that identity exists. If it isn't recorded here, it is gone for good.

// Actions are a closed set so a typo can't silently create a category nobody
// queries. Add deliberately.
export const AUDIT = {
  PROOF_URL_MINTED: 'proof.download_url_minted',
  PDF_READ: 'pdf.read',
  STUDENT_ADDED: 'student.added',
  STUDENT_LIST_READ: 'student.list_read',
  STAFF_ADDED: 'staff.added',
  STAFF_REMOVED: 'staff.removed',
  HOURS_REVIEWED: 'hours.reviewed',
  PDF_REVIEWED: 'pdf.reviewed',
  SSO_CONFIG_CHANGED: 'sso.config_changed',
  STORAGE_CONFIG_CHANGED: 'storage.config_changed',
}

// Correlates events by the same person after their account is deleted (the
// FKs null out, deliberately) without retaining the identity. Keyed off a
// dedicated secret so rotating it only breaks correlation, never data.
function actorHash(actorId) {
  if (!actorId) return null
  const key = process.env.AUDIT_HASH_KEY || process.env.JWT_SECRET
  if (!key) return null
  return createHmac('sha256', key).update(String(actorId)).digest('hex').slice(0, 32)
}

// Proxied requests put the real client first in X-Forwarded-For. Render sits
// behind a proxy, so req.ip alone is the load balancer.
function clientIp(req) {
  const forwarded = req?.headers?.['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim().slice(0, 64)
  return (req?.ip || '').slice(0, 64) || null
}

/**
 * Record one audit event. Never throws and never blocks the caller's
 * response: a failed audit write must not turn a legitimate read into a 500.
 * It is logged loudly instead, so a broken trail is visible in the logs
 * rather than silently empty.
 *
 * Deliberately NOT awaited by route handlers — call it and move on.
 */
export function recordAudit(req, {
  action,
  outcome = 'allowed',
  subjectUserId = null,
  schoolId = null,
  organizationId = null,
  objectType = null,
  objectId = null,
  meta = null,
}) {
  if (!hasDatabase() || !action) return

  const auth = req?.auth || {}
  const actorId = auth.sub || null

  // Fire-and-forget. The returned promise is intentionally unawaited; the
  // .catch() keeps it from ever becoming an unhandled rejection.
  query(
    `INSERT INTO audit_events
       (id, actor_id, actor_role, actor_hash, action, outcome, subject_user_id,
        school_id, organization_id, object_type, object_id, ip, user_agent, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      uid('aud'),
      actorId,
      auth.role || 'anonymous',
      actorHash(actorId),
      action,
      outcome,
      subjectUserId,
      schoolId,
      organizationId,
      objectType,
      objectId,
      clientIp(req),
      (req?.headers?.['user-agent'] || '').slice(0, 300) || null,
      // Never put a credential in here — notably not a presigned URL, which
      // is itself a live grant. Store the object key and expiry instead.
      meta ? JSON.stringify(meta) : null,
    ],
  ).catch((error) => {
    console.error('audit write failed:', action, error.message)
  })
}

// Events older than this are pruned. Long enough to investigate an incident
// reported a school year later; bounded so the table can't grow forever on a
// free-tier Postgres.
export function retentionDays() {
  const raw = Number(process.env.AUDIT_RETENTION_DAYS)
  return Number.isFinite(raw) && raw >= 30 ? Math.floor(raw) : 400
}

export async function pruneAuditEvents() {
  const days = retentionDays()
  const { rowCount } = await query(
    `DELETE FROM audit_events WHERE created_at < now() - ($1 || ' days')::interval`,
    [String(days)],
  )
  return { deleted: rowCount || 0, retentionDays: days }
}
