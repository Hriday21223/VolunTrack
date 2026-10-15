import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { isValidDateString, logTextError, MAX_HOURS_PER_ENTRY } from '../validate.js'
import { uid } from '../ids.js'
import { keyBelongsTo } from '../storage/s3.js'
import { emailHash } from '../transcript.js'
import { validateLogAgainstPolicy, sanitizeCustomFieldValues } from '../requirements.js'
import { policyForUser, hoursLoggedOn } from '../policy.js'

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// The sign-off facts a client may report (server/requirements.js signatures
// section). Only `true` counts: the drawings themselves never reach us (#186),
// and a Google Form's answers go to the school, so the client's word is it.
function signoffFlags(body) {
  return {
    hasStudentSignature: body.hasStudentSignature === true,
    formSubmitted: body.formSubmitted === true,
    supervisorSignedInPerson: body.supervisorSignedInPerson === true,
  }
}

// Hold an entry to the rules the student's school set (server/requirements.js).
// The Log Hours form checks the same policy with the same function before it
// submits; this is the copy that counts, because a form is not a boundary.
//
// A tenant that has configured nothing gets the permissive defaults, so this
// returns no errors and the request proceeds exactly as it did before.
async function checkPolicy(req, entry, { excludeLogId = null } = {}) {
  const resolved = await policyForUser(req.auth.sub)
  if (!resolved) return { ok: true, policy: null }
  const { policy } = resolved

  // Only pay for the extra query when a tenant actually set a per-day cap —
  // the rule can't be checked from the submitted entry alone.
  let sameDayHours = 0
  if (policy.logRules.maxHoursPerDay != null && entry.date) {
    sameDayHours = await hoursLoggedOn(req.auth.sub, entry.date, excludeLogId)
  }

  const errors = validateLogAgainstPolicy(policy, { ...entry, sameDayHours })
  return { ok: errors.length === 0, errors, policy }
}

// Write-through sync target for a student's own Log Hours form. Always
// writes to the caller's own account — there is no way to pass a target
// user id here, which is what keeps a parent unable to write regardless of
// role checks (no route accepts one).
router.post('/', limiter, requireDb, requireAuth(), async (req, res) => {
  const { date, activity, category, hours, notes, location, orgName, supervisorName, supervisorEmail, taskId, proofKey, proofStorageId, proofMime, proofBytes, customFields, hasLocalProof } = req.body
  const signoff = signoffFlags(req.body)
  const hoursNum = Number(hours)
  if (!date || !activity || typeof activity !== 'string' || !Number.isFinite(hoursNum) || hoursNum <= 0) {
    return res.status(400).json({ error: 'date, activity, and positive hours are required.' })
  }
  if (!isValidDateString(date)) return res.status(400).json({ error: 'Enter the date as YYYY-MM-DD.' })
  if (hoursNum > MAX_HOURS_PER_ENTRY) {
    return res.status(400).json({ error: `One entry can be at most ${MAX_HOURS_PER_ENTRY} hours.` })
  }
  const textError = logTextError(req.body)
  if (textError) return res.status(400).json({ error: textError })
  // org address/phone, the supervisor's signature image and the supervisor's
  // plaintext email are deliberately not read off the body here: nothing
  // server-side consumes them, so we no longer keep third-party PII for a
  // minor's supervisor. They stay on the student's device. See #186.
  try {
    // Only allow linking to a task the caller is actually an approved
    // volunteer on — this is what the task's host later relies on to review
    // the log, so it must be a real ownership check, not caller-supplied trust.
    if (taskId) {
      const { rows: signupRows } = await query(
        "SELECT 1 FROM public_task_signups WHERE task_id = $1 AND user_id = $2 AND status = 'approved'",
        [taskId, req.auth.sub],
      )
      if (signupRows.length === 0) return res.status(400).json({ error: 'You must be an approved volunteer on this task to link it.' })
    }
    // A proof pointer is caller-supplied, so it is verified rather than
    // trusted: the key must live under this student's own namespace in the
    // named config. Otherwise a student could attach another student's
    // document — whose key they would have to guess, but guessing is not the
    // control we want to be relying on.
    let storageId = null
    let storageKey = null
    if (proofKey || proofStorageId) {
      const { rows: cfgRows } = await query(
        `SELECT id, prefix FROM tenant_storage WHERE id = $1 AND status = 'active'`,
        [proofStorageId],
      )
      const cfg = cfgRows[0]
      if (!cfg || !keyBelongsTo(cfg, proofKey, req.auth.sub)) {
        return res.status(400).json({ error: 'That proof file reference is not valid.' })
      }
      storageId = cfg.id
      storageKey = String(proofKey)
    }

    // A school's "proof required" rule is satisfied by a real object pointer
    // when that school runs tenant storage. Without it, the proof file never
    // leaves the student's device (it lives in localStorage as base64), so the
    // only signal available here is the client's word for it — the form is
    // where that rule actually bites, and this keeps a compliant entry from
    // being rejected for a file we were never meant to hold.
    const policyCheck = await checkPolicy(req, {
      date, activity, category, hours: hoursNum, notes, location, orgName,
      supervisorName, supervisorEmail,
      hasProof: Boolean(storageKey) || hasLocalProof === true,
      // Like hasLocalProof, the client's word: the signature image never
      // leaves the device, and a Google Form's answers go to the school.
      ...signoff,
      // Checked above to be a task this student is approved on.
      taskId: taskId || null,
      customFields,
    })
    if (!policyCheck.ok) {
      return res.status(422).json({
        error: policyCheck.errors[0].message,
        requirementErrors: policyCheck.errors,
      })
    }
    const customFieldValues = sanitizeCustomFieldValues(policyCheck.policy, customFields)

    const id = uid('log')
    await query(
      `INSERT INTO logs (id, user_id, date, activity, category, hours, notes, location, org_name, supervisor_name, supervisor_email_hash, task_id, proof_storage_id, proof_key, proof_mime, proof_bytes, custom_fields, student_signed, form_submitted, supervisor_signed_in_person)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
      [id, req.auth.sub, date, activity, category || null, hoursNum, notes || null, location || null, orgName || null, supervisorName || null, emailHash(supervisorEmail), taskId || null, storageId, storageKey, storageKey ? (proofMime || null) : null, storageKey && Number.isInteger(proofBytes) ? proofBytes : null, customFieldValues ? JSON.stringify(customFieldValues) : null, signoff.hasStudentSignature, signoff.formSubmitted, signoff.supervisorSignedInPerson],
    )
    return res.status(201).json({ id })
  } catch (error) {
    console.error('log create failed:', error)
    return res.status(500).json({ error: 'Could not save log.' })
  }
})

router.patch('/:id', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT user_id, to_char(date, 'YYYY-MM-DD') AS date, activity, category, hours, notes,
              location, org_name, supervisor_name, supervisor_email_hash,
              (proof_key IS NOT NULL) AS has_proof, custom_fields, student_signed, form_submitted,
              supervisor_signed_in_person, task_id
         FROM logs WHERE id = $1`,
      [req.params.id],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Log not found.' })
    if (rows[0].user_id !== req.auth.sub) return res.status(403).json({ error: 'Not allowed.' })
    const existing = rows[0]

    const { date, activity, category, hours, notes, location, orgName, supervisorName, supervisorEmail, taskId, customFields, hasLocalProof } = req.body
    const signoff = signoffFlags(req.body)
    // Match POST's validation — an update must not be able to slip a
    // non-positive or non-numeric value past the check the insert enforces.
    let hoursNum = null
    if (hours != null) {
      hoursNum = Number(hours)
      if (!Number.isFinite(hoursNum) || hoursNum <= 0) {
        return res.status(400).json({ error: 'Hours must be a positive number.' })
      }
      if (hoursNum > MAX_HOURS_PER_ENTRY) {
        return res.status(400).json({ error: `One entry can be at most ${MAX_HOURS_PER_ENTRY} hours.` })
      }
    }
    if (date != null && date !== '' && !isValidDateString(date)) {
      return res.status(400).json({ error: 'Enter the date as YYYY-MM-DD.' })
    }
    const textError = logTextError(req.body)
    if (textError) return res.status(400).json({ error: textError })
    if (taskId) {
      const { rows: signupRows } = await query(
        "SELECT 1 FROM public_task_signups WHERE task_id = $1 AND user_id = $2 AND status = 'approved'",
        [taskId, req.auth.sub],
      )
      if (signupRows.length === 0) return res.status(400).json({ error: 'You must be an approved volunteer on this task to link it.' })
    }
    // The rules apply to what the log will say after the edit, not to the
    // handful of fields this request happens to carry — so the policy is
    // checked against the merged result. Otherwise a compliant entry could be
    // edited into a non-compliant one field at a time.
    const merged = {
      date: date || existing.date,
      activity: activity || existing.activity,
      category: category || existing.category,
      hours: hoursNum ?? Number(existing.hours),
      notes: notes != null ? notes : existing.notes,
      location: location || existing.location,
      orgName: orgName || existing.org_name,
      supervisorName: supervisorName || existing.supervisor_name,
      // Only the hash is kept (#186), so presence is all that can be checked
      // here — enough for a "supervisor required" rule, which asks whether one
      // was named, not who.
      supervisorEmail: supervisorEmail || (existing.supervisor_email_hash ? 'on-file' : ''),
      hasProof: existing.has_proof || hasLocalProof === true,
      hasStudentSignature: existing.student_signed || signoff.hasStudentSignature,
      formSubmitted: existing.form_submitted || signoff.formSubmitted,
      supervisorSignedInPerson: existing.supervisor_signed_in_person || signoff.supervisorSignedInPerson,
      taskId: taskId || existing.task_id,
      customFields: customFields !== undefined ? customFields : existing.custom_fields,
    }
    const policyCheck = await checkPolicy(req, merged, { excludeLogId: req.params.id })
    if (!policyCheck.ok) {
      return res.status(422).json({
        error: policyCheck.errors[0].message,
        requirementErrors: policyCheck.errors,
      })
    }
    const customFieldValues = customFields !== undefined
      ? sanitizeCustomFieldValues(policyCheck.policy, customFields)
      : null

    // A supervisor or school signed off on a specific date/activity/hours —
    // editing any of those facts means the sign-off no longer describes this
    // log, so the verification is dropped and has to be requested again.
    // Clearing verification_token also orphans any still-open supervisor link,
    // so a late click on it can't re-approve the rewritten values. (The
    // signature image the PDF export renders is local-only now — useData drops
    // it on the same edit.)
    const VERIFICATION_STALE = `(
      COALESCE($1, date) IS DISTINCT FROM date
      OR COALESCE($2, activity) IS DISTINCT FROM activity
      OR COALESCE($3, category) IS DISTINCT FROM category
      OR COALESCE($4, hours) IS DISTINCT FROM hours
      OR COALESCE($5, notes) IS DISTINCT FROM notes
    )`
    await query(
      `UPDATE logs SET
         date = COALESCE($1, date),
         activity = COALESCE($2, activity),
         category = COALESCE($3, category),
         hours = COALESCE($4, hours),
         notes = COALESCE($5, notes),
         location = COALESCE($6, location),
         org_name = COALESCE($7, org_name),
         supervisor_name = COALESCE($8, supervisor_name),
         supervisor_email_hash = COALESCE($9, supervisor_email_hash),
         task_id = COALESCE($10, task_id),
         custom_fields = CASE WHEN $12::boolean THEN $13::jsonb ELSE custom_fields END,
         student_signed = student_signed OR $14::boolean,
         form_submitted = form_submitted OR $15::boolean,
         supervisor_signed_in_person = supervisor_signed_in_person OR $16::boolean,
         verification_status = CASE WHEN ${VERIFICATION_STALE} THEN 'none' ELSE verification_status END,
         verification_token  = CASE WHEN ${VERIFICATION_STALE} THEN NULL ELSE verification_token END,
         verified_by         = CASE WHEN ${VERIFICATION_STALE} THEN NULL ELSE verified_by END,
         organizer_signature = CASE WHEN ${VERIFICATION_STALE} THEN NULL ELSE organizer_signature END,
         -- An imported log's signed attestation described the old facts too.
         import_attestation  = CASE WHEN ${VERIFICATION_STALE} THEN NULL ELSE import_attestation END
       WHERE id = $11`,
      [date || null, activity || null, category || null, hoursNum, notes || null, location || null, orgName || null, supervisorName || null, emailHash(supervisorEmail), taskId || null, req.params.id, customFields !== undefined, customFieldValues ? JSON.stringify(customFieldValues) : null, signoff.hasStudentSignature, signoff.formSubmitted, signoff.supervisorSignedInPerson],
    )
    return res.json({ ok: true })
  } catch (error) {
    console.error('log update failed:', error)
    return res.status(500).json({ error: 'Could not update log.' })
  }
})

router.delete('/:id', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query('SELECT user_id FROM logs WHERE id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'Log not found.' })
    if (rows[0].user_id !== req.auth.sub) return res.status(403).json({ error: 'Not allowed.' })

    await query('DELETE FROM logs WHERE id = $1', [req.params.id])
    return res.json({ ok: true })
  } catch (error) {
    console.error('log delete failed:', error)
    return res.status(500).json({ error: 'Could not delete log.' })
  }
})

// A user's logs are readable by the user themself, or a parent linked to them.
// Who may read a user's logs, and from when. The user sees all of their own
// (`since` null). A linked parent sees only entries logged from the moment
// they linked: students are told a link code shares their hours "from that
// point onward" and earlier entries stay private, so every parent read path
// — this route, the organizer-signatures one, proof downloads
// (server/routes/storage.js) and the weekly digest (server/digest.js) —
// applies the same cut-off. Returns null when the caller may not read them.
async function logReadScope(req, userId) {
  if (req.auth.sub === userId) return { since: null }
  if (req.auth.role !== 'parent') return null
  const { rows } = await query(
    'SELECT created_at FROM parent_child_links WHERE parent_id = $1 AND child_id = $2',
    [req.auth.sub, userId],
  )
  return rows[0] ? { since: rows[0].created_at } : null
}

// Read a user's logs — the caller themself, or a parent linked to them.
router.get('/:userId', limiter, requireDb, requireAuth(), async (req, res) => {
  const { userId } = req.params
  try {
    const scope = await logReadScope(req, userId)
    if (!scope) return res.status(403).json({ error: 'Not allowed.' })

    // `date` is a DATE column: pg parses it into a JS Date, which res.json
    // serializes as "2024-01-06T00:00:00.000Z". Clients key calendars and
    // <input type="date"> on the plain "YYYY-MM-DD" string, so format it here.
    const { rows } = await query(
      // proof_key itself is never returned: it is only useful with a minted
      // URL, and every mint is audited. Callers just need to know one exists.
      `SELECT id, to_char(date, 'YYYY-MM-DD') AS date, activity, category, hours, notes, location, org_name, supervisor_name, verification_status, task_id, created_at,
               (proof_key IS NOT NULL) AS has_proof, proof_mime, imported_transcript_id, custom_fields,
               student_signed, form_submitted, supervisor_signed_in_person,
               (organizer_signature IS NOT NULL) AS organizer_signed
       FROM logs WHERE user_id = $1 AND ($2::timestamptz IS NULL OR created_at >= $2)
       ORDER BY logs.date DESC, created_at DESC`,
      [userId, scope.since],
    )
    return res.json({
      logs: rows.map(({ has_proof, proof_mime, imported_transcript_id, custom_fields, student_signed, form_submitted, supervisor_signed_in_person, organizer_signed, ...log }) => ({
        ...log,
        // Only whether one exists: the image is fetched separately, for the
        // entries a device doesn't have yet (GET /:userId/organizer-signatures).
        organizerSigned: organizer_signed,
        supervisorSignedInPerson: supervisor_signed_in_person,
        hasProof: has_proof,
        studentSigned: student_signed,
        formSubmitted: form_submitted,
        proofMime: proof_mime,
        importedTranscriptId: imported_transcript_id,
        customFields: custom_fields || null,
      })),
    })
  } catch (error) {
    console.error('log fetch failed:', error)
    return res.status(500).json({ error: 'Could not fetch logs.' })
  }
})

// Task organizers' signatures for the given entries. Kept out of the list
// above: each is an image of up to 200KB, and a device pulling logs after
// sign-in only needs them for entries it doesn't already hold.
const MAX_SIGNATURE_IDS = 200

router.get('/:userId/organizer-signatures', limiter, requireDb, requireAuth(), async (req, res) => {
  const { userId } = req.params
  const ids = String(req.query.ids || '').split(',').map((id) => id.trim()).filter(Boolean).slice(0, MAX_SIGNATURE_IDS)
  if (ids.length === 0) return res.json({ signatures: {} })
  try {
    const scope = await logReadScope(req, userId)
    if (!scope) return res.status(403).json({ error: 'Not allowed.' })
    const { rows } = await query(
      `SELECT id, organizer_signature FROM logs
        WHERE user_id = $1 AND id = ANY($2::text[]) AND organizer_signature IS NOT NULL
          AND ($3::timestamptz IS NULL OR created_at >= $3)`,
      [userId, ids, scope.since],
    )
    return res.json({ signatures: Object.fromEntries(rows.map((r) => [r.id, r.organizer_signature])) })
  } catch (error) {
    console.error('organizer signature fetch failed:', error)
    return res.status(500).json({ error: 'Could not fetch signatures.' })
  }
})

export default router
