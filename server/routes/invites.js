// Invite a friend (#493). A student or volunteer gets a personal link,
// /invite/<code>; a friend who signs up through it is recorded on their
// account (users.invited_by, set in POST /api/auth/register), and the inviter
// sees how many friends joined — a count, never who. That count drives the
// "Bring a Friend" and "Team Builder" badges (src/lib/achievements.js).
//
// Most users are minors, so: no invite link for under-13 accounts, and the
// public lookup gives out only the inviter's first name.
import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { generateInviteCode } from '../ids.js'

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

export const INVITE_ROLES = ['student', 'volunteer']
const CODE_RE = /^[a-z2-9]{10}$/

export function normalizeInviteCode(raw) {
  const code = String(raw || '').trim().toLowerCase()
  return CODE_RE.test(code) ? code : null
}

// Who owns a code, if they may still invite. Shared with the register route.
export async function inviterForCode(raw) {
  const code = normalizeInviteCode(raw)
  if (!code) return null
  const { rows } = await query(
    `SELECT id, name FROM users
      WHERE invite_code = $1 AND role = ANY($2) AND NOT COALESCE(under_13, false)`,
    [code, INVITE_ROLES],
  )
  return rows[0] || null
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0]?.slice(0, 30) || ''
}

// A friend counts once their account can be used: an under-13 sign-up still
// waiting on a parent doesn't, and is deleted if the parent never answers.
const JOINED_SQL = `SELECT COUNT(*)::int AS n FROM users
                     WHERE invited_by = $1 AND COALESCE(parental_consent_status, '') <> 'pending'`

// GET /api/invites/mine → { code, joined } — makes the code the first time.
router.get('/mine', limiter, requireDb, requireAuth(...INVITE_ROLES), async (req, res) => {
  try {
    const { rows } = await query('SELECT invite_code, under_13 FROM users WHERE id = $1', [req.auth.sub])
    const me = rows[0]
    if (!me) return res.status(404).json({ error: 'Account not found.' })
    if (me.under_13) return res.status(403).json({ error: 'Invites are for students 13 and older.' })

    let code = me.invite_code
    for (let attempt = 0; !code && attempt < 5; attempt++) {
      try {
        const set = await query(
          'UPDATE users SET invite_code = $1 WHERE id = $2 AND invite_code IS NULL RETURNING invite_code',
          [generateInviteCode(), req.auth.sub],
        )
        code = set.rows[0]?.invite_code
        // Another request made it first: read that one.
        if (!code) code = (await query('SELECT invite_code FROM users WHERE id = $1', [req.auth.sub])).rows[0]?.invite_code
      } catch (error) {
        if (error.code !== '23505') throw error // unique clash: try another code
      }
    }
    if (!code) return res.status(500).json({ error: 'Could not make your invite link.' })

    const joined = (await query(JOINED_SQL, [req.auth.sub])).rows[0].n
    return res.json({ code, joined })
  } catch (error) {
    console.error('invite lookup failed:', error)
    return res.status(500).json({ error: 'Could not load your invite link.' })
  }
})

// GET /api/invites/:code → { firstName } for the landing page, or 404.
router.get('/:code', limiter, requireDb, async (req, res) => {
  try {
    const inviter = await inviterForCode(req.params.code)
    if (!inviter) return res.status(404).json({ error: 'Invite not found.' })
    return res.json({ firstName: firstName(inviter.name) })
  } catch (error) {
    console.error('invite landing lookup failed:', error)
    return res.status(500).json({ error: 'Could not look up that invite.' })
  }
})

export default router
