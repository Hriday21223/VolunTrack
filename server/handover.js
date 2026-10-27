// Handing a school's or organization's main account to a new person (#550).
//
// People change jobs: a new principal takes over a school, a new director an
// organization. Rather than the old person changing their own email and
// password (keeping their name, login methods and history), the new person
// gets an invite and their own account becomes the main one.
//
//   school        the old main admin stays on as a co-admin, so nothing they
//                 were in the middle of is lost; the new principal can remove them
//   organization  has only one login, so the old account is detached from it
//
// Either way the old person is signed out everywhere and told by email.

import { createHash, randomBytes } from 'node:crypto'
import validator from 'validator'
import { query, getPool } from './db.js'
import { hashPassword, verifyPassword, endSessions } from './auth.js'
import { uid } from './ids.js'
import { isWeakPassword, WEAK_PASSWORD_MESSAGE } from './validate.js'
import { sendEmail, emailFooterHtml } from './email.js'
import { escapeHtml } from './html.js'
import { recordAudit, AUDIT } from './audit.js'
import { notify } from './notifications.js'

export const HANDOVER_DAYS = 7
const MFA_GRACE_DAYS = Number(process.env.MFA_GRACE_DAYS || 21)

// The @test.com fixtures are never emailed.
const isTestAddress = (email) => /@test\.com$/i.test(String(email || ''))
const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex')

function frontendBase() {
  const first = (process.env.FRONTEND_URL || '').split(',').map((s) => s.trim()).find(Boolean)
  return (first || 'https://volunteer-track-two.vercel.app').replace(/\/$/, '')
}

const button = (href, label) =>
  `<p><a href="${href}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#2e7d32;color:#ffffff;text-decoration:none;font-weight:600">${escapeHtml(label)}</a></p>`

// The invite spells out the login itself — which email, where the password
// comes from, where to sign in — so the new person isn't left guessing.
function handoverInviteHtml({ name, email, place, kind, from, hasAccount, link }) {
  const what = kind === 'school' ? 'school' : 'organization'
  return `<p>Hi ${escapeHtml(name)},</p>
    <p>${escapeHtml(from)} invited you to become the main admin of <strong>${escapeHtml(place)}</strong> on VolunTrack, the ${what}’s volunteer-hours account.</p>
    <p><strong>Your login</strong><br>
      Email: ${escapeHtml(email)}<br>
      Password: ${hasAccount ? 'the one you already use for VolunTrack' : 'you choose it when you accept'}</p>
    <p><strong>How to start</strong></p>
    <ol>
      <li>Press <strong>Accept</strong> below${hasAccount ? '' : ' and choose your password'}.</li>
      <li>Sign in at <a href="${frontendBase()}/login">${escapeHtml(frontendBase().replace(/^https?:\/\//, ''))}/login</a> with ${escapeHtml(email)}.</li>
      <li>Set up two-step sign-in in Settings within 3 weeks. Main admins need it.</li>
    </ol>
    ${button(link, 'Accept')}
    <p style="font-size:13px;color:#666">If the button doesn’t work, copy this link into your browser:<br>${escapeHtml(link)}</p>
    <p style="font-size:13px;color:#666">The link works once and expires in ${HANDOVER_DAYS} days. If you weren’t expecting this, ignore it and nothing changes.</p>${emailFooterHtml()}`
}

// Sent to the new main admin once they accept: where to sign in, with what.
function handoverWelcomeHtml({ name, email, place, kind, hadAccount }) {
  const next = kind === 'school'
    ? 'Your school’s students, hours and settings are all under <strong>School dashboard</strong>. The previous main admin is now a co-admin; you can remove them under School setup → Co-admins.'
    : 'Your schools, invites and requirements are on the <strong>Organization</strong> dashboard.'
  return `<p>Hi ${escapeHtml(name)},</p>
    <p>You’re now the main admin of <strong>${escapeHtml(place)}</strong> on VolunTrack.</p>
    <p><strong>Your login</strong><br>
      Email: ${escapeHtml(email)}<br>
      Password: ${hadAccount ? 'the one you already use for VolunTrack' : 'the one you chose when you accepted'}</p>
    ${button(`${frontendBase()}/login`, 'Sign in')}
    <p>${next}</p>
    <p>Set up two-step sign-in in Settings within 3 weeks. Main admins need it.</p>
    <p style="font-size:13px;color:#666">Forgot the password? Use “Forgot password” on the sign-in page.</p>${emailFooterHtml()}`
}

export class HandoverError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function targetName(kind, id) {
  const table = kind === 'school' ? 'schools' : 'organizations'
  const { rows } = await query(`SELECT name FROM ${table} WHERE id = $1`, [id])
  return rows[0]?.name || null
}

/**
 * Offer a school's or organization's main account to a new person.
 * `targetId` is the school id or organization id, per `kind`.
 */
export async function createHandoverInvite(req, { kind, targetId, name, email }) {
  const cleanName = String(name || '').trim()
  const cleanEmail = String(email || '').trim().toLowerCase()
  if (!cleanName || cleanName.length > 100) throw new HandoverError(400, 'Enter the new person’s name.')
  if (!validator.isEmail(cleanEmail) || cleanEmail.length > 254) throw new HandoverError(400, 'Enter a valid email address.')

  const place = await targetName(kind, targetId)
  if (!place) throw new HandoverError(404, kind === 'school' ? 'School not found.' : 'Organization not found.')

  // An existing account can only take over if it's already a co-admin here;
  // anything else would quietly move someone out of another school or org.
  const { rows: existing } = await query('SELECT id, role, school_id FROM users WHERE email = $1', [cleanEmail])
  if (existing[0]) {
    const u = existing[0]
    const isCoAdminHere = kind === 'school' && u.role === 'school_staff' && u.school_id === targetId
    if (kind === 'school' && u.role === 'school' && u.school_id === targetId) {
      throw new HandoverError(409, 'That person is already the main admin.')
    }
    if (!isCoAdminHere) {
      throw new HandoverError(409, kind === 'school'
        ? 'That email already has a VolunTrack account. Add them as a co-admin first, or use a different email.'
        : 'That email already has a VolunTrack account. Use a different email.')
    }
  }

  const idColumn = kind === 'school' ? 'school_id' : 'organization_id'
  await query(`DELETE FROM account_handover_invites WHERE ${idColumn} = $1 AND accepted_at IS NULL`, [targetId])
  const token = randomBytes(24).toString('base64url')
  await query(
    `INSERT INTO account_handover_invites (token_hash, kind, ${idColumn}, name, email, created_by, created_by_role, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' days')::interval)`,
    [hashToken(token), kind, targetId, cleanName, cleanEmail, req.auth?.sub || null, req.auth?.role || null, String(HANDOVER_DAYS)],
  )

  const link = `${frontendBase()}/handover?token=${token}`
  const { rows: inviter } = await query('SELECT name, role FROM users WHERE id = $1', [req.auth?.sub || null])
  const from = inviter[0]?.role === 'admin'
    ? 'The VolunTrack team'
    : inviter[0]?.name ? `${inviter[0].name}${inviter[0].role === 'org' && kind === 'school' ? ' (your organization)' : ''}` : 'Someone'
  const hasAccount = Boolean(existing[0])
  const { sent: emailSent } = isTestAddress(cleanEmail) ? { sent: false } : await sendEmail({
    to: cleanEmail,
    subject: `You’re invited to take over ${place} on VolunTrack`,
    html: handoverInviteHtml({ name: cleanName, email: cleanEmail, place, kind, from, hasAccount, link }),
  })

  recordAudit(req, {
    action: AUDIT.HANDOVER_INVITED,
    schoolId: kind === 'school' ? targetId : null,
    organizationId: kind === 'organization' ? targetId : null,
    objectType: kind,
    objectId: targetId,
    meta: { emailSent: Boolean(emailSent) },
  })
  return { emailSent: Boolean(emailSent) }
}

/** What the accept page shows. */
export async function handoverInfo(token) {
  const { rows } = await query(
    `SELECT h.kind, h.name, h.email, h.accepted_at IS NOT NULL AS used, h.expires_at < now() AS expired,
            COALESCE(s.name, o.name) AS place,
            EXISTS (SELECT 1 FROM users u WHERE u.email = h.email) AS has_account
       FROM account_handover_invites h
       LEFT JOIN schools s ON s.id = h.school_id
       LEFT JOIN organizations o ON o.id = h.organization_id
      WHERE h.token_hash = $1`,
    [hashToken(token)],
  )
  if (!rows[0]) throw new HandoverError(404, 'This link isn’t valid. Ask for a new invite.')
  const r = rows[0]
  return { kind: r.kind, name: r.name, email: r.email, place: r.place || '', hasAccount: r.has_account, used: r.used, expired: r.expired }
}

/** Accept: the invitee becomes the main account; the old one steps down. */
export async function acceptHandover(req, token, { password } = {}) {
  const client = await getPool().connect()
  let result
  try {
    await client.query('BEGIN')
    const { rows: invites } = await client.query(
      `SELECT * FROM account_handover_invites WHERE token_hash = $1 FOR UPDATE`,
      [hashToken(token)],
    )
    const invite = invites[0]
    if (!invite) throw new HandoverError(404, 'This link isn’t valid. Ask for a new invite.')
    if (invite.accepted_at) throw new HandoverError(410, 'This invite was already accepted. Sign in instead.')
    if (new Date(invite.expires_at) <= new Date()) throw new HandoverError(410, 'This invite has expired. Ask for a new one.')

    const isSchool = invite.kind === 'school'
    const targetId = isSchool ? invite.school_id : invite.organization_id
    const { rows: oldMain } = await client.query(
      isSchool
        ? `SELECT id, name, email FROM users WHERE school_id = $1 AND role = 'school'`
        : `SELECT id, name, email FROM users WHERE organization_id = $1 AND role = 'org'`,
      [targetId],
    )

    const { rows: existing } = await client.query('SELECT id, role, school_id FROM users WHERE email = $1 FOR UPDATE', [invite.email])
    let newUserId
    const hadAccount = Boolean(existing[0])
    if (existing[0]) {
      const u = existing[0]
      if (!(isSchool && u.role === 'school_staff' && u.school_id === targetId)) {
        throw new HandoverError(409, 'This email now belongs to another VolunTrack account. Ask for a new invite with a different email.')
      }
      newUserId = u.id
      await client.query(`UPDATE users SET role = 'school', name = $2 WHERE id = $1`, [newUserId, invite.name])
    } else {
      if (!password || String(password).length < 8) throw new HandoverError(400, 'Choose a password of at least 8 characters.')
      if (isWeakPassword(password)) throw new HandoverError(400, WEAK_PASSWORD_MESSAGE)
      newUserId = uid('usr')
      await client.query(
        `INSERT INTO users (id, role, name, email, password_hash, school_id, organization_id, mfa_required_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' days')::interval)`,
        [newUserId, isSchool ? 'school' : 'org', invite.name, invite.email, await hashPassword(password),
          isSchool ? targetId : null, isSchool ? null : targetId, String(MFA_GRACE_DAYS)],
      )
    }

    const stepping = oldMain.filter((u) => u.id !== newUserId)
    for (const u of stepping) {
      await client.query(
        isSchool
          ? `UPDATE users SET role = 'school_staff' WHERE id = $1`
          : `UPDATE users SET organization_id = NULL WHERE id = $1`,
        [u.id],
      )
    }
    await client.query(`UPDATE ${isSchool ? 'schools' : 'organizations'} SET contact_email = $2 WHERE id = $1`, [targetId, invite.email])

    // A certificate signed in the old principal's name now carries the new
    // one, with no signature until they add their own.
    if (isSchool && stepping.length) {
      const { rows: sch } = await client.query('SELECT requirements FROM schools WHERE id = $1', [targetId])
      const policy = sch[0]?.requirements
      const cert = policy?.certificates
      if (cert && stepping.some((u) => u.name && u.name.trim() === String(cert.signerName || '').trim())) {
        const next = { ...policy, certificates: { ...cert, signerName: invite.name, signatureImage: '' } }
        await client.query('UPDATE schools SET requirements = $2 WHERE id = $1', [targetId, JSON.stringify(next)])
      }
    }

    await client.query('UPDATE account_handover_invites SET accepted_at = now() WHERE token_hash = $1', [hashToken(token)])
    await client.query('COMMIT')
    result = { invite, isSchool, targetId, stepping, newUserId, hadAccount }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }

  const { invite, isSchool, targetId, stepping, newUserId, hadAccount } = result
  const place = (await targetName(invite.kind, targetId)) || ''
  if (!isTestAddress(invite.email)) {
    sendEmail({
      to: invite.email,
      subject: `You’re now the main admin of ${place} on VolunTrack`,
      html: handoverWelcomeHtml({ name: invite.name, email: invite.email, place, kind: invite.kind, hadAccount }),
    }).catch((error) => console.error('handover welcome email failed:', error))
  }
  for (const u of stepping) {
    await endSessions(u.id)
    if (isTestAddress(u.email)) continue
    sendEmail({
      to: u.email,
      subject: `${place} has a new main admin on VolunTrack`,
      html: `<p>Hi ${escapeHtml(u.name || 'there')},</p>
        <p>${escapeHtml(invite.name)} (${escapeHtml(invite.email)}) is now the main admin of <strong>${escapeHtml(place)}</strong> on VolunTrack.</p>
        <p>${isSchool
          ? 'Your account stays on as a co-admin, so you can still sign in and help with the changeover until the new admin removes it.'
          : 'Your account is no longer linked to the organization.'} You’ve been signed out on every device.</p>
        <p>If this wasn’t expected, reply to this email.</p>${emailFooterHtml()}`,
    }).catch((error) => console.error('handover notice email failed:', error))
  }
  // VolunTrack's own admins hear about every change of hands: a bell for each
  // admin account and one email to the admin address (as problem reports do).
  const previous = stepping.map((u) => `${u.name} (${u.email})`).join(', ') || 'nobody'
  const what = isSchool ? 'School' : 'Organization'
  const { rows: admins } = await query(`SELECT id FROM users WHERE role = 'admin'`)
  for (const a of admins) {
    notify(a.id, {
      kind: 'account_handover',
      title: `${place} has a new main admin`,
      body: `${what}: ${invite.name} (${invite.email}) took over from ${previous}.`,
      link: '/admin',
    })
  }
  const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER
  if (adminEmail) {
    sendEmail({
      to: adminEmail,
      subject: `${what} handover: ${place} has a new main admin`,
      html: `<p><strong>${escapeHtml(place)}</strong> (${what.toLowerCase()} <code>${escapeHtml(targetId)}</code>) has a new main admin.</p>
        <p>New: ${escapeHtml(invite.name)} (${escapeHtml(invite.email)})<br>Before: ${escapeHtml(previous)}<br>Started by: ${escapeHtml(invite.created_by_role || 'unknown')}</p>${emailFooterHtml()}`,
    }).catch((error) => console.error('handover admin email failed:', error))
  }

  recordAudit(req, {
    action: AUDIT.HANDOVER_ACCEPTED,
    subjectUserId: newUserId,
    schoolId: isSchool ? targetId : null,
    organizationId: isSchool ? null : targetId,
    objectType: invite.kind,
    objectId: targetId,
    meta: { previous: stepping.map((u) => u.id) },
  })
  return { ok: true, email: invite.email, kind: invite.kind }
}

/**
 * Handing over is the most a school or org admin can give away, so the person
 * starting it confirms their password. SSO accounts have none to confirm;
 * their school's sign-in already vouched for them this session.
 */
export async function confirmPassword(userId, password) {
  const { rows } = await query('SELECT password_hash, auth_provider FROM users WHERE id = $1', [userId])
  const row = rows[0]
  if (!row) throw new HandoverError(404, 'Account not found.')
  if (row.auth_provider === 'sso' || !row.password_hash) return
  if (!password || !(await verifyPassword(String(password), row.password_hash))) {
    throw new HandoverError(403, 'That password isn’t right.')
  }
}

/** Sends a HandoverError's message, or a generic 500. */
export function sendHandoverError(res, error, fallback) {
  if (error instanceof HandoverError) return res.status(error.status).json({ error: error.message })
  console.error(`${fallback}:`, error)
  return res.status(500).json({ error: fallback })
}
