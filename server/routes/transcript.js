import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { uid } from '../ids.js'
import { recordAudit, AUDIT } from '../audit.js'
import {
  TRANSCRIPT_FORMAT,
  TRANSCRIPT_VERSION,
  emailHash,
  hasSigningKey,
  publicKeys,
  signTranscript,
  verifyTranscript,
} from '../transcript.js'

// Signed transcript export, public verification, and import (#143 Part B).
// The signing itself lives in server/transcript.js.

const router = express.Router()

function limiter(max, message) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
  })
}

const issueLimiter = limiter(20, 'Too many transcript requests. Please try again later.')
const verifyLimiter = limiter(60, 'Too many verification requests. Please try again later.')
const importLimiter = limiter(10, 'Too many transcript imports. Please try again later.')

// Keeps a transcript comfortably under the global 1MB JSON body limit, so any
// transcript we issue can also be uploaded back to verify or import it.
const MAX_TRANSCRIPT_LOGS = 1000

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// Same posture as APP_ENCRYPTION_KEY for SSO and storage: without the key the
// feature is off, not degraded into unsigned exports someone might trust.
function requireSigningKey(_req, res, next) {
  if (!hasSigningKey()) {
    return res.status(503).json({ error: 'Signed transcripts are not available: TRANSCRIPT_SIGNING_KEY is not configured.' })
  }
  next()
}

// Verifying only needs a public key, so a deployment that has retired its
// signing key can still vouch for what it issued.
function requireTrustedKey(_req, res, next) {
  if (publicKeys().length === 0) {
    return res.status(503).json({ error: 'Transcript verification is not available on this server.' })
  }
  next()
}

const REASONS = {
  not_a_transcript: 'This is not a VolunTrack transcript file.',
  unsupported_version: 'This transcript uses a format version this server does not understand.',
  missing_signature: 'This transcript is not signed.',
  unknown_key: 'This transcript was signed with a key this server does not recognize.',
  bad_signature: 'The signature does not match. The file has been altered since it was issued.',
}

function iso(value) {
  return value ? new Date(value).toISOString() : null
}

function round2(n) {
  return Math.round(n * 100) / 100
}

function verifyUrl() {
  const base = String(process.env.FRONTEND_URL || '').replace(/\/$/, '')
  return base ? `${base}/verify-transcript` : null
}

// What the transcript attests about one log's verification.
function verificationFor(row) {
  const status = row.verification_status || 'none'
  const att = row.import_attestation

  // An imported log keeps the attestation it arrived with for as long as
  // nothing here has decided it again. A school re-reviewing it sets
  // verified_by; editing its facts clears import_attestation (logs.js PATCH).
  if (att?.verification && !row.verified_by_role) {
    const importedAs = att.verification.status === 'approved' || att.verification.status === 'rejected'
      ? att.verification.status
      : 'none'
    if (importedAs === status) return att.verification
  }

  let verifiedByRole = null
  let decidedAt = null
  if (status === 'approved' || status === 'rejected') {
    if (row.verified_by_role) {
      // Set by a school/org decision on the dashboard, which is the latest
      // write when both it and a supervisor link exist.
      verifiedByRole = row.verified_by_role
    } else if (row.supervisor_status === status) {
      verifiedByRole = 'supervisor'
      decidedAt = iso(row.supervisor_responded_at)
    }
  }
  return {
    status,
    supervisor_name: row.supervisor_name || null,
    supervisor_email_hash: emailHash(row.supervisor_email),
    verified_by_role: verifiedByRole,
    decided_at: decidedAt,
  }
}

function logEntry(row) {
  const att = row.import_attestation
  const ownProof = Boolean(row.has_proof)
  return {
    id: row.id,
    // Stable across hops: a log imported from one transcript and re-exported
    // keeps the id of the log it originally was, which is what import dedupes on.
    source_id: row.import_source_id || row.id,
    date: row.date,
    activity: row.activity || null,
    category: row.category || null,
    hours: Number(row.hours) || 0,
    organization: row.org_name || null,
    verification: verificationFor(row),
    // The file itself stays in whichever bucket it was uploaded to; the
    // transcript only says one exists and who holds it.
    proof: ownProof
      ? { present: true, mime: row.proof_mime || null, retained_by: row.proof_retained_by || null }
      : att?.proof || { present: false, mime: null, retained_by: null },
    imported_from: row.imported_transcript_id && att
      ? { transcript_id: att.transcript_id || null, issued_at: att.issued_at || null, issuer: att.issuer || null }
      : null,
  }
}

// POST /api/transcript — issue a signed transcript of the caller's own logs.
// Only logs saved to the account are included: a log that never left this
// device's localStorage is not something the server can vouch for.
router.post('/', issueLimiter, requireDb, requireSigningKey, requireAuth('student', 'volunteer'), async (req, res) => {
  try {
    const { rows: users } = await query(
      `SELECT u.id, u.name, u.email, u.school_id, s.name AS school_name,
              s.organization_id, o.name AS organization_name
         FROM users u
         LEFT JOIN schools s ON s.id = u.school_id
         LEFT JOIN organizations o ON o.id = s.organization_id
        WHERE u.id = $1`,
      [req.auth.sub],
    )
    const me = users[0]
    if (!me) return res.status(404).json({ error: 'Account not found.' })

    const { rows } = await query(
      `SELECT l.id, to_char(l.date, 'YYYY-MM-DD') AS date, l.activity, l.category, l.hours,
              l.org_name, l.supervisor_name, l.supervisor_email, l.verification_status,
              (l.proof_key IS NOT NULL) AS has_proof, l.proof_mime,
              COALESCE(ps.name, po.name) AS proof_retained_by,
              vu.role AS verified_by_role,
              sv.status AS supervisor_status, sv.responded_at AS supervisor_responded_at,
              l.import_source_id, l.imported_transcript_id, l.import_attestation
         FROM logs l
         LEFT JOIN tenant_storage ts ON ts.id = l.proof_storage_id
         LEFT JOIN schools ps ON ps.id = ts.school_id
         LEFT JOIN organizations po ON po.id = ts.organization_id
         LEFT JOIN users vu ON vu.id = l.verified_by
         LEFT JOIN LATERAL (
           SELECT v.status, v.responded_at
             FROM supervisor_verifications v
            WHERE (v.log_id = l.id OR (l.verification_token IS NOT NULL AND v.token = l.verification_token))
              AND v.status IN ('approved', 'rejected')
            ORDER BY v.responded_at DESC NULLS LAST
            LIMIT 1
         ) sv ON true
        WHERE l.user_id = $1
        ORDER BY l.date, l.created_at
        LIMIT $2`,
      [me.id, MAX_TRANSCRIPT_LOGS + 1],
    )
    if (rows.length > MAX_TRANSCRIPT_LOGS) {
      return res.status(422).json({ error: `A transcript can hold at most ${MAX_TRANSCRIPT_LOGS} entries.` })
    }

    const logs = rows.map(logEntry)
    // Rejected hours are listed but not counted, matching the school hours
    // report: approved + unverified == total.
    const counted = logs.filter((l) => l.verification.status !== 'rejected')
    const transcriptId = uid('tx')

    const doc = signTranscript({
      format: TRANSCRIPT_FORMAT,
      version: TRANSCRIPT_VERSION,
      transcript_id: transcriptId,
      issued_at: new Date().toISOString(),
      verify_url: verifyUrl(),
      issuer: {
        platform: 'VolunTrack',
        school: me.school_name || null,
        school_id: me.school_id || null,
        organization: me.organization_name || null,
      },
      student: {
        name: me.name,
        email_hash: emailHash(me.email),
        account_id: me.id,
      },
      totals: {
        entries: logs.length,
        hours: round2(counted.reduce((s, l) => s + l.hours, 0)),
        approved_hours: round2(logs.filter((l) => l.verification.status === 'approved').reduce((s, l) => s + l.hours, 0)),
      },
      logs,
    })

    recordAudit(req, {
      action: AUDIT.TRANSCRIPT_ISSUED,
      subjectUserId: me.id,
      schoolId: me.school_id,
      organizationId: me.organization_id,
      objectType: 'transcript',
      objectId: transcriptId,
      meta: { entries: logs.length, keyId: doc.signature.key_id },
    })

    return res.json({ transcript: doc })
  } catch (error) {
    console.error('issue transcript failed:', error)
    return res.status(500).json({ error: 'Could not create the transcript.' })
  }
})

// GET /api/transcript/keys — every public key this server accepts, so a
// receiver can verify offline instead of trusting this endpoint.
router.get('/keys', verifyLimiter, (_req, res) => {
  return res.json({ canonicalization: 'RFC8785', keys: publicKeys() })
})

// POST /api/transcript/verify — public, no account. The body is the
// transcript itself. Nothing is stored and no student record is read.
router.post('/verify', verifyLimiter, requireTrustedKey, (req, res) => {
  const doc = req.body
  const result = verifyTranscript(doc)
  if (!result.valid) {
    return res.json({ valid: false, reason: result.reason, message: REASONS[result.reason] })
  }
  return res.json({
    valid: true,
    keyId: result.keyId,
    keyStatus: result.keyStatus,
    summary: {
      transcriptId: doc.transcript_id,
      issuedAt: doc.issued_at,
      studentName: doc.student?.name || null,
      issuer: doc.issuer || null,
      totals: doc.totals || null,
    },
  })
})

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function optionalText(value, max) {
  return typeof value === 'string' && value ? value.slice(0, max) : null
}

// POST /api/transcript/import — add a verified transcript's logs to the
// caller's account, with their verification status intact.
router.post('/import', importLimiter, requireDb, requireTrustedKey, requireAuth('student', 'volunteer'), async (req, res) => {
  const doc = req.body
  const result = verifyTranscript(doc)
  if (!result.valid) return res.status(400).json({ error: REASONS[result.reason], reason: result.reason })
  if (!Array.isArray(doc.logs)) return res.status(400).json({ error: REASONS.not_a_transcript })
  if (doc.logs.length > MAX_TRANSCRIPT_LOGS) {
    return res.status(413).json({ error: `A transcript can hold at most ${MAX_TRANSCRIPT_LOGS} entries.` })
  }

  try {
    const { rows: users } = await query(
      `SELECT u.email, u.school_id, s.organization_id
         FROM users u LEFT JOIN schools s ON s.id = u.school_id
        WHERE u.id = $1`,
      [req.auth.sub],
    )
    const me = users[0]
    if (!me) return res.status(404).json({ error: 'Account not found.' })

    const audit = {
      action: AUDIT.TRANSCRIPT_IMPORTED,
      subjectUserId: req.auth.sub,
      schoolId: me.school_id,
      organizationId: me.organization_id,
      objectType: 'transcript',
      objectId: String(doc.transcript_id || '').slice(0, 100) || null,
    }

    // A valid signature proves we issued the file, not that the person
    // uploading it is the student it was issued to. Without this, one
    // student's approved hours could be imported into anyone's account.
    if (!doc.student?.email_hash || doc.student.email_hash !== emailHash(me.email)) {
      recordAudit(req, { ...audit, outcome: 'denied', meta: { reason: 'email_mismatch', keyId: result.keyId } })
      return res.status(403).json({
        error: 'This transcript was issued to a different email address than the one on your account.',
      })
    }

    const entries = []
    for (const entry of doc.logs) {
      const hours = Number(entry?.hours)
      const sourceId = optionalText(entry?.source_id, 100) || optionalText(entry?.id, 100)
      if (!sourceId || !DATE_RE.test(String(entry?.date)) || !Number.isFinite(hours) || hours <= 0) {
        return res.status(400).json({ error: 'The transcript contains an entry that cannot be imported.' })
      }
      const verification = entry.verification && typeof entry.verification === 'object' ? entry.verification : null
      // Only a final decision carries over. A pending request was tied to the
      // old log's supervisor link, which will never report back to this one.
      const status = verification?.status === 'approved' || verification?.status === 'rejected'
        ? verification.status
        : 'none'
      const origin = entry.imported_from && typeof entry.imported_from === 'object' ? entry.imported_from : null
      entries.push({
        id: uid('log'),
        source_id: sourceId,
        date: entry.date,
        activity: optionalText(entry.activity, 500),
        category: optionalText(entry.category, 100),
        hours,
        org_name: optionalText(entry.organization, 300),
        supervisor_name: optionalText(verification?.supervisor_name, 200),
        verification_status: status,
        // Provenance points at the transcript the log first came from, so a
        // log re-exported and re-imported still names its original issuer.
        attestation: {
          transcript_id: origin?.transcript_id || doc.transcript_id || null,
          issued_at: origin?.issued_at || doc.issued_at || null,
          issuer: origin?.issuer || doc.issuer || null,
          verification,
          proof: entry.proof && typeof entry.proof === 'object' ? entry.proof : null,
        },
      })
    }

    // One statement, so a partial import can't happen. Skips any log this
    // account already holds — its own original (a transcript re-imported into
    // the account that issued it) or an earlier import of the same log (two
    // overlapping transcripts) — so hours can never be counted twice.
    const { rows: inserted } = entries.length === 0 ? { rows: [] } : await query(
      `INSERT INTO logs (id, user_id, date, activity, category, hours, org_name, supervisor_name,
                         verification_status, import_source_id, imported_transcript_id, import_attestation)
       SELECT r.id, $1, r.date::date, r.activity, r.category, r.hours, r.org_name, r.supervisor_name,
              r.verification_status, r.source_id, $3, r.attestation
         FROM jsonb_to_recordset($2::jsonb) AS r(
                id text, source_id text, date text, activity text, category text, hours numeric,
                org_name text, supervisor_name text, verification_status text, attestation jsonb)
        WHERE NOT EXISTS (
                SELECT 1 FROM logs e
                 WHERE e.user_id = $1 AND (e.id = r.source_id OR e.import_source_id = r.source_id))
       ON CONFLICT (user_id, import_source_id) WHERE import_source_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [req.auth.sub, JSON.stringify(entries), audit.objectId],
    )

    const imported = inserted.length
    recordAudit(req, { ...audit, meta: { keyId: result.keyId, imported, skipped: entries.length - imported } })
    return res.json({ imported, skipped: entries.length - imported, transcriptId: audit.objectId })
  } catch (error) {
    console.error('import transcript failed:', error)
    return res.status(500).json({ error: 'Could not import the transcript.' })
  }
})

export default router
