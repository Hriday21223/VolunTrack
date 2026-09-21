import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { uid } from '../ids.js'
import { requireAuth } from '../auth.js'
import { sendEmail, emailFooterHtml } from '../email.js'
import { escapeHtml } from '../html.js'
import { getPromoOffer } from './settings.js'
import { isPromoLive, promoLabel } from '../promo.js'

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

// The blast is the expensive one — it fans out to every customer on the
// platform, so it gets its own much tighter budget than the read routes.
const blastLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many invite sends. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

const ENTITY_TABLES = { school: 'schools', organization: 'organizations' }

// Which school/organization the calling account belongs to.
async function callerEntity(auth) {
  const entityType = auth.role === 'org' ? 'organization' : 'school'
  const column = entityType === 'organization' ? 'organization_id' : 'school_id'
  const { rows } = await query(`SELECT ${column} AS entity_id FROM users WHERE id = $1`, [auth.sub])
  const entityId = rows[0]?.entity_id || null
  return entityId ? { entityType, entityId } : null
}

// Resolve a shared referral code to whoever owns it. Codes are unique across
// each table; a code is checked against both because a school and an org may
// each refer someone.
async function lookupReferralCode(code) {
  for (const [entityType, table] of Object.entries(ENTITY_TABLES)) {
    const { rows } = await query(`SELECT id, name FROM ${table} WHERE referral_code = $1`, [code])
    if (rows.length > 0) return { entityType, entityId: rows[0].id, name: rows[0].name }
  }
  return null
}

/**
 * Record that `referred` was sent by whoever owns `code`. Called from the
 * school signup route and from the admin panel, so it lives here rather than
 * being duplicated. Returns a reason instead of throwing when the referral
 * can't stand up — a bad code must never fail somebody's registration.
 */
export async function recordReferral({ code, referredType, referredId }) {
  const offer = await getPromoOffer()
  if (!offer.referral || !isPromoLive(offer)) return { ok: false, reason: 'No referral offer is running.' }

  const normalized = String(code || '').trim().toUpperCase()
  const referrer = await lookupReferralCode(normalized)
  if (!referrer) return { ok: false, reason: 'That referral code does not belong to any customer.' }
  if (referrer.entityType === referredType && referrer.entityId === referredId) {
    return { ok: false, reason: 'A customer cannot refer themselves.' }
  }

  try {
    const { rows } = await query(
      `INSERT INTO referrals (id, code, referrer_type, referrer_id, referred_type, referred_id, percent_off)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (referred_type, referred_id) DO NOTHING
       RETURNING id`,
      [uid('ref'), normalized, referrer.entityType, referrer.entityId, referredType, referredId, offer.percentOff],
    )
    if (rows.length === 0) return { ok: false, reason: 'This customer was already referred by someone else.' }
    return { ok: true, id: rows[0].id, referrerName: referrer.name }
  } catch (error) {
    console.error('record referral failed:', error)
    return { ok: false, reason: 'Could not record the referral.' }
  }
}

/**
 * Promote every pending referral of `referredId` to 'earned'. Called when that
 * customer is invoiced for the first time: until somebody is actually being
 * billed, a referral is a signup, not a reward.
 */
export async function markReferralEarned(referredType, referredId) {
  try {
    await query(
      `UPDATE referrals SET status = 'earned', earned_at = now()
       WHERE referred_type = $1 AND referred_id = $2 AND status = 'pending'`,
      [referredType, referredId],
    )
  } catch (error) {
    console.error('mark referral earned failed:', error)
  }
}

/** Credits this customer has earned and not yet spent, oldest first. */
export async function earnedCredits(entityType, entityId) {
  const { rows } = await query(
    `SELECT r.id, r.percent_off, r.earned_at, r.referred_type, r.referred_id,
            COALESCE(s.name, o.name) AS referred_name
     FROM referrals r
     LEFT JOIN schools s ON r.referred_type = 'school' AND s.id = r.referred_id
     LEFT JOIN organizations o ON r.referred_type = 'organization' AND o.id = r.referred_id
     WHERE r.referrer_type = $1 AND r.referrer_id = $2 AND r.status = 'earned'
     ORDER BY r.earned_at ASC`,
    [entityType, entityId],
  )
  return rows
}

// --- A customer's own referral card ---

router.get('/mine', limiter, requireDb, requireAuth('school', 'school_staff', 'org'), async (req, res) => {
  try {
    const entity = await callerEntity(req.auth)
    if (!entity) return res.json({ code: null, offer: null, referrals: [], credits: [] })

    const table = ENTITY_TABLES[entity.entityType]
    const { rows: codeRows } = await query(`SELECT referral_code FROM ${table} WHERE id = $1`, [entity.entityId])
    const offer = await getPromoOffer()

    const { rows: referrals } = await query(
      `SELECT r.id, r.status, r.created_at, COALESCE(s.name, o.name) AS referred_name
       FROM referrals r
       LEFT JOIN schools s ON r.referred_type = 'school' AND s.id = r.referred_id
       LEFT JOIN organizations o ON r.referred_type = 'organization' AND o.id = r.referred_id
       WHERE r.referrer_type = $1 AND r.referrer_id = $2 AND r.status <> 'void'
       ORDER BY r.created_at DESC LIMIT 50`,
      [entity.entityType, entity.entityId],
    )

    return res.json({
      code: codeRows[0]?.referral_code || null,
      // Terms are only advertised while a referral offer is actually running;
      // the code itself is shown regardless, since it never changes.
      offer: offer.referral && isPromoLive(offer)
        ? { headline: offer.headline, percentOff: offer.percentOff, label: promoLabel(offer), endsAt: offer.endsAt }
        : null,
      referrals,
      credits: await earnedCredits(entity.entityType, entity.entityId),
    })
  } catch (error) {
    console.error('referral mine failed:', error)
    return res.status(500).json({ error: 'Could not fetch your referral details.' })
  }
})

// --- Admin ---

// Every referral on the platform, newest first.
router.get('/admin/list', limiter, requireDb, requireAuth('admin'), async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT r.id, r.code, r.status, r.percent_off, r.created_at, r.earned_at,
              COALESCE(rs.name, ro.name) AS referrer_name,
              COALESCE(ds.name, do_.name) AS referred_name
       FROM referrals r
       LEFT JOIN schools rs ON r.referrer_type = 'school' AND rs.id = r.referrer_id
       LEFT JOIN organizations ro ON r.referrer_type = 'organization' AND ro.id = r.referrer_id
       LEFT JOIN schools ds ON r.referred_type = 'school' AND ds.id = r.referred_id
       LEFT JOIN organizations do_ ON r.referred_type = 'organization' AND do_.id = r.referred_id
       ORDER BY r.created_at DESC LIMIT 200`,
    )
    return res.json({ referrals: rows })
  } catch (error) {
    console.error('referral list failed:', error)
    return res.status(500).json({ error: 'Could not fetch referrals.' })
  }
})

// Attach a referral to a customer by hand, for one that arrived by phone or
// was missed at signup.
router.post('/admin/link', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const referredType = String(req.body.referredType || '')
  const referredId = String(req.body.referredId || '')
  const code = String(req.body.code || '')
  if (!ENTITY_TABLES[referredType] || !referredId) return res.status(400).json({ error: 'Invalid customer.' })
  if (!code) return res.status(400).json({ error: 'A referral code is required.' })

  const result = await recordReferral({ code, referredType, referredId })
  if (!result.ok) return res.status(400).json({ error: result.reason })
  return res.status(201).json({ ok: true, referrerName: result.referrerName })
})

// Void a referral linked in error. Not a hard delete: the row stays as a
// record that it happened, and the status check means a credit already spent on
// an invoice can't be clawed back out from under that invoice.
router.delete('/admin/:id', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE referrals SET status = 'void' WHERE id = $1 AND status IN ('pending','earned') RETURNING id`,
      [req.params.id],
    )
    if (rows.length === 0) {
      return res.status(409).json({ error: 'That referral is already redeemed or voided.' })
    }
    return res.json({ ok: true })
  } catch (error) {
    console.error('void referral failed:', error)
    return res.status(500).json({ error: 'Could not void the referral.' })
  }
})

function inviteEmailHtml({ name, code, offer, registerUrl }) {
  return [
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>${escapeHtml(offer.headline)} — invite another school or organization to VolunTrack and you <strong>both</strong> get ${offer.percentOff}% off.</p>`,
    offer.details ? `<p>${escapeHtml(offer.details).replace(/\n/g, '<br>')}</p>` : '',
    `<p>Your referral code:</p>`,
    `<p style="font-family:monospace;font-size:20px;font-weight:bold;letter-spacing:2px">${escapeHtml(code)}</p>`,
    `<p>Pass it on. When they enter it while registering at <a href="${registerUrl}">${registerUrl}</a>, they get ${offer.percentOff}% off their first invoice — and ${offer.percentOff}% comes off your next one.</p>`,
    offer.endsAt ? `<p>This offer ends ${escapeHtml(offer.endsAt)}.</p>` : '',
    emailFooterHtml(),
  ].join('')
}

/**
 * Mail every customer their own referral code — one message each, never a
 * shared thread: these are separate organizations and putting them on one
 * email would disclose the customer list to all of them.
 *
 * `dryRun` returns exactly who would be written to without sending anything,
 * which is what the admin UI shows before asking for confirmation.
 */
router.post('/admin/send-invites', blastLimiter, requireDb, requireAuth('admin'), async (req, res) => {
  const dryRun = req.body.dryRun === true
  const force = req.body.force === true
  // Optional narrowing to specific customers ("entityType:entityId"), so the
  // admin can send one test message to themselves before mailing everybody.
  const only = Array.isArray(req.body.only) ? req.body.only.map(String) : null

  try {
    const offer = await getPromoOffer()
    if (!offer.referral || !isPromoLive(offer)) {
      return res.status(409).json({ error: 'Turn on a running referral offer before sending invites.' })
    }

    const recipients = []
    for (const [entityType, table] of Object.entries(ENTITY_TABLES)) {
      const { rows } = await query(
        `SELECT e.id, e.name, e.contact_email, e.referral_code, s.sent_at
         FROM ${table} e
         LEFT JOIN referral_invite_sends s ON s.entity_type = $1 AND s.entity_id = e.id
         WHERE e.contact_email IS NOT NULL AND e.referral_code IS NOT NULL
         ORDER BY e.name ASC`,
        [entityType],
      )
      for (const row of rows) {
        if (only && !only.includes(`${entityType}:${row.id}`)) continue
        // Already-contacted customers are skipped unless the admin explicitly
        // asks to send again, so a second click doesn't mail everyone twice.
        const skipped = !force && row.sent_at ? 'Already sent' : null
        recipients.push({
          entityType,
          entityId: row.id,
          name: row.name,
          email: row.contact_email,
          code: row.referral_code,
          lastSentAt: row.sent_at,
          skipped,
        })
      }
    }

    const willSend = recipients.filter((r) => !r.skipped)
    if (dryRun) return res.json({ dryRun: true, recipients, wouldSend: willSend.length })

    const registerUrl = `${process.env.FRONTEND_URL || ''}/school/register`
    let sent = 0
    const failed = []
    for (const recipient of willSend) {
      try {
        const result = await sendEmail({
          to: recipient.email,
          subject: `${offer.headline} — your VolunTrack referral code`,
          html: inviteEmailHtml({ name: recipient.name, code: recipient.code, offer, registerUrl }),
        })
        if (!result.sent) { failed.push({ name: recipient.name, reason: 'Email was not sent.' }); continue }
        sent += 1
        await query(
          `INSERT INTO referral_invite_sends (entity_type, entity_id) VALUES ($1, $2)
           ON CONFLICT (entity_type, entity_id) DO UPDATE SET sent_at = now()`,
          [recipient.entityType, recipient.entityId],
        )
      } catch (error) {
        console.error('referral invite send failed:', recipient.email, error)
        failed.push({ name: recipient.name, reason: 'Email failed to send.' })
      }
    }

    return res.json({ sent, skipped: recipients.length - willSend.length, failed })
  } catch (error) {
    console.error('send referral invites failed:', error)
    return res.status(500).json({ error: 'Could not send the invites.' })
  }
})

export default router
