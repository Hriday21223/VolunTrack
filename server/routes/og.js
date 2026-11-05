// Link previews (#721): when a shared VolunTrack link is pasted into WhatsApp,
// iMessage, Instagram, Slack and the like, their preview robot fetches it.
// The website is one page for every address, so those robots (and only
// those: see the user-agent rewrites in vercel.json) are sent here, and get a
// tiny page whose Open Graph tags describe that link: the school to join,
// who sent the invite, the event, or a public portfolio. People get the app as
// usual. Only what the matching public page already shows is used.
import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { escapeHtml } from '../html.js'
import { inviterForCode } from './invites.js'
import { sanitizeOptions, displayName } from './portfolio.js'

const router = express.Router()
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, message: 'Too many requests.' })

const site = () => ((process.env.FRONTEND_URL || '').split(',').map((x) => x.trim()).find(Boolean) || 'https://volunteer-track-two.vercel.app').replace(/\/$/, '')
const DEFAULT = {
  title: 'Volunteer Hour Tracker for Students & Schools · VolunTrack',
  description: 'VolunTrack is a calm volunteer hour tracker. Log hours, set goals, earn badges, and generate reports for school or community service.',
}

function page(res, { title, description, path }) {
  const url = `${site()}${path}`
  const image = `${site()}/og-image.png`
  const t = escapeHtml(title)
  const d = escapeHtml(description)
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.set('Cache-Control', 'public, max-age=600')
  res.set('X-Robots-Tag', 'noindex')
  return res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${t}</title>
<meta name="description" content="${d}">
<meta name="robots" content="noindex">
<link rel="canonical" href="${escapeHtml(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="VolunTrack">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="VolunTrack">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${image}">
</head><body><p><a href="${escapeHtml(url)}">${t}</a></p><p>${d}</p></body></html>`)
}

const safe = (fn) => async (req, res) => {
  try {
    if (!hasDatabase()) return page(res, { ...DEFAULT, path: req.path })
    return await fn(req, res)
  } catch (error) {
    console.error('link preview failed:', error.message)
    return page(res, { ...DEFAULT, path: '/' })
  }
}

// School join link: /join/<school code>.
router.get('/join/:code', limiter, safe(async (req, res) => {
  const code = String(req.params.code || '').toLowerCase().slice(0, 64)
  const { rows } = await query('SELECT name FROM schools WHERE lower(pin) = $1', [code])
  if (!rows[0]) return page(res, { ...DEFAULT, path: `/join/${encodeURIComponent(code)}` })
  return page(res, {
    title: `Join ${rows[0].name} on VolunTrack`,
    description: `Track your volunteer hours with ${rows[0].name}. Sign up free and join with the school code ${code}.`,
    path: `/join/${encodeURIComponent(code)}`,
  })
}))

// Friend invite: /invite/<code>. First name only, like the invite page.
router.get('/invite/:code', limiter, safe(async (req, res) => {
  const inviter = await inviterForCode(req.params.code)
  const path = `/invite/${encodeURIComponent(String(req.params.code || '').slice(0, 32))}`
  if (!inviter) return page(res, { ...DEFAULT, path })
  const first = String(inviter.name || '').trim().split(/\s+/)[0] || 'A friend'
  return page(res, {
    title: `${first} invited you to VolunTrack`,
    description: 'Track your volunteer hours, find events near you and earn badges. Free for students and volunteers.',
    path,
  })
}))

// Public portfolio: /p/<slug>. The same rules as GET /api/portfolio/:slug:
// only when it's switched on, never for under-13s or pending consent.
router.get('/p/:slug', limiter, safe(async (req, res) => {
  const slug = String(req.params.slug || '')
  const path = `/p/${encodeURIComponent(slug.slice(0, 32))}`
  if (!/^[A-Za-z0-9]{12}$/.test(slug)) return page(res, { ...DEFAULT, path })
  const { rows } = await query(
    `SELECT u.name, p.options,
            (SELECT COALESCE(SUM(l.hours), 0)::float8 FROM logs l WHERE l.user_id = u.id AND l.verification_status = 'approved') AS hours
       FROM portfolios p JOIN users u ON u.id = p.user_id
      WHERE p.slug = $1 AND p.enabled = true AND u.role = 'student'
        AND u.under_13 IS NOT TRUE AND u.parental_consent_status IS DISTINCT FROM 'pending'`,
    [slug],
  )
  if (!rows[0]) return page(res, { ...DEFAULT, path })
  const name = displayName(rows[0].name, sanitizeOptions(rows[0].options).nameDisplay)
  const hours = Math.round(Number(rows[0].hours) * 10) / 10
  return page(res, {
    title: `${name}'s volunteer portfolio · VolunTrack`,
    description: `${hours} verified volunteer hours, with the causes and places ${name} served.`,
    path,
  })
}))

// An event: /opportunities?task=<id>. Public on Opportunities already.
router.get('/event/:id', limiter, safe(async (req, res) => {
  const id = String(req.params.id || '').slice(0, 64)
  const path = `/opportunities?task=${encodeURIComponent(id)}`
  const { rows } = await query(
    `SELECT t.title, to_char(t.date, 'YYYY-MM-DD') AS date, t.time, t.location, t.is_online, t.creator_name
       FROM public_tasks t JOIN users u ON u.id = t.created_by
      WHERE t.id = $1 AND t.status <> 'cancelled' AND u.posting_suspended_at IS NULL`,
    [id],
  )
  const t = rows[0]
  if (!t) return page(res, { ...DEFAULT, path: '/opportunities' })
  const day = new Date(`${t.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t.time || ''))
  const when = m ? `${day}, ${((Number(m[1]) + 11) % 12) + 1}:${m[2]} ${Number(m[1]) < 12 ? 'AM' : 'PM'}` : day
  return page(res, {
    title: `${t.title} · ${when}`,
    description: `${t.is_online ? 'Online' : t.location || ''}${t.creator_name ? ` · Posted by ${t.creator_name}` : ''}. Sign up to volunteer on VolunTrack.`,
    path,
  })
}))

export default router
