import { query, hasDatabase } from './db.js'
import { uid } from './ids.js'

// Admin activity log (#909): every request an admin account makes to the API
// is written here once it finishes, so the main admin can see who opened what
// and changed what. Only the method, the path (no query string) and the
// status are kept: never a body, which can hold keys, notes or payment data.
// Rows older than KEEP_DAYS are pruned now and then.
const KEEP_DAYS = 365
let lastPrune = 0
const recent = new Map()

// Human words for the routes an admin uses. The first match wins.
const TAB_NAMES = { inbox: 'Inbox', reviews: 'Reviews', schools: 'Schools', invites: 'Invites', organizations: 'Organizations', incidents: 'Incidents', reports: 'Reports', settings: 'Settings', users: 'Users', api: 'API', blueprint: 'Blueprint' }

const LABELS = [
  ['GET', /^\/api\/contact\/admin/, 'Opened the Inbox'],
  [null, /^\/api\/contact\//, 'Worked in the Inbox'],
  ['GET', /^\/api\/reviews\/admin/, 'Opened Reviews'],
  [null, /^\/api\/reviews\//, 'Changed a review'],
  ['POST', /^\/api\/(school|organization)\/admin\/notify-[^/]+(\/[^/]+)?\/preview$/, 'Previewed a payment notice'],
  ['POST', /^\/api\/announcements\/admin\/preview$/, 'Previewed an announcement'],
  ['DELETE', /^\/api\/school\/admin\/notices\//, 'Deleted a payment notice'],
  ['GET', /^\/api\/school\/admin\/list/, 'Opened Schools'],
  ['PATCH', /^\/api\/school\/admin\/[^/]+\/payment/, 'Changed a school’s payment status'],
  ['PATCH', /^\/api\/school\/admin\/[^/]+\/plan/, 'Changed a school’s plan'],
  ['PATCH', /^\/api\/school\/admin\/[^/]+\/price/, 'Set a school’s price'],
  ['DELETE', /^\/api\/school\/admin\/[^/]+$/, 'Deleted a school'],
  [null, /^\/api\/school\/admin\//, 'Worked on schools'],
  ['GET', /^\/api\/organization\/admin/, 'Opened Organizations'],
  [null, /^\/api\/organization\/admin\//, 'Worked on organizations'],
  ['POST', /^\/api\/invoices\/admin\/preview$/, 'Previewed an invoice'],
  ['POST', /^\/api\/invoices\/admin$/, 'Sent an invoice'],
  [null, /^\/api\/invoices\//, 'Worked on invoices'],
  ['POST', /^\/api\/registration-codes\/admin\/event/, 'Made or changed an event code'],
  ['POST', /^\/api\/registration-codes\/admin\/upgrade/, 'Made or revoked a club upgrade code'],
  ['POST', /^\/api\/registration-codes\/admin/, 'Made or revoked a registration code'],
  ['GET', /^\/api\/registration-codes\//, 'Opened Invites & codes'],
  ['POST', /^\/api\/admin\/test-accounts\/sign-in/, 'Signed in as a test account'],
  [null, /^\/api\/admin\/test-accounts/, 'Opened test accounts'],
  [null, /^\/api\/admin\/team\/[^/]+\/permissions/, 'Changed an admin’s access'],
  [null, /^\/api\/admin\/team/, 'Admin team'],
  ['GET', /^\/api\/stats\/admin/, 'Opened Users'],
  [null, /^\/api\/reports\//, 'Worked on reported tasks'],
  [null, /^\/api\/announcements/, 'Worked on announcements'],
  ['GET', /^\/api\/settings\//, 'Opened Settings'],
  [null, /^\/api\/settings\//, 'Changed site settings'],
  [null, /^\/api\/status\//, 'Worked on incidents / status'],
  [null, /^\/api\/referral\//, 'Worked on referrals'],
]

export function activityLabel(method, path) {
  const seen = path.match(/^\/api\/admin\/team\/seen\/([a-z]+)$/)
  if (seen) return `Opened the ${TAB_NAMES[seen[1]] || seen[1]} tab`
  for (const [m, re, label] of LABELS) if ((!m || m === method) && re.test(path)) return label
  return null
}

// Express middleware, after authenticate(). Skips the quiet reads every page
// makes (who am I, bell, announcements) so the log stays readable.
const QUIET = /^\/api\/(auth\/me$|notifications|announcements\/mine|status\/(ping|health)|client-errors)/
export function adminActivityLogger(req, res, next) {
  if (!hasDatabase() || req.auth?.role !== 'admin') return next()
  const path = String(req.originalUrl || '').split('?')[0].slice(0, 300)
  if (QUIET.test(path)) return next()
  const method = req.method
  // Reads aren't logged: the admin panel loads every tab's data in the
  // background, so a GET doesn't mean anyone looked. Tab visits come from
  // POST /api/admin/team/seen/:tab instead; every change is logged.
  if (method === 'GET' || method === 'OPTIONS' || method === 'HEAD') return next()
  const adminId = req.auth.sub
  // The same request twice within a few seconds (a double click, or React
  // running an effect twice in development) is one entry.
  const key = `${adminId} ${method} ${path}`
  const now = Date.now()
  if (now - (recent.get(key) || 0) < 3000) return next()
  recent.set(key, now)
  if (recent.size > 500) for (const [k, t] of recent) if (now - t > 3000) recent.delete(k)
  res.on('finish', () => {
    query(
      'INSERT INTO admin_activity (id, admin_id, method, path, status) VALUES ($1, $2, $3, $4, $5)',
      [uid('adm'), adminId, method, path, res.statusCode],
    ).catch((e) => console.error('admin activity write failed:', e.message))
    if (Date.now() - lastPrune > 24 * 60 * 60 * 1000) {
      lastPrune = Date.now()
      query(`DELETE FROM admin_activity WHERE created_at < now() - make_interval(days => $1)`, [KEEP_DAYS]).catch(() => {})
    }
  })
  next()
}
