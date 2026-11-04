// Opportunities widget (#695): a small page a school or organization puts on
// its own website in an <iframe>, listing its upcoming volunteer events with
// a "Sign up on VolunTrack" link. Server-rendered HTML with no script, and
// the only page this backend lets other sites frame. Shows only what
// Opportunities already shows publicly.
import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { escapeHtml } from '../html.js'

const router = express.Router()
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please try again later.' } })
const MAX_EVENTS = 10

const site = () => ((process.env.FRONTEND_URL || '').split(',').map((x) => x.trim()).find(Boolean) || 'https://volunteer-track-two.vercel.app').replace(/\/$/, '')
const apiBase = (req) => (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')

// Upcoming, open events for an organization: its own, those posted by its
// schools' advisers, and those posted by its partners' contacts.
async function eventsForOrg(orgId) {
  const { rows } = await query(
    `SELECT t.id, t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location, t.is_online, t.slots_total, t.creator_name,
            (SELECT COUNT(*)::int FROM public_task_signups s WHERE s.task_id = t.id AND s.status IN ('pending', 'approved')) AS taken
       FROM public_tasks t JOIN users u ON u.id = t.created_by
      WHERE t.status = 'open' AND t.date >= CURRENT_DATE AND u.posting_suspended_at IS NULL
        AND (t.organization_id = $1
          OR u.school_id IN (SELECT id FROM schools WHERE organization_id = $1) AND u.role IN ('school', 'school_staff')
          OR lower(u.email) IN (SELECT lower(contact_email) FROM org_partners WHERE organization_id = $1 AND contact_email IS NOT NULL))
      ORDER BY t.date, t.time NULLS LAST
      LIMIT ${MAX_EVENTS}`,
    [orgId],
  )
  return rows
}

// For a school: its advisers' events, plus its organization's (if any).
async function eventsForSchool(school) {
  if (school.organization_id) return eventsForOrg(school.organization_id)
  const { rows } = await query(
    `SELECT t.id, t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location, t.is_online, t.slots_total, t.creator_name,
            (SELECT COUNT(*)::int FROM public_task_signups s WHERE s.task_id = t.id AND s.status IN ('pending', 'approved')) AS taken
       FROM public_tasks t JOIN users u ON u.id = t.created_by
      WHERE t.status = 'open' AND t.date >= CURRENT_DATE AND u.posting_suspended_at IS NULL
        AND u.school_id = $1 AND u.role IN ('school', 'school_staff')
      ORDER BY t.date, t.time NULLS LAST
      LIMIT ${MAX_EVENTS}`,
    [school.id],
  )
  return rows
}

function when(date, time) {
  const d = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time || ''))
  if (!m) return d
  const h = Number(m[1])
  return `${d} · ${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

function page(name, events, joinUrl) {
  const items = events.map((t) => {
    const left = t.slots_total ? Math.max(0, Number(t.slots_total) - Number(t.taken)) : null
    return `<li>
      <a class="title" href="${escapeHtml(`${site()}/opportunities?task=${encodeURIComponent(t.id)}`)}" target="_blank" rel="noopener">${escapeHtml(t.title)}</a>
      <div class="meta">${escapeHtml(when(t.date, t.time))} · ${escapeHtml(t.is_online ? 'Online' : (t.location || ''))}</div>
      <div class="meta">${escapeHtml(t.creator_name || '')}${left != null ? ` · ${left === 0 ? 'Full (waitlist open)' : `${left} spot${left === 1 ? '' : 's'} left`}` : ''}</div>
    </li>`
  }).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Volunteer opportunities</title>
<style>
  body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2a24;background:#fff}
  .w{padding:14px 16px}
  h1{font-size:16px;margin:0 0 10px}
  ul{list-style:none;margin:0;padding:0}
  li{padding:10px 0;border-top:1px solid #e6ebe7}
  .title{color:#2f6b34;font-weight:600;text-decoration:none}
  .title:hover{text-decoration:underline}
  .meta{color:#5b6b61;font-size:13px}
  .btn{display:inline-block;margin-top:12px;padding:8px 14px;background:#3f8344;color:#fff;border-radius:8px;text-decoration:none;font-weight:600}
  .empty{color:#5b6b61}
  .by{margin-top:10px;font-size:12px;color:#8a978f}
  .by a{color:#8a978f}
</style></head><body><div class="w">
<h1>Volunteer opportunities${name ? ` · ${escapeHtml(name)}` : ''}</h1>
${events.length ? `<ul>${items}</ul>` : '<p class="empty">No upcoming events right now. Check back soon!</p>'}
<a class="btn" href="${escapeHtml(joinUrl)}" target="_blank" rel="noopener">Sign up on VolunTrack</a>
<div class="by">Powered by <a href="${escapeHtml(site())}" target="_blank" rel="noopener">VolunTrack</a></div>
</div></body></html>`
}

// GET /api/embed/opportunities?school=<code> | ?org=<id> — the widget itself.
router.get('/opportunities', limiter, async (req, res) => {
  // This page, and only this one, may be framed by any site.
  res.removeHeader('X-Frame-Options')
  res.removeHeader('Cross-Origin-Resource-Policy')
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors *")
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.type('html')
  if (!hasDatabase()) return res.status(503).send(page('', [], site()))
  try {
    const schoolCode = String(req.query.school || '').trim().toLowerCase()
    const orgId = String(req.query.org || '').trim()
    if (schoolCode) {
      const { rows } = await query('SELECT id, name, pin, organization_id FROM schools WHERE lower(pin) = $1', [schoolCode])
      if (!rows[0]) return res.status(404).send(page('', [], site()))
      return res.send(page(rows[0].name, await eventsForSchool(rows[0]), `${site()}/join/${encodeURIComponent(rows[0].pin)}`))
    }
    if (orgId) {
      const { rows } = await query('SELECT id, name FROM organizations WHERE id = $1', [orgId])
      if (!rows[0]) return res.status(404).send(page('', [], site()))
      return res.send(page(rows[0].name, await eventsForOrg(rows[0].id), `${site()}/opportunities`))
    }
    return res.status(400).send(page('', [], site()))
  } catch (error) {
    console.error('embed widget failed:', error)
    return res.status(500).send(page('', [], site()))
  }
})

// GET /api/embed/code — the snippet for the caller's school or organization.
router.get('/code', limiter, requireAuth('school', 'school_staff', 'org'), async (req, res) => {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  try {
    const { rows } = await query(
      'SELECT u.organization_id, s.pin FROM users u LEFT JOIN schools s ON s.id = u.school_id WHERE u.id = $1',
      [req.auth.sub],
    )
    const me = rows[0]
    const qs = req.auth.role === 'org' ? (me?.organization_id ? `org=${encodeURIComponent(me.organization_id)}` : '') : (me?.pin ? `school=${encodeURIComponent(me.pin)}` : '')
    if (!qs) return res.status(404).json({ error: 'No school or organization found for this account.' })
    const url = `${apiBase(req)}/api/embed/opportunities?${qs}`
    return res.json({ url, snippet: `<iframe src="${url}" title="Volunteer opportunities" width="100%" height="520" style="border:1px solid #e6ebe7;border-radius:12px" loading="lazy"></iframe>` })
  } catch (error) {
    console.error('embed code failed:', error)
    return res.status(500).json({ error: 'Could not make the widget code.' })
  }
})

export default router
