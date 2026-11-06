// Jobs at an event (#759). The organizer keeps a short list of jobs ("Sort
// cans", 2 spots) and an optional note for everyone. Approved volunteers see
// the list on their badge and claim one; the organizer can assign or change
// anyone's. A volunteer's job and the note show in a pop-up when they check in
// (QR, phone code or kiosk). None of this is on the public task or the
// sign-up page: only the organizer, co-hosts and approved volunteers see it.
import { query, getPool } from './db.js'
import { uid } from './ids.js'
import { requireAuth } from './auth.js'
import { canManageTask, refuseTaskAccess } from './taskCohosts.js'

export const MAX_JOBS = 20
const TITLE_MAX = 120
const NOTE_MAX = 300

const cleanText = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** The jobs with how many hold each, and the note, for one task. */
async function jobList(taskId, db = { query }) {
  const { rows } = await db.query(
    `SELECT j.id, j.title, j.spots,
            (SELECT COUNT(*)::int FROM public_task_signups s WHERE s.job_id = j.id AND s.status = 'approved') AS taken
       FROM public_task_jobs j WHERE j.task_id = $1 ORDER BY j.position, j.id`,
    [taskId],
  )
  return rows
}

/** What a volunteer sees at check-in: their job's title and the everyone note. */
export async function checkinJobs(taskId, userId) {
  const { rows } = await query(
    `SELECT t.everyone_job, j.title AS job
       FROM public_tasks t
       LEFT JOIN public_task_signups s ON s.task_id = t.id AND s.user_id = $2 AND s.status = 'approved'
       LEFT JOIN public_task_jobs j ON j.id = s.job_id
      WHERE t.id = $1`,
    [taskId, userId],
  )
  const r = rows[0]
  return { job: r?.job || null, everyone: r?.everyone_job || null }
}

/** The approved signup of `userId` on an event that hasn't ended or been cancelled. */
async function volunteerSignup(taskId, userId) {
  const { rows } = await query(
    `SELECT s.id, s.job_id, t.status AS task_status, t.date < CURRENT_DATE - 1 AS past
       FROM public_task_signups s JOIN public_tasks t ON t.id = s.task_id
      WHERE s.task_id = $1 AND s.user_id = $2 AND s.status = 'approved'`,
    [taskId, userId],
  )
  return rows[0] || null
}

/**
 * Puts `signupId` on `jobId` (or none), checking spots under a lock on the
 * job so two people can't take the last spot. Returns an error string or null.
 */
async function setJob(signupId, taskId, jobId) {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    if (jobId) {
      const { rows } = await client.query('SELECT id, spots FROM public_task_jobs WHERE id = $1 AND task_id = $2 FOR UPDATE', [jobId, taskId])
      if (!rows[0]) { await client.query('ROLLBACK'); return 'That job no longer exists.' }
      const { rows: c } = await client.query(
        "SELECT COUNT(*)::int AS n FROM public_task_signups WHERE job_id = $1 AND status = 'approved' AND id <> $2",
        [jobId, signupId],
      )
      if (c[0].n >= rows[0].spots) { await client.query('ROLLBACK'); return 'That job is full. Pick another one.' }
    }
    await client.query('UPDATE public_task_signups SET job_id = $2 WHERE id = $1', [signupId, jobId || null])
    await client.query('COMMIT')
    return null
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

export function registerTaskJobRoutes(router, { limiter, requireDb }) {
  // GET /public-tasks/:id/jobs — the organizer gets who holds each job; an
  // approved volunteer gets the list with spots left and their own pick.
  router.get('/public-tasks/:id/jobs', limiter, requireDb, requireAuth(), async (req, res) => {
    try {
      const access = await canManageTask(req.params.id, req.auth.sub)
      if (!access.found) return res.status(404).json({ error: 'Task not found.' })
      const { rows: t } = await query('SELECT everyone_job FROM public_tasks WHERE id = $1', [req.params.id])
      const jobs = await jobList(req.params.id)
      if (access.allowed) {
        const { rows: holders } = await query(
          `SELECT s.user_id, s.job_id FROM public_task_signups s WHERE s.task_id = $1 AND s.status = 'approved'`,
          [req.params.id],
        )
        return res.json({ everyone: t[0]?.everyone_job || '', jobs, assigned: Object.fromEntries(holders.map((h) => [h.user_id, h.job_id])) })
      }
      const mine = await volunteerSignup(req.params.id, req.auth.sub)
      if (!mine) return res.status(403).json({ error: 'Jobs show once the organizer approves your sign-up.' })
      return res.json({
        everyone: t[0]?.everyone_job || '',
        jobs: jobs.map((j) => ({ id: j.id, title: j.title, spots: j.spots, left: Math.max(0, j.spots - j.taken) })),
        myJobId: mine.job_id,
        canClaim: mine.task_status !== 'cancelled' && !mine.past,
      })
    } catch (error) {
      console.error('task jobs failed:', error)
      return res.status(500).json({ error: 'Could not load the jobs.' })
    }
  })

  // PUT /public-tasks/:id/jobs — the organizer saves the list and the note.
  // { everyone, jobs: [{ id?, title, spots }] }; a job left out is removed and
  // its volunteers go back to no job.
  router.put('/public-tasks/:id/jobs', limiter, requireDb, requireAuth(), async (req, res) => {
    if (refuseTaskAccess(res, await canManageTask(req.params.id, req.auth.sub), "Only the task's organizer or a co-host can change the jobs.")) return
    const list = Array.isArray(req.body?.jobs) ? req.body.jobs : []
    if (list.length > MAX_JOBS) return res.status(400).json({ error: `At most ${MAX_JOBS} jobs per event.` })
    const jobs = []
    for (const j of list) {
      const title = cleanText(j?.title, TITLE_MAX)
      const spots = Math.round(Number(j?.spots))
      if (!title) continue
      if (!Number.isFinite(spots) || spots < 1 || spots > 200) return res.status(400).json({ error: 'Each job needs 1 to 200 spots.' })
      jobs.push({ id: typeof j?.id === 'string' ? j.id : null, title, spots })
    }
    const everyone = cleanText(req.body?.everyone, NOTE_MAX)
    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      const { rows: existing } = await client.query('SELECT id FROM public_task_jobs WHERE task_id = $1', [req.params.id])
      const keep = new Set(existing.map((r) => r.id))
      const kept = new Set()
      for (const [i, j] of jobs.entries()) {
        if (j.id && keep.has(j.id)) {
          await client.query('UPDATE public_task_jobs SET title = $2, spots = $3, position = $4 WHERE id = $1', [j.id, j.title, j.spots, i])
          kept.add(j.id)
        } else {
          await client.query('INSERT INTO public_task_jobs (id, task_id, title, spots, position) VALUES ($1, $2, $3, $4, $5)', [uid('job'), req.params.id, j.title, j.spots, i])
        }
      }
      const gone = [...keep].filter((id) => !kept.has(id))
      if (gone.length) await client.query('DELETE FROM public_task_jobs WHERE id = ANY($1)', [gone])
      await client.query('UPDATE public_tasks SET everyone_job = $2 WHERE id = $1', [req.params.id, everyone || null])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      console.error('save task jobs failed:', error)
      return res.status(500).json({ error: 'Could not save the jobs.' })
    } finally {
      client.release()
    }
    return res.json({ ok: true, everyone, jobs: await jobList(req.params.id) })
  })

  // PUT /public-tasks/:id/jobs/assign — the organizer gives { userId } a job ({ jobId } or null).
  router.put('/public-tasks/:id/jobs/assign', limiter, requireDb, requireAuth(), async (req, res) => {
    if (refuseTaskAccess(res, await canManageTask(req.params.id, req.auth.sub), "Only the task's organizer or a co-host can assign jobs.")) return
    try {
      const { rows } = await query(
        "SELECT id FROM public_task_signups WHERE task_id = $1 AND user_id = $2 AND status = 'approved'",
        [req.params.id, String(req.body?.userId || '')],
      )
      if (!rows[0]) return res.status(404).json({ error: 'That volunteer isn’t approved for this event.' })
      const problem = await setJob(rows[0].id, req.params.id, req.body?.jobId ? String(req.body.jobId) : null)
      if (problem) return res.status(409).json({ error: problem })
      return res.json({ ok: true })
    } catch (error) {
      console.error('assign job failed:', error)
      return res.status(500).json({ error: 'Could not assign the job.' })
    }
  })

  // PUT /public-tasks/:id/jobs/mine — an approved volunteer claims { jobId } or lets go (null).
  router.put('/public-tasks/:id/jobs/mine', limiter, requireDb, requireAuth(), async (req, res) => {
    try {
      const mine = await volunteerSignup(req.params.id, req.auth.sub)
      if (!mine) return res.status(403).json({ error: 'Jobs show once the organizer approves your sign-up.' })
      if (mine.task_status === 'cancelled') return res.status(400).json({ error: 'This event was cancelled.' })
      if (mine.past) return res.status(400).json({ error: 'This event is over.' })
      const problem = await setJob(mine.id, req.params.id, req.body?.jobId ? String(req.body.jobId) : null)
      if (problem) return res.status(409).json({ error: problem })
      return res.json({ ok: true })
    } catch (error) {
      console.error('claim job failed:', error)
      return res.status(500).json({ error: 'Could not save your job.' })
    }
  })
}
