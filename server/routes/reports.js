import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { uid } from '../ids.js'
import { requireAuth } from '../auth.js'
import { sendEmail, emailFooterHtml } from '../email.js'
import { escapeHtml } from '../html.js'

// Report and block (App Store guideline 1.2). Volunteer tasks are posted by
// Volunteer Task Makers and seen by students, many of them minors, so:
//   - anyone signed in can report a task, and block its organizer;
//   - blocking hides that organizer's tasks from them and stops the
//     organizer's task messages reaching them (server/routes/school.js);
//   - the admin is emailed and decides: dismiss, remove the task, or suspend
//     the organizer from posting (which also hides their open tasks).

const router = express.Router()

const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reports. Please try again later.' },
})
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

export const REPORT_REASONS = {
  unsafe: 'Unsafe or inappropriate',
  spam: 'Spam or a scam',
  misleading: 'Misleading or not a real event',
  other: 'Something else',
}

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

function adminRecipient() {
  return process.env.ADMIN_EMAIL || process.env.EMAIL_USER || null
}

async function block(blockerId, blockedId) {
  if (!blockedId || blockerId === blockedId) return
  await query(
    'INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [blockerId, blockedId],
  )
}

// POST /api/reports { taskId, reason, details?, block? }
router.post('/', reportLimiter, requireDb, requireAuth(), async (req, res) => {
  const taskId = String(req.body?.taskId || '')
  const reason = String(req.body?.reason || '')
  const details = String(req.body?.details || '').trim().slice(0, 1000)
  if (!REPORT_REASONS[reason]) return res.status(400).json({ error: 'Choose a reason.' })
  try {
    const { rows } = await query(
      'SELECT id, title, location, created_by, creator_name FROM public_tasks WHERE id = $1',
      [taskId],
    )
    const task = rows[0]
    if (!task) return res.status(404).json({ error: 'Task not found.' })
    if (task.created_by === req.auth.sub) return res.status(400).json({ error: "You can't report your own task." })

    // One open report per person per task: a second one updates the first.
    const { rows: inserted } = await query(
      `INSERT INTO content_reports (id, reporter_id, task_id, reported_user_id, reason, details)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (reporter_id, task_id) WHERE status = 'pending'
       DO UPDATE SET reason = EXCLUDED.reason, details = EXCLUDED.details
       RETURNING (xmax = 0) AS created`,
      [uid('rpt'), req.auth.sub, task.id, task.created_by, reason, details || null],
    )
    if (req.body?.block === true) await block(req.auth.sub, task.created_by)

    const to = adminRecipient()
    if (inserted[0]?.created && to) {
      const link = `${String(process.env.FRONTEND_URL || '').replace(/\/$/, '')}/admin/reports`
      sendEmail({
        to,
        subject: `Report: ${task.title}`,
        html: `<p>A volunteer task was reported.</p>
<p><strong>Task:</strong> ${escapeHtml(task.title)}<br><strong>Where:</strong> ${escapeHtml(task.location || '')}<br><strong>Posted by:</strong> ${escapeHtml(task.creator_name || '')}</p>
<p><strong>Reason:</strong> ${escapeHtml(REPORT_REASONS[reason])}${details ? `<br><strong>Details:</strong> ${escapeHtml(details)}` : ''}</p>
<p>Review it in <a href="${link}">Admin → Reports</a>. Apple expects reports to be acted on within 24 hours.</p>${emailFooterHtml()}`,
      }).catch((e) => console.error('report email failed:', e.message))
    }
    return res.status(201).json({ ok: true, blocked: req.body?.block === true })
  } catch (error) {
    console.error('report failed:', error)
    return res.status(500).json({ error: 'Could not send the report.' })
  }
})

// The organizers this person has blocked.
router.get('/blocks', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.name, b.created_at FROM user_blocks b JOIN users u ON u.id = b.blocked_id
        WHERE b.blocker_id = $1 ORDER BY b.created_at DESC`,
      [req.auth.sub],
    )
    return res.json({ blocks: rows.map((r) => ({ id: r.id, name: r.name, blockedAt: r.created_at })) })
  } catch (error) {
    console.error('blocks fetch failed:', error)
    return res.status(500).json({ error: 'Could not load blocked organizers.' })
  }
})

router.post('/blocks', limiter, requireDb, requireAuth(), async (req, res) => {
  const blockedId = String(req.body?.userId || '')
  if (!blockedId || blockedId === req.auth.sub) return res.status(400).json({ error: 'Choose someone to block.' })
  try {
    const { rows } = await query('SELECT 1 FROM users WHERE id = $1', [blockedId])
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' })
    await block(req.auth.sub, blockedId)
    return res.json({ ok: true })
  } catch (error) {
    console.error('block failed:', error)
    return res.status(500).json({ error: 'Could not block.' })
  }
})

router.delete('/blocks/:userId', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    await query('DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2', [req.auth.sub, req.params.userId])
    return res.json({ ok: true })
  } catch (error) {
    console.error('unblock failed:', error)
    return res.status(500).json({ error: 'Could not unblock.' })
  }
})

// --- Admin ---------------------------------------------------------------

router.get('/admin', limiter, requireDb, requireAuth('admin'), async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT r.id, r.reason, r.details, r.status, r.created_at, r.resolved_at,
              t.id AS task_id, t.title AS task_title, t.location AS task_location,
              to_char(t.date, 'YYYY-MM-DD') AS task_date, t.status AS task_status,
              p.id AS poster_id, p.name AS poster_name, p.email AS poster_email, p.posting_suspended_at,
              rep.name AS reporter_name, rep.role AS reporter_role,
              (SELECT count(*)::int FROM content_reports x WHERE x.task_id = r.task_id) AS reports_on_task
         FROM content_reports r
         LEFT JOIN public_tasks t ON t.id = r.task_id
         LEFT JOIN users p ON p.id = r.reported_user_id
         LEFT JOIN users rep ON rep.id = r.reporter_id
        ORDER BY (r.status = 'pending') DESC, r.created_at DESC
        LIMIT 200`,
    )
    return res.json({ reports: rows })
  } catch (error) {
    console.error('admin reports fetch failed:', error)
    return res.status(500).json({ error: 'Could not load reports.' })
  }
})

// { action: 'dismiss' | 'remove_task' | 'suspend' }
router.post('/admin/:id/resolve', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const action = req.body?.action
  if (!['dismiss', 'remove_task', 'suspend'].includes(action)) return res.status(400).json({ error: 'Unknown action.' })
  try {
    const { rows } = await query('SELECT task_id, reported_user_id FROM content_reports WHERE id = $1', [req.params.id])
    const report = rows[0]
    if (!report) return res.status(404).json({ error: 'Report not found.' })
    if (action === 'dismiss') {
      await query("UPDATE content_reports SET status = 'dismissed', resolved_by = $2, resolved_at = now() WHERE id = $1", [req.params.id, req.auth.sub])
    } else if (action === 'remove_task') {
      await query(
        `UPDATE public_tasks SET status = 'cancelled', cancelled_reason = 'Removed by VolunTrack after a report.', cancelled_at = now(), updated_at = now()
          WHERE id = $1 AND status <> 'cancelled'`,
        [report.task_id],
      )
      // Every open report about this task is settled by removing it.
      await query(
        "UPDATE content_reports SET status = 'task_removed', resolved_by = $2, resolved_at = now() WHERE task_id = $1 AND status = 'pending'",
        [report.task_id, req.auth.sub],
      )
    } else {
      await query('UPDATE users SET posting_suspended_at = now() WHERE id = $1 AND posting_suspended_at IS NULL', [report.reported_user_id])
      await query(
        "UPDATE content_reports SET status = 'poster_suspended', resolved_by = $2, resolved_at = now() WHERE reported_user_id = $1 AND status = 'pending'",
        [report.reported_user_id, req.auth.sub],
      )
    }
    return res.json({ ok: true })
  } catch (error) {
    console.error('report resolve failed:', error)
    return res.status(500).json({ error: 'Could not update the report.' })
  }
})

// Lets a suspended organizer post again.
router.post('/admin/users/:id/unsuspend', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    await query('UPDATE users SET posting_suspended_at = NULL WHERE id = $1', [req.params.id])
    return res.json({ ok: true })
  } catch (error) {
    console.error('unsuspend failed:', error)
    return res.status(500).json({ error: 'Could not lift the suspension.' })
  }
})

export default router
