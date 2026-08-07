import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { uid } from '../ids.js'

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// Public, browsable directory of volunteer organizations. Any signed-in
// user can add one (like the public_tasks board in school.js) — listings
// go live immediately, there's no moderation queue.
router.get('/', limiter, requireDb, async (req, res) => {
  try {
    const category = req.query.category ? String(req.query.category) : null
    const { rows } = await query(
      category
        ? 'SELECT id, name, description, category, website, contact_email, city, created_at FROM organizations WHERE category = $1 ORDER BY name ASC'
        : 'SELECT id, name, description, category, website, contact_email, city, created_at FROM organizations ORDER BY name ASC',
      category ? [category] : [],
    )
    return res.json({ organizations: rows })
  } catch (error) {
    console.error('organizations fetch failed:', error)
    return res.status(500).json({ error: 'Could not fetch organizations.' })
  }
})

router.get('/:id', limiter, requireDb, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, name, description, category, website, contact_email, city, created_at FROM organizations WHERE id = $1',
      [req.params.id],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Organization not found.' })
    return res.json({ organization: rows[0] })
  } catch (error) {
    console.error('organization fetch failed:', error)
    return res.status(500).json({ error: 'Could not fetch organization.' })
  }
})

router.post('/', limiter, requireDb, requireAuth(), async (req, res) => {
  const name = String(req.body.name || '').trim()
  const description = req.body.description ? String(req.body.description).trim() : null
  const category = req.body.category ? String(req.body.category).trim() : null
  const website = req.body.website ? String(req.body.website).trim() : null
  const contactEmail = req.body.contactEmail ? String(req.body.contactEmail).trim() : null
  const city = req.body.city ? String(req.body.city).trim() : null

  if (!name || name.length > 150) return res.status(400).json({ error: 'Organization name is required.' })

  try {
    const id = uid('org')
    await query(
      `INSERT INTO organizations (id, name, description, category, website, contact_email, city, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, name, description, category, website, contactEmail, city, req.auth.sub],
    )
    return res.status(201).json({ id })
  } catch (error) {
    console.error('organization create failed:', error)
    return res.status(500).json({ error: 'Could not save organization.' })
  }
})

export default router
