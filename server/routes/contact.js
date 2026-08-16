import express from 'express'
import rateLimit from 'express-rate-limit'
import validator from 'validator'
import { query, hasDatabase } from '../db.js'
import { uid } from '../ids.js'
import { requireAuth } from '../auth.js'
import { sendEmail } from '../email.js'
import { escapeHtml } from '../html.js'

const router = express.Router()

// Public submission endpoint is spam-prone — keep it tighter than the
// general API limiter.
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// Submit a contact-form message (public). Starts a new thread.
router.post('/', submitLimiter, requireDb, async (req, res) => {
  const name = String(req.body.name || '').trim()
  const email = String(req.body.email || '').trim().toLowerCase()
  const subject = String(req.body.subject || '').trim() || 'General question'
  const message = String(req.body.message || '').trim()

  if (!name || name.length > 100) return res.status(400).json({ error: 'Invalid name.' })
  if (!email || !validator.isEmail(email) || email.length > 254) return res.status(400).json({ error: 'Invalid email.' })
  if (!message || message.length > 5000) return res.status(400).json({ error: 'Invalid message.' })
  if (subject.length > 200) return res.status(400).json({ error: 'Invalid subject.' })

  try {
    const id = uid('cmsg')
    await query(
      `INSERT INTO contact_messages (id, thread_id, direction, name, email, subject, message)
       VALUES ($1, $1, 'inbound', $2, $3, $4, $5)`,
      [id, name, email, subject, message],
    )

    const to = process.env.CONTACT_EMAIL || 'volunteertrack@googlegroups.com'
    const body = `New contact message from ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;<br>Subject: ${escapeHtml(subject)}<br><br>${escapeHtml(message).replace(/\n/g, '<br>')}`
    await sendEmail({ to, subject: `VolunTrack contact: ${subject}`, html: body })

    return res.status(201).json({ ok: true, threadId: id })
  } catch (error) {
    console.error('contact submit failed:', error)
    return res.status(500).json({ error: 'Failed to send message.' })
  }
})

// List threads (admin only) — one row per thread. Shows the original
// submitter's name/message (not whichever message is newest, which after a
// reply would otherwise be the admin's own outbound text), alongside the
// latest activity's direction/timestamp so the UI can flag "awaiting reply".
router.get('/admin/threads', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        first.thread_id, first.name, first.email, first.subject, first.message,
        latest.direction, latest.created_at,
        (SELECT COUNT(*) FROM contact_messages m2 WHERE m2.thread_id = first.thread_id) AS message_count
      FROM (
        SELECT DISTINCT ON (thread_id) thread_id, name, email, subject, message
        FROM contact_messages
        ORDER BY thread_id, created_at ASC
      ) first
      JOIN (
        SELECT DISTINCT ON (thread_id) thread_id, direction, created_at
        FROM contact_messages
        ORDER BY thread_id, created_at DESC
      ) latest USING (thread_id)
    `)
    rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    return res.json({ threads: rows })
  } catch (error) {
    console.error('list contact threads failed:', error)
    return res.status(500).json({ error: 'Could not fetch messages.' })
  }
})

// Full thread history (admin only).
router.get('/admin/threads/:id/messages', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, direction, name, email, subject, message, created_at FROM contact_messages WHERE thread_id = $1 ORDER BY created_at ASC',
      [req.params.id],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Thread not found.' })
    return res.json({ messages: rows })
  } catch (error) {
    console.error('get contact thread failed:', error)
    return res.status(500).json({ error: 'Could not fetch thread.' })
  }
})

// Send a reply email and append it to the thread (admin only).
router.post('/admin/threads/:id/reply', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  const message = String(req.body.message || '').trim()
  if (!message) return res.status(400).json({ error: 'Message is required.' })

  try {
    const { rows } = await query(
      'SELECT email, subject FROM contact_messages WHERE thread_id = $1 ORDER BY created_at ASC LIMIT 1',
      [req.params.id],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Thread not found.' })
    const { email, subject } = rows[0]

    const html = message.split('\n').map((line) => `<p>${escapeHtml(line) || '&nbsp;'}</p>`).join('')
    const result = await sendEmail({ to: email, subject: `Re: ${subject || 'Your message to VolunTrack'}`, html })

    const id = uid('cmsg')
    await query(
      `INSERT INTO contact_messages (id, thread_id, direction, name, email, subject, message)
       VALUES ($1, $2, 'outbound', 'VolunTrack', $3, $4, $5)`,
      [id, req.params.id, email, subject, message],
    )

    return res.json({ ok: true, sent: result.sent })
  } catch (error) {
    console.error('contact reply failed:', error)
    return res.status(500).json({ error: 'Could not send reply.' })
  }
})

// Delete an entire thread (admin only).
router.delete('/admin/threads/:id', limiter, requireDb, requireAuth('admin'), async (req, res) => {
  try {
    await query('DELETE FROM contact_messages WHERE thread_id = $1', [req.params.id])
    return res.json({ ok: true })
  } catch (error) {
    console.error('delete contact thread failed:', error)
    return res.status(500).json({ error: 'Could not delete thread.' })
  }
})

// Inbound email webhook (Resend). Disabled until RESEND_API_KEY and
// RESEND_WEBHOOK_SECRET are configured — see agent-email-inbox skill for
// the full setup (domain/receiving address, webhook registration).
//
// NOT mounted on this router: it needs the raw request body for signature
// verification, so it's registered directly on the app in server.js, ahead
// of the global express.json() parser. See handleInboundWebhook below.
export async function handleInboundWebhook(req, res) {
  if (!hasDatabase()) return res.status(200).send('OK')

  const apiKey = process.env.RESEND_API_KEY
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET
  if (!apiKey || !webhookSecret) {
    console.log('[dev] Inbound contact webhook hit but RESEND_API_KEY/RESEND_WEBHOOK_SECRET not set — ignoring.')
    return res.status(200).send('OK')
  }

  try {
    const { Resend } = await import('resend')
    const resend = new Resend(apiKey)

    const payload = req.body.toString()
    const event = resend.webhooks.verify({
      payload,
      headers: {
        'svix-id': req.headers['svix-id'],
        'svix-timestamp': req.headers['svix-timestamp'],
        'svix-signature': req.headers['svix-signature'],
      },
      secret: webhookSecret,
    })

    if (event.type !== 'email.received') return res.status(200).send('OK')

    const sender = String(event.data.from || '').toLowerCase()
    const { data: email } = await resend.emails.receiving.get(event.data.email_id)

    // Match the reply to the most recent thread this sender is part of —
    // only that sender's own address can append to their own thread.
    const { rows } = await query(
      'SELECT thread_id FROM contact_messages WHERE email = $1 ORDER BY created_at DESC LIMIT 1',
      [sender],
    )
    if (rows.length === 0) {
      console.log(`Rejected inbound reply from unrecognized sender: ${sender}`)
      return res.status(200).send('OK')
    }

    const id = uid('cmsg')
    const name = String(event.data.from_name || sender).slice(0, 100)
    const body = String(email?.text || email?.html || '').slice(0, 5000)
    await query(
      `INSERT INTO contact_messages (id, thread_id, direction, name, email, subject, message)
       VALUES ($1, $2, 'inbound', $3, $4, $5, $6)`,
      [id, rows[0].thread_id, name, sender, event.data.subject || null, body],
    )

    return res.status(200).send('OK')
  } catch (error) {
    console.error('inbound contact webhook failed:', error)
    return res.status(400).send('Error')
  }
}

export default router
