import express from 'express'
import rateLimit from 'express-rate-limit'
import { randomBytes } from 'crypto'
import { query, hasDatabase, getPool } from '../db.js'
import { requireAuth } from '../auth.js'
import { hasImageMagic, stripImageMetadata } from '../imageCheck.js'

// Task cover photos: one picture an organizer adds to a public task, shown at
// the top of its card on Opportunities.
//
// Storage: the bytes live in Postgres (public_task_photos), the same place the
// branding logo lives. Tenant buckets (routes/storage.js) are deliberately not
// used — they belong to a school, hold private proof documents behind
// short-lived presigned URLs, and most organizers have no school at all.
//
// The browser shrinks and re-encodes the picture before upload
// (src/lib/taskPhoto.js), which strips EXIF/GPS. The server can't rely on
// that, so it checks the magic bytes and drops metadata segments itself
// (server/imageCheck.js) — sharp is not a runtime dependency here.

const router = express.Router()

export const MAX_TASK_PHOTO_BYTES = 3 * 1024 * 1024
const TYPES = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' }

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // A weekly series of 13 uploads its photo to each copy.
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many photo uploads. Please try again later.' },
})
const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
})

function requireDb(_req, res, next) {
  if (!hasDatabase()) return res.status(503).json({ error: 'Server database is not configured.' })
  next()
}

// express.raw, but answering its errors (too big, bad encoding) as JSON.
const rawImage = express.raw({ type: Object.keys(TYPES), limit: MAX_TASK_PHOTO_BYTES })
function readImageBody(req, res, next) {
  rawImage(req, res, (err) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'That photo is too large. Use one under 3 MB.' })
    if (err) return res.status(400).json({ error: 'Could not read that photo.' })
    next()
  })
}

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/

// PUT /api/task-photos/:taskId — body is the image itself, Content-Type
// image/jpeg|png|webp. Adds or replaces the task's cover photo. Only the
// organizer who posted the task.
router.put('/:taskId', uploadLimiter, requireDb, requireAuth(), readImageBody, async (req, res) => {
  const { taskId } = req.params
  if (!ID_RE.test(taskId)) return res.status(404).json({ error: 'Task not found.' })
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  const type = TYPES[mime]
  if (!type || !Buffer.isBuffer(req.body)) {
    return res.status(415).json({ error: 'Photo must be a JPEG, PNG, or WebP image.' })
  }
  // The declared type must agree with the bytes.
  if (!hasImageMagic(type, req.body)) {
    return res.status(400).json({ error: 'That file is not a valid JPEG, PNG, or WebP image.' })
  }
  const clean = stripImageMetadata(type, req.body)
  if (!clean || !hasImageMagic(type, clean)) {
    return res.status(400).json({ error: 'That file is not a valid JPEG, PNG, or WebP image.' })
  }

  try {
    const { rows } = await query(
      `SELECT t.created_by, t.status, u.posting_suspended_at
         FROM public_tasks t JOIN users u ON u.id = t.created_by
        WHERE t.id = $1`,
      [taskId],
    )
    const task = rows[0]
    if (!task || task.created_by !== req.auth.sub) return res.status(404).json({ error: 'Task not found.' })
    if (task.posting_suspended_at) {
      return res.status(403).json({ error: "Your account can't post volunteer tasks right now. Contact us if you think this is a mistake." })
    }
    if (task.status === 'cancelled') return res.status(409).json({ error: 'This task was cancelled.' })

    // A new id per upload: the URL is the cache key, so a replaced photo is
    // never served from a stale cache entry.
    const photoId = `tphoto_${randomBytes(16).toString('hex')}`
    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      // Replacing removes the old bytes in the same transaction.
      await client.query('DELETE FROM public_task_photos WHERE task_id = $1', [taskId])
      await client.query(
        `INSERT INTO public_task_photos (id, task_id, mime, bytes, data, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [photoId, taskId, mime, clean.length, clean, req.auth.sub],
      )
      await client.query('UPDATE public_tasks SET cover_photo_id = $1, updated_at = now() WHERE id = $2', [photoId, taskId])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
    return res.json({ ok: true, coverPhotoId: photoId })
  } catch (error) {
    console.error('task photo upload failed:', error)
    return res.status(500).json({ error: 'Could not save the photo.' })
  }
})

/** Deletes a task's cover photo. Used by the route below and admin moderation. */
export async function removeTaskPhoto(taskId) {
  await query('DELETE FROM public_task_photos WHERE task_id = $1', [taskId])
  await query('UPDATE public_tasks SET cover_photo_id = NULL, updated_at = now() WHERE id = $1 AND cover_photo_id IS NOT NULL', [taskId])
}

// DELETE /api/task-photos/:taskId — the organizer, or an admin moderating.
router.delete('/:taskId', uploadLimiter, requireDb, requireAuth(), async (req, res) => {
  const { taskId } = req.params
  if (!ID_RE.test(taskId)) return res.status(404).json({ error: 'Task not found.' })
  try {
    const { rows } = await query('SELECT created_by FROM public_tasks WHERE id = $1', [taskId])
    if (!rows[0] || (rows[0].created_by !== req.auth.sub && req.auth.role !== 'admin')) {
      return res.status(404).json({ error: 'Task not found.' })
    }
    await removeTaskPhoto(taskId)
    return res.json({ ok: true })
  } catch (error) {
    console.error('task photo delete failed:', error)
    return res.status(500).json({ error: 'Could not remove the photo.' })
  }
})

// GET /api/task-photos/file/:photoId — the image. Public like the task list
// it appears in (GET /api/school/public-tasks needs no sign-in either), and
// the 128-bit id isn't guessable. Not served once the organizer is suspended.
router.get('/file/:photoId', readLimiter, requireDb, async (req, res) => {
  const { photoId } = req.params
  if (!/^tphoto_[0-9a-f]{32}$/.test(photoId)) return res.status(404).end()
  try {
    const { rows } = await query(
      `SELECT p.mime, p.data
         FROM public_task_photos p
         JOIN public_tasks t ON t.id = p.task_id
         JOIN users u ON u.id = t.created_by
        WHERE p.id = $1 AND u.posting_suspended_at IS NULL`,
      [photoId],
    )
    if (!rows[0]) return res.status(404).end()
    res.set({
      'Content-Type': rows[0].mime,
      // Ids change on every replace; an hour keeps a moderated photo from
      // lingering long in caches.
      'Cache-Control': 'public, max-age=3600',
      // helmet defaults to same-origin; the site is served from another origin.
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline',
    })
    return res.send(rows[0].data)
  } catch (error) {
    console.error('task photo read failed:', error)
    return res.status(500).end()
  }
})

export default router
