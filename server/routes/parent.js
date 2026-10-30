import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { generateChildLinkCode } from '../ids.js'
import { hasEmail } from '../email.js'
import { escapeHtml } from '../html.js'
import { friendlyWhen } from '../when.js'
import { runWeeklyDigest, previousWeekWindow, weekWindowFromStart } from '../digest.js'
import { checkCronKey } from '../cronAuth.js'
import { policyForUser } from '../policy.js'
import { goalHoursFor } from '../requirements.js'
import { recordAudit, AUDIT } from '../audit.js'
import { WAITLIST_POSITION_SQL, decideParentOk } from './school.js'
import { notify } from '../notifications.js'

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

// Separate, looser bucket for the digest routes so raising their cap doesn't
// also loosen brute-force protection on POST /link (child link-code guessing).
// The unsubscribe GET/POST can see bursts from many parents behind one school
// NAT, plus mail-client link prefetch.
const digestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// POST /api/parent/cheer/:logId (#514): a linked parent says "Proud of you"
// on one of their child's entries, and the child gets a bell notification.
// The same read rule as GET /api/logs/:userId applies — only entries logged
// after the parent linked — so a cheer can't confirm an entry exists that the
// parent isn't allowed to see. Once per parent per entry.
const cheerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many cheers just now. Please try again later.' },
})

router.post('/cheer/:logId', cheerLimiter, requireDb, requireAuth('parent'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT l.id, l.user_id, l.activity, p.name AS parent_name
         FROM logs l
         JOIN parent_child_links k ON k.child_id = l.user_id AND k.parent_id = $2 AND l.created_at >= k.created_at
         JOIN users p ON p.id = $2
        WHERE l.id = $1`,
      [req.params.logId, req.auth.sub],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Entry not found.' })
    const log = rows[0]
    const { rowCount } = await query(
      'INSERT INTO log_cheers (log_id, parent_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [log.id, req.auth.sub],
    )
    if (rowCount > 0) {
      const who = String(log.parent_name || '').trim().split(/\s+/)[0] || 'Your parent'
      await notify(log.user_id, {
        kind: 'parent_cheer',
        title: `${who} is proud of you 🎉`,
        body: `For your hours: ${log.activity}.`,
        link: '/',
      })
    }
    return res.json({ ok: true, cheered: true })
  } catch (error) {
    console.error('cheer failed:', error)
    return res.status(500).json({ error: 'Could not send that.' })
  }
})

// A student views their own link code (or null if never generated).
router.get('/child-link-code', limiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const { rows } = await query('SELECT child_link_code FROM users WHERE id = $1', [req.auth.sub])
    return res.json({ childLinkCode: rows[0]?.child_link_code || null })
  } catch (error) {
    console.error('child-link-code fetch failed:', error)
    return res.status(500).json({ error: 'Could not fetch link code.' })
  }
})

// A student generates or regenerates their link code. Regenerating does not
// unlink parents who already linked with the old code. A code works once:
// POST /link clears it, so a code that leaks can't be used by someone else.
router.post('/child-link-code', limiter, requireDb, requireAuth('student'), async (req, res) => {
  for (let i = 0; i < 5; i++) {
    const code = generateChildLinkCode()
    try {
      await query('UPDATE users SET child_link_code = $1 WHERE id = $2', [code, req.auth.sub])
      return res.json({ childLinkCode: code })
    } catch (error) {
      if (error.code !== '23505') {
        console.error('child-link-code generate failed:', error)
        return res.status(500).json({ error: 'Could not generate a code.' })
      }
      // Unique collision — try again with a new code.
    }
  }
  return res.status(500).json({ error: 'Could not generate a code, try again.' })
})

// A parent links to a child using the child's code.
router.post('/link', limiter, requireDb, requireAuth('parent'), async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
    return res.status(400).json({ error: 'Invalid code format.' })
  }
  try {
    const { rows } = await query(
      `SELECT id, name, email, grade FROM users WHERE child_link_code = $1 AND role = 'student'`,
      [code],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'No student found with that code.' })

    await query(
      'INSERT INTO parent_child_links (parent_id, child_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.auth.sub, rows[0].id],
    )
    await query('UPDATE users SET child_link_code = NULL WHERE id = $1 AND child_link_code = $2', [rows[0].id, code])
    return res.json({ ok: true, child: { id: rows[0].id, name: rows[0].name, email: rows[0].email, grade: rows[0].grade } })
  } catch (error) {
    console.error('parent link failed:', error)
    return res.status(500).json({ error: 'Could not link to student.' })
  }
})

// The parents linked to a student, so the student can see who follows their
// hours and remove anyone they didn't mean to share with.
router.get('/my-parents', limiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.name, u.email, l.created_at AS linked_at
         FROM parent_child_links l JOIN users u ON u.id = l.parent_id
        WHERE l.child_id = $1
        ORDER BY l.created_at`,
      [req.auth.sub],
    )
    return res.json({ parents: rows.map((r) => ({ id: r.id, name: r.name, email: r.email, linkedAt: r.linked_at })) })
  } catch (error) {
    console.error('my-parents fetch failed:', error)
    return res.status(500).json({ error: 'Could not load linked parents.' })
  }
})

router.delete('/my-parents/:parentId', limiter, requireDb, requireAuth('student'), async (req, res) => {
  try {
    const del = await query('DELETE FROM parent_child_links WHERE parent_id = $1 AND child_id = $2', [req.params.parentId, req.auth.sub])
    if (del.rowCount === 0) return res.status(404).json({ error: 'That parent is not linked to you.' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('my-parents remove failed:', error)
    return res.status(500).json({ error: 'Could not remove the parent.' })
  }
})

// A parent's linked children.
router.get('/children', limiter, requireDb, requireAuth('parent'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.name, u.email, u.grade
       FROM parent_child_links pcl
       JOIN users u ON u.id = pcl.child_id
       WHERE pcl.parent_id = $1
       ORDER BY u.name`,
      [req.auth.sub],
    )

    // What each child's school asks of them. A parent's whole question is
    // whether their child is going to make it, which needs the target and the
    // deadline, not just a list of entries. Resolved per child because two
    // children can be at different schools — and per grade, since a school may
    // ask more of a senior than a freshman.
    const children = await Promise.all(rows.map(async (child) => {
      try {
        const resolved = await policyForUser(child.id)
        if (!resolved) return { ...child, requirement: null }
        return {
          ...child,
          requirement: {
            schoolName: resolved.schoolName,
            goalHours: goalHoursFor(resolved.policy, resolved.grade),
            deadline: resolved.policy?.goals?.deadline || null,
            note: resolved.policy?.goals?.note || '',
          },
        }
      } catch {
        // A child whose policy can't be read still shows their hours.
        return { ...child, requirement: null }
      }
    }))

    return res.json({ children })
  } catch (error) {
    console.error('parent children fetch failed:', error)
    return res.status(500).json({ error: 'Could not fetch children.' })
  }
})

// How many already-happened tasks a child's card shows under the upcoming ones.
const RECENT_TASKS = 3

// A linked child's volunteer task sign-ups: what's coming up, plus the last
// few that already happened. Access is the same as reading the child's logs
// (logReadScope in server/routes/logs.js): a parent_child_links row, with past
// tasks cut off at the moment of linking, since a link shares a child's
// activity "from that point onward". Upcoming ones are all shown — they
// haven't happened yet, and where a minor will be is what a parent is asking.
//
// Only what a parent needs to know where and when: no organizer phone or
// email, no important_info, and nothing about the other volunteers. Cancelled
// tasks and rejected sign-ups (by the organizer or by a parent) are left out —
// the child isn't going. One still waiting for a parent's OK is listed.
//
// "Upcoming" starts yesterday in UTC so a task later today in the US is never
// filed as past; the client re-splits on its own local date.
const CHILD_TASK_COLUMNS = `
  s.id AS signup_id, t.id AS task_id, t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location,
  t.creator_name, s.status AS signup_status, s.checked_in_at, s.checked_out_at,
  ${WAITLIST_POSITION_SQL('t.id', 's.user_id')} AS waitlist_position`

router.get('/children/:childId/tasks', limiter, requireDb, requireAuth('parent'), async (req, res) => {
  const { childId } = req.params
  try {
    const { rows: link } = await query(
      'SELECT created_at FROM parent_child_links WHERE parent_id = $1 AND child_id = $2',
      [req.auth.sub, childId],
    )
    if (link.length === 0) {
      recordAudit(req, {
        action: AUDIT.CHILD_TASKS_READ,
        outcome: 'denied',
        // Not subjectUserId: that is a foreign key, and a probed id may not
        // be anyone at all.
        objectType: 'task_signups',
        objectId: String(childId).slice(0, 64),
      })
      return res.status(403).json({ error: 'That student is not linked to you.' })
    }

    const { rows: upcoming } = await query(
      `SELECT ${CHILD_TASK_COLUMNS}
         FROM public_task_signups s JOIN public_tasks t ON t.id = s.task_id
        WHERE s.user_id = $1 AND t.status <> 'cancelled' AND s.status NOT IN ('rejected', 'parent_declined')
          AND t.date >= CURRENT_DATE - 1
        ORDER BY t.date, t.time NULLS LAST, t.title
        LIMIT 50`,
      [childId],
    )
    const { rows: recent } = await query(
      `SELECT ${CHILD_TASK_COLUMNS}
         FROM public_task_signups s JOIN public_tasks t ON t.id = s.task_id
        WHERE s.user_id = $1 AND t.status <> 'cancelled' AND s.status NOT IN ('rejected', 'parent_declined')
          AND t.date < CURRENT_DATE - 1 AND t.date >= $2::date
        ORDER BY t.date DESC, t.time DESC NULLS LAST
        LIMIT $3`,
      [childId, link[0].created_at, RECENT_TASKS],
    )

    const shape = (r) => ({
      signupId: r.signup_id,
      taskId: r.task_id,
      title: r.title,
      date: r.date,
      time: r.time || null,
      location: r.location,
      organizerName: r.creator_name || null,
      status: r.signup_status,
      waitlistPosition: r.waitlist_position == null ? null : Number(r.waitlist_position),
      checkedInAt: r.checked_in_at,
      checkedOutAt: r.checked_out_at,
    })

    recordAudit(req, {
      action: AUDIT.CHILD_TASKS_READ,
      subjectUserId: childId,
      objectType: 'task_signups',
      meta: { upcoming: upcoming.length, recent: recent.length },
    })
    return res.json({ upcoming: upcoming.map(shape), recent: recent.map(shape) })
  } catch (error) {
    console.error('parent child tasks fetch failed:', error)
    return res.status(500).json({ error: 'Could not fetch tasks.' })
  }
})

// --- A parent's OK for an under-13's task sign-up ---------------------------
//
// Sign-ups from a linked child still waiting for a parent ('parent_pending',
// see requestParentOk in school.js). Any linked parent may decide; the first
// decision wins. Upcoming ones only: a task whose day passed can't be joined.
router.get('/task-approvals', limiter, requireDb, requireAuth('parent'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT s.id AS signup_id, s.user_id AS child_id, c.name AS child_name, s.signed_up_at,
              t.id AS task_id, t.title, t.description, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location, t.creator_name,
              CASE WHEN s.waiver_at IS NOT NULL THEN t.waiver_text END AS waiver_text
         FROM public_task_signups s
         JOIN parent_child_links l ON l.child_id = s.user_id AND l.parent_id = $1
         JOIN users c ON c.id = s.user_id
         JOIN public_tasks t ON t.id = s.task_id
        WHERE s.status = 'parent_pending' AND t.status = 'open' AND t.date >= CURRENT_DATE - 1
        ORDER BY t.date, t.time NULLS LAST, s.signed_up_at
        LIMIT 50`,
      [req.auth.sub],
    )
    for (const childId of new Set(rows.map((r) => r.child_id))) {
      recordAudit(req, {
        action: AUDIT.CHILD_TASKS_READ,
        subjectUserId: childId,
        objectType: 'task_signups',
        meta: { awaitingParent: rows.filter((r) => r.child_id === childId).length },
      })
    }
    return res.json({
      approvals: rows.map((r) => ({
        signupId: r.signup_id,
        childId: r.child_id,
        childName: r.child_name,
        taskId: r.task_id,
        title: r.title,
        description: r.description || '',
        date: r.date,
        time: r.time || null,
        location: r.location,
        organizerName: r.creator_name || null,
        signedUpAt: r.signed_up_at,
        waiverText: r.waiver_text || null,
      })),
    })
  } catch (error) {
    console.error('task approvals fetch failed:', error)
    return res.status(500).json({ error: 'Could not load sign-ups waiting for you.' })
  }
})

async function parentDecides(req, res, approve) {
  try {
    const { rows } = await query(
      `SELECT 1 FROM public_task_signups s
         JOIN parent_child_links l ON l.child_id = s.user_id AND l.parent_id = $2
        WHERE s.id = $1`,
      [req.params.signupId, req.auth.sub],
    )
    if (rows.length === 0) return res.status(403).json({ error: 'That sign-up is not from a child linked to you.' })
    const result = await decideParentOk(req.params.signupId, approve)
    if (!result.ok) return res.status(result.code).json({ error: result.error })
    return res.json({ ok: true, status: result.status })
  } catch (error) {
    console.error('parent task decision failed:', error)
    return res.status(500).json({ error: 'Could not save your decision.' })
  }
}

router.post('/task-approvals/:signupId/approve', limiter, requireDb, requireAuth('parent'), (req, res) => parentDecides(req, res, true))
router.post('/task-approvals/:signupId/decline', limiter, requireDb, requireAuth('parent'), (req, res) => parentDecides(req, res, false))

// --- Weekly digest preference (the signed-in half of the unsubscribe link) ---
//
// The digest already has a public two-step unsubscribe for the link in the
// email. A parent who is looking straight at the dashboard should not have to
// go and find that email to turn the thing off, or to turn it back on — which
// the link cannot do at all.
router.get('/digest-preference', limiter, requireDb, requireAuth('parent'), async (req, res) => {
  try {
    const { rows } = await query('SELECT weekly_digest_opt_out FROM users WHERE id = $1', [req.auth.sub])
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' })
    return res.json({ enabled: !rows[0].weekly_digest_opt_out, emailConfigured: hasEmail() })
  } catch (error) {
    console.error('digest preference read failed:', error)
    return res.status(500).json({ error: 'Could not read your email preference.' })
  }
})

router.patch('/digest-preference', limiter, requireDb, requireAuth('parent'), async (req, res) => {
  if (typeof req.body.enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be true or false.' })
  }
  try {
    await query('UPDATE users SET weekly_digest_opt_out = $1 WHERE id = $2', [!req.body.enabled, req.auth.sub])
    return res.json({ enabled: req.body.enabled, emailConfigured: hasEmail() })
  } catch (error) {
    console.error('digest preference update failed:', error)
    return res.status(500).json({ error: 'Could not save your email preference.' })
  }
})

// A parent unlinks a child.
router.delete('/children/:childId', limiter, requireDb, requireAuth('parent'), async (req, res) => {
  try {
    await query(
      'DELETE FROM parent_child_links WHERE parent_id = $1 AND child_id = $2',
      [req.auth.sub, req.params.childId],
    )
    return res.json({ ok: true })
  } catch (error) {
    console.error('parent unlink failed:', error)
    return res.status(500).json({ error: 'Could not unlink student.' })
  }
})

// --- Weekly progress digest ------------------------------------------------

// Whether SMTP is configured travels with every digest response. A dry run
// deliberately skips the hasEmail() gate on the routes below so it stays usable
// on a box with no SMTP — but that also let it answer a bare `ok: true` from a
// backend that could not send a thing, which is how the only green run this
// workflow ever had came from a backend whose every real run was failing 503.
// Reporting the flag keeps the dry run useful without letting it read as a
// green light.
function digestResponse(res, win, out) {
  const emailConfigured = hasEmail()
  if (!emailConfigured) {
    console.warn('weekly digest ran with SMTP unconfigured — no digest can actually be sent')
  }
  return res.json({
    ok: true,
    weekStart: win.weekStart,
    emailConfigured,
    ...(emailConfigured ? {} : { warning: 'Email is not configured, so no digest can be sent.' }),
    ...out,
  })
}

// Cron entrypoint — hit weekly by .github/workflows/parent-weekly-digest.yml.
// Always the just-finished Mon–Sun week, every opted-in parent.
router.post('/internal/run-weekly-digest', digestLimiter, requireDb, async (req, res) => {
  const denied = checkCronKey(req)
  if (denied) return res.status(denied.code).json({ error: denied.error })

  const dryRun = req.body?.dryRun === true
  if (!hasEmail() && !dryRun) return res.status(503).json({ error: 'Email is not configured.' })

  try {
    const win = previousWeekWindow()
    const out = await runWeeklyDigest({ ...win, dryRun })
    return digestResponse(res, win, out)
  } catch (error) {
    console.error('run-weekly-digest failed:', error)
    return res.status(500).json({ error: 'Could not run the weekly digest.' })
  }
})

// Admin manual trigger / testing. { weekStart?, parentId?, force?, dryRun? }.
// `force` overrides the parent_digest_sends idempotency table only — never the
// opt-out filter (applied inside buildParentDigests).
router.post('/admin/send-weekly-digest', digestLimiter, requireDb, requireAuth('admin'), async (req, res) => {
  const { weekStart, parentId, force, dryRun } = req.body || {}
  const isDryRun = dryRun === true
  if (!hasEmail() && !isDryRun) return res.status(503).json({ error: 'Email is not configured.' })
  if (weekStart !== undefined) {
    const s = String(weekStart)
    // Reject well-formed-but-impossible dates ('2025-02-30', '2025-13-01') too —
    // JS rolls them over, so round-trip through Date and compare.
    const d = new Date(`${s}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
      return res.status(400).json({ error: 'weekStart must be a valid YYYY-MM-DD date.' })
    }
  }

  try {
    const win = weekStart ? weekWindowFromStart(String(weekStart)) : previousWeekWindow()
    const out = await runWeeklyDigest({
      ...win,
      parentId: parentId ? String(parentId) : null,
      force: force === true,
      dryRun: isDryRun,
    })
    return digestResponse(res, win, out)
  } catch (error) {
    console.error('send-weekly-digest failed:', error)
    return res.status(500).json({ error: 'Could not send the weekly digest.' })
  }
})

const UNSUB_STYLE = 'font-family:system-ui,-apple-system,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5'

function unsubPage(message) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>VolunTrack</title><body style="${UNSUB_STYLE}"><p>${escapeHtml(message)}</p></body></html>`
}

function unsubConfirmPage(token) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>VolunTrack</title><body style="${UNSUB_STYLE}"><p>Unsubscribe from the VolunTrack weekly progress digest emails?</p><form method="post" action="/api/parent/digest/unsubscribe/${escapeHtml(token)}"><button type="submit" style="font-size:1rem;padding:0.5rem 1rem">Unsubscribe</button></form></body></html>`
}

// Public unsubscribe from the digest email. The 64-hex token is the credential
// (no auth). Two-step on purpose: the GET only renders a confirm button, so
// email-security link scanners and client prefetch can't opt a parent out with
// no user action; the POST does the state change. Renders its own pages — there
// is no frontend route for this.
router.get('/digest/unsubscribe/:token', digestLimiter, requireDb, async (req, res) => {
  const token = String(req.params.token || '')
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).type('html').send(unsubPage('This link is not valid.'))
  }
  try {
    const { rows } = await query(
      `SELECT weekly_digest_opt_out FROM users WHERE digest_unsub_token = $1 AND role = 'parent'`,
      [token],
    )
    if (rows.length === 0) {
      return res.status(404).type('html').send(unsubPage('This unsubscribe link is invalid or expired.'))
    }
    if (rows[0].weekly_digest_opt_out) {
      return res.status(200).type('html').send(unsubPage("You're already unsubscribed from the weekly progress digest emails."))
    }
    return res.status(200).type('html').send(unsubConfirmPage(token))
  } catch (error) {
    console.error('digest unsubscribe (GET) failed:', error)
    return res.status(500).type('html').send(unsubPage('Something went wrong. Please try again later.'))
  }
})

// Idempotent: a repeat POST still matches the row and returns success.
router.post('/digest/unsubscribe/:token', digestLimiter, requireDb, async (req, res) => {
  const token = String(req.params.token || '')
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).type('html').send(unsubPage('This link is not valid.'))
  }
  try {
    const { rowCount } = await query(
      `UPDATE users SET weekly_digest_opt_out = true WHERE digest_unsub_token = $1 AND role = 'parent'`,
      [token],
    )
    if (rowCount === 0) {
      return res.status(404).type('html').send(unsubPage('This unsubscribe link is invalid or expired.'))
    }
    return res.status(200).type('html').send(unsubPage("You've been unsubscribed from the weekly progress digest emails."))
  } catch (error) {
    console.error('digest unsubscribe (POST) failed:', error)
    return res.status(500).type('html').send(unsubPage('Something went wrong. Please try again later.'))
  }
})

// --- A parent's OK by emailed link (no parent account linked) --------------
//
// requestParentOk (school.js) mails the address the child gave for parental
// consent a link here when no parent account is linked. The 64-hex token is
// the credential and works once: the decision clears it. Two-step like the
// unsubscribe above and parentConsent.js: the GET only shows the task and the
// buttons, so a mail scanner or link prefetch can't approve; the POSTs decide.

const TASK_OK_BUTTON = 'font-size:1rem;padding:0.6rem 1.1rem;margin:0 0.5rem 0.5rem 0;cursor:pointer'

function taskOkPage(bodyHtml) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>VolunTrack</title><body style="${UNSUB_STYLE}">${bodyHtml}</body></html>`
}

const TASK_OK_GONE = 'This link has already been used or has expired. If you meant to change your answer, ask your child to sign up again and a new link will be sent.'

async function signupForToken(token) {
  const { rows } = await query(
    `SELECT s.id, c.name AS child_name, t.title, t.description, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location, t.creator_name,
            CASE WHEN s.waiver_at IS NOT NULL THEN t.waiver_text END AS waiver_text
       FROM public_task_signups s
       JOIN users c ON c.id = s.user_id
       JOIN public_tasks t ON t.id = s.task_id
      WHERE s.parent_ok_token = $1 AND s.status = 'parent_pending'`,
    [token],
  )
  return rows[0] || null
}

router.get('/task-ok/:token', digestLimiter, requireDb, async (req, res) => {
  const token = String(req.params.token || '')
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).type('html').send(unsubPage('This link is not valid.'))
  try {
    const s = await signupForToken(token)
    if (!s) return res.status(404).type('html').send(unsubPage(TASK_OK_GONE))
    const when = friendlyWhen(s.date, s.time)
    const action = `/api/parent/task-ok/${escapeHtml(token)}`
    return res.status(200).type('html').send(taskOkPage(
      `<h1 style="font-size:1.3rem">Let ${escapeHtml(s.child_name || 'your child')} join this volunteer task?</h1>
<p><strong>${escapeHtml(s.child_name || 'Your child')}</strong> signed up on VolunTrack and named you as their parent or guardian. Because they are under 13, the organizer won't see the sign-up until you approve it.</p>
<h2 style="font-size:1.1rem">${escapeHtml(s.title)}</h2>
${s.description ? `<p>${escapeHtml(s.description)}</p>` : ''}
${when ? `<p><strong>When:</strong> ${escapeHtml(when)}</p>` : ''}
${s.location ? `<p><strong>Where:</strong> ${escapeHtml(s.location)}</p>` : ''}
${s.creator_name ? `<p><strong>Organizer:</strong> ${escapeHtml(s.creator_name)}</p>` : ''}
${s.waiver_text ? `<h2 style="font-size:1.05rem">The organizer's waiver</h2><div style="white-space:pre-line;border:1px solid #ccc;border-radius:8px;padding:10px 12px;max-height:18rem;overflow:auto">${escapeHtml(s.waiver_text)}</div><p><strong>By pressing Approve, you also agree to this waiver on your child's behalf.</strong></p>` : ''}
<p>If you approve, the organizer sees your child's name and email and confirms the sign-up. If you decline, nothing is shared with the organizer.</p>
<form method="post" action="${action}/approve" style="display:inline"><button type="submit" style="${TASK_OK_BUTTON}">Approve</button></form>
<form method="post" action="${action}/decline" style="display:inline"><button type="submit" style="${TASK_OK_BUTTON}">Decline</button></form>`,
    ))
  } catch (error) {
    console.error('parent task OK (GET) failed:', error)
    return res.status(500).type('html').send(unsubPage('Something went wrong. Please try again later.'))
  }
})

async function decideByToken(req, res, approve) {
  const token = String(req.params.token || '')
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).type('html').send(unsubPage('This link is not valid.'))
  try {
    const s = await signupForToken(token)
    if (!s) return res.status(404).type('html').send(unsubPage(TASK_OK_GONE))
    const result = await decideParentOk(s.id, approve)
    if (!result.ok) return res.status(result.code).type('html').send(unsubPage(result.error))
    const name = s.child_name || 'Your child'
    const text = !approve
      ? `Declined. ${name}'s sign-up for ${s.title} was not sent to the organizer.`
      : result.status === 'waitlisted'
        ? `Thank you. ${s.title} filled up while you were deciding, so ${name} is on its waitlist and moves up if a spot opens.`
        : `Thank you. ${name}'s sign-up for ${s.title} has gone to the organizer, who will confirm it.`
    return res.status(200).type('html').send(unsubPage(text))
  } catch (error) {
    console.error('parent task OK (POST) failed:', error)
    return res.status(500).type('html').send(unsubPage('Something went wrong. Please try again later.'))
  }
}

router.post('/task-ok/:token/approve', digestLimiter, requireDb, (req, res) => decideByToken(req, res, true))
router.post('/task-ok/:token/decline', digestLimiter, requireDb, (req, res) => decideByToken(req, res, false))

export default router
