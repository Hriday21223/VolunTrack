import { query, hasDatabase } from './db.js'

// What each admin may use (#911). The main admin (ADMIN_EMAIL) can use
// everything and is never limited. Other admins have users.admin_permissions:
// NULL = everything (admins made before this existed), else a list of AREAS.
// adminPermissionGuard() runs on every request after authenticate() and
// refuses an admin-only route whose area the admin doesn't have, so a
// hidden tab can't be reached by typing its address.
export const AREAS = {
  inbox: 'Inbox',
  reviews: 'Reviews',
  schools: 'Schools, organizations & billing',
  invites: 'Invites & codes',
  incidents: 'Incidents & app errors',
  reports: 'Reported tasks',
  announcements: 'Announcements',
  settings: 'Site settings',
  users: 'Users (sign-up numbers)',
  test_accounts: 'Sign in as a test account',
  api: 'API',
  blueprint: 'Blueprint',
}
export const AREA_IDS = Object.keys(AREAS)

// Admin panel tab → the area it needs.
export const TAB_AREA = {
  inbox: 'inbox', reviews: 'reviews', schools: 'schools', organizations: 'schools', invites: 'invites',
  incidents: 'incidents', reports: 'reports', settings: 'settings', users: 'users', api: 'api', blueprint: 'blueprint',
}

// Path (after /api) → area. First match wins; more specific rules first.
const RULES = [
  [/^\/contact\/admin/, 'inbox'],
  [/^\/reviews\/admin/, 'reviews'],
  [/^\/(school|organization)\/admin\/invites?(\/|$)/, 'invites'],
  [/^\/registration-codes\/admin/, 'invites'],
  [/^\/(school|organization)\/admin/, 'schools'],
  [/^\/invoices\/admin/, 'schools'],
  [/^\/referral\/admin/, 'schools'],
  [/^\/settings\/(promo|payment-instructions)/, 'schools'],
  [/^\/status\/(incidents|live-checks)/, 'incidents'],
  [/^\/client-errors\/admin/, 'incidents'],
  [/^\/reports\/admin/, 'reports'],
  [/^\/announcements\/admin/, 'announcements'],
  [/^\/settings\/blueprint-docs/, 'blueprint'],
  [/^\/settings\/(email|office-hours)/, 'settings'],
  [/^\/parent\/admin/, 'settings'],
  [/^\/stats\/admin/, 'users'],
  [/^\/admin\/test-accounts/, 'test_accounts'],
  [/^\/status\/routes/, 'api'],
]

export function areaForPath(apiPath) {
  for (const [re, area] of RULES) if (re.test(apiPath)) return area
  return null
}

export function cleanPermissions(list) {
  if (!Array.isArray(list)) return null
  return [...new Set(list.map(String).filter((a) => AREA_IDS.includes(a)))]
}

const mainEmail = () => String(process.env.ADMIN_EMAIL || '').trim().toLowerCase()

// { isMain, permissions } for an admin account; permissions is the full list
// for the main admin or an unlimited one. Cached briefly; forget() on change.
const cache = new Map()
const TTL = 30 * 1000
export async function adminAccess(userId) {
  const hit = cache.get(userId)
  if (hit && Date.now() - hit.at < TTL) return hit.value
  const { rows } = await query('SELECT email, admin_permissions FROM users WHERE id = $1 AND role = $2', [userId, 'admin'])
  const row = rows[0]
  let value
  if (!row) value = { isMain: false, permissions: [] }
  else {
    const isMain = Boolean(mainEmail()) && String(row.email).toLowerCase() === mainEmail()
    value = { isMain, permissions: isMain || row.admin_permissions == null ? AREA_IDS : cleanPermissions(row.admin_permissions) }
  }
  cache.set(userId, { value, at: Date.now() })
  return value
}
export function forgetAdminAccess(userId) { cache.delete(userId) }

export async function adminPermissionGuard(req, res, next) {
  if (!hasDatabase() || req.auth?.role !== 'admin') return next()
  const apiPath = String(req.originalUrl || '').split('?')[0].replace(/^\/api/, '')
  const area = areaForPath(apiPath)
  if (!area) return next()
  try {
    const { permissions } = await adminAccess(req.auth.sub)
    if (permissions.includes(area)) return next()
    return res.status(403).json({ error: 'You don’t have access to this part of the admin panel.', area })
  } catch (error) {
    // Fail closed: an unreadable permission list never opens an area.
    console.error('admin permission check failed:', error.message)
    return res.status(503).json({ error: 'Could not check your access. Try again.' })
  }
}
