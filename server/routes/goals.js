import express from 'express'
import rateLimit from 'express-rate-limit'
import { query, hasDatabase, getPool } from '../db.js'
import { requireAuth } from '../auth.js'
import { isValidDateString } from '../validate.js'
// The one category list logs and tasks use, shared with the client.
import { ACTIVITY_CATEGORIES } from '../../src/lib/categories.js'

// A student's personal goals, so a goal set on one device shows on the others.
// The list is small and changes rarely, so it's synced whole: GET returns it,
// PUT replaces it. Goals used to live only in the browser.

const router = express.Router()

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

const MAX_GOALS = 20
const MAX_TARGET_HOURS = 10000

// A goal's optional cause. Absent (an app from before causes) means "leave it
// as stored"; null or '' means none, so the goal counts every hour.
const NO_CHANGE = Symbol('no change')
function readCategory(g) {
  if (!Object.prototype.hasOwnProperty.call(g, 'category')) return { ok: true, value: NO_CHANGE }
  const v = g.category
  if (v == null || v === '') return { ok: true, value: null }
  return ACTIVITY_CATEGORIES.includes(v) ? { ok: true, value: v } : { ok: false }
}

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

function toClient(row) {
  return {
    id: row.id,
    title: row.label || '',
    targetHours: Number(row.target) || 0,
    deadline: row.deadline || null,
    category: row.category || null,
    primary: Boolean(row.is_primary),
    createdAt: row.created_at,
  }
}

router.get('/', limiter, requireDb, requireAuth(), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, label, target, to_char(deadline, 'YYYY-MM-DD') AS deadline, category, is_primary, created_at
         FROM goals WHERE user_id = $1 ORDER BY created_at`,
      [req.auth.sub],
    )
    return res.json({ goals: rows.map(toClient) })
  } catch (error) {
    console.error('goals fetch failed:', error)
    return res.status(500).json({ error: 'Could not load goals.' })
  }
})

router.put('/', limiter, requireDb, requireAuth(), async (req, res) => {
  const incoming = Array.isArray(req.body?.goals) ? req.body.goals : null
  if (!incoming) return res.status(400).json({ error: 'goals must be a list.' })
  if (incoming.length > MAX_GOALS) return res.status(400).json({ error: `At most ${MAX_GOALS} goals.` })

  const rows = []
  for (const g of incoming) {
    const id = typeof g?.id === 'string' ? g.id.slice(0, 64) : ''
    const title = String(g?.title ?? '').trim().slice(0, 100)
    const target = Number(g?.targetHours)
    if (!id || !title || !Number.isFinite(target) || target < 0 || target > MAX_TARGET_HOURS) {
      return res.status(400).json({ error: 'Each goal needs a name and an hour target.' })
    }
    const deadline = g.deadline && isValidDateString(g.deadline) ? g.deadline : null
    const category = readCategory(g)
    if (!category.ok) return res.status(400).json({ error: 'Pick a cause from the list, or none.' })
    const createdAt = g.createdAt && !Number.isNaN(Date.parse(g.createdAt)) ? g.createdAt : new Date().toISOString()
    rows.push({ values: [id, req.auth.sub, title, target, deadline, g.primary === true, createdAt], category: category.value })
  }

  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    // Causes already stored, kept for goals sent by an app that doesn't know about them.
    const { rows: before } = await client.query('SELECT id, category FROM goals WHERE user_id = $1 FOR UPDATE', [req.auth.sub])
    const storedCategory = new Map(before.map((r) => [r.id, r.category]))
    await client.query('DELETE FROM goals WHERE user_id = $1', [req.auth.sub])
    for (const { values, category } of rows) {
      // The id is chosen by the client: one that belongs to someone else is
      // skipped, never overwritten.
      await client.query(
        `INSERT INTO goals (id, user_id, label, target, deadline, is_primary, created_at, category)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [...values, category === NO_CHANGE ? (storedCategory.get(values[0]) ?? null) : category],
      )
    }
    await client.query('COMMIT')
    return res.json({ ok: true, synced: rows.length })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('goals sync failed:', error)
    return res.status(500).json({ error: 'Could not save goals.' })
  } finally {
    client.release()
  }
})

export default router
