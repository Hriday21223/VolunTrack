import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase } from '../db.js'
import { requireAuth } from '../auth.js'
import { generateChildLinkCode } from '../ids.js'

const router = express.Router()

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
// unlink parents who already linked with the old code.
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
    return res.json({ ok: true, child: { id: rows[0].id, name: rows[0].name, email: rows[0].email, grade: rows[0].grade } })
  } catch (error) {
    console.error('parent link failed:', error)
    return res.status(500).json({ error: 'Could not link to student.' })
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
    return res.json({ children: rows })
  } catch (error) {
    console.error('parent children fetch failed:', error)
    return res.status(500).json({ error: 'Could not fetch children.' })
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

export default router
