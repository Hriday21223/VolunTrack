// SharePoint / OneDrive for Business through Microsoft Graph (#924), as a
// school's own storage. Same promise as the S3 path: the file goes from the
// student's device straight to the school's SharePoint (a Graph upload
// session URL), and is read through a short-lived download link. Our server
// only ever talks to login.microsoftonline.com and graph.microsoft.com.
//
// Auth is app-only (client credentials) with our own Microsoft app
// (MS_STORAGE_CLIENT_ID / MS_STORAGE_CLIENT_SECRET), using the Sites.Selected
// permission: a school's Microsoft 365 admin approves the app for their
// tenant once, then grants it write access to ONE SharePoint site. The app
// can't see any other site, mailbox or person's files.
//
// Config mapping on tenant_storage (provider 'sharepoint'): region = the
// school's Entra tenant id, endpoint = the SharePoint site URL, bucket = the
// document library name ('Documents' by default), prefix = a folder in it.

const GRAPH = 'https://graph.microsoft.com/v1.0'

export function sharepointConfigured() {
  return Boolean(process.env.MS_STORAGE_CLIENT_ID && process.env.MS_STORAGE_CLIENT_SECRET)
}
export function sharepointClientId() {
  return process.env.MS_STORAGE_CLIENT_ID || ''
}

// A SharePoint site address: https://<tenant>.sharepoint.com/sites/<name>
// (or the government clouds). We never fetch it; it's only parsed for Graph.
export function parseSiteUrl(raw) {
  let u
  try { u = new URL(String(raw || '').trim()) } catch { return null }
  if (u.protocol !== 'https:') return null
  if (!/^[a-z0-9-]+\.sharepoint\.(com|us)$/i.test(u.hostname)) return null
  const path = u.pathname.replace(/\/+$/, '')
  if (!/^\/(sites|teams)\/[^/]+$/i.test(path)) return null
  return { host: u.hostname.toLowerCase(), path }
}

export const validTenantId = (t) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(t || ''))

// A school may use its OWN Entra app instead of ours (#926): then cfg carries
// its client id and secret, and only that school's tenant is involved.
const tokens = new Map() // tenant|client -> { token, until }
async function appToken(tenant, cfg = {}) {
  const clientId = cfg.clientId || process.env.MS_STORAGE_CLIENT_ID
  const clientSecret = cfg.clientId ? cfg.clientSecret : process.env.MS_STORAGE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('No Microsoft app is set up for this storage.')
  const cacheKey = `${tenant}|${clientId}`
  const hit = tokens.get(cacheKey)
  if (hit && hit.until > Date.now() + 60_000) return hit.token
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok || !d.access_token) {
    throw new Error(d.error_description ? String(d.error_description).split('\r\n')[0] : 'Microsoft sign-in for the app failed. Has your admin approved VolunTrack?')
  }
  tokens.set(cacheKey, { token: d.access_token, until: Date.now() + (Number(d.expires_in) || 3600) * 1000 })
  return d.access_token
}

async function graph(tenant, path, init = {}, cfg = {}) {
  const token = await appToken(tenant, cfg)
  const res = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) },
    signal: AbortSignal.timeout(20_000),
  })
  return res
}

async function graphError(res, what) {
  const d = await res.json().catch(() => ({}))
  const msg = d?.error?.message || `HTTP ${res.status}`
  if (res.status === 403) return `${what}: VolunTrack doesn’t have write access to this site yet (${msg}).`
  if (res.status === 404) return `${what}: not found (${msg}).`
  return `${what}: ${msg}`
}

// Site + library → drive id. Cached per config for an hour.
const drives = new Map()
async function driveId(cfg) {
  const k = `${cfg.tenant}|${cfg.site}|${cfg.library}`
  const hit = drives.get(k)
  if (hit && hit.until > Date.now()) return hit.id
  const site = parseSiteUrl(cfg.site)
  if (!site) throw new Error('That isn’t a SharePoint site address.')
  const s = await graph(cfg.tenant, `/sites/${site.host}:${site.path}?$select=id`, {}, cfg)
  if (!s.ok) throw new Error(await graphError(s, 'Finding the site'))
  const siteId = (await s.json()).id
  const d = await graph(cfg.tenant, `/sites/${encodeURIComponent(siteId)}/drives?$select=id,name`, {}, cfg)
  if (!d.ok) throw new Error(await graphError(d, 'Finding the document library'))
  const list = (await d.json()).value || []
  const want = String(cfg.library || 'Documents').toLowerCase()
  const drive = list.find((x) => String(x.name).toLowerCase() === want) || (want === 'documents' ? list[0] : null)
  if (!drive) throw new Error(`No document library called “${cfg.library}” on that site.`)
  drives.set(k, { id: drive.id, until: Date.now() + 60 * 60 * 1000 })
  return drive.id
}

const itemPath = (key) => key.split('/').map(encodeURIComponent).join('/')

// A one-time upload URL the student's device PUTs the file to (with a
// Content-Range header). It needs no token: the URL is the credential.
export async function sharepointUploadUrl(cfg, key) {
  const d = await driveId(cfg)
  const r = await graph(cfg.tenant, `/drives/${d}/root:/${itemPath(key)}:/createUploadSession`, {
    method: 'POST',
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'fail' } }),
  }, cfg)
  if (!r.ok) throw new Error(await graphError(r, 'Preparing the upload'))
  return (await r.json()).uploadUrl
}

// Microsoft's short-lived download link (pre-authenticated, about an hour).
export async function sharepointDownloadUrl(cfg, key) {
  const d = await driveId(cfg)
  const r = await graph(cfg.tenant, `/drives/${d}/root:/${itemPath(key)}?$select=id,@microsoft.graph.downloadUrl`, {}, cfg)
  if (!r.ok) throw new Error(await graphError(r, 'Opening the file'))
  return (await r.json())['@microsoft.graph.downloadUrl'] || null
}

// Server-side write (moving old documents out of our database).
export async function sharepointPut(cfg, key, body) {
  const url = await sharepointUploadUrl(cfg, key)
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Range': `bytes 0-${body.length - 1}/${body.length}` }, body, signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`SharePoint returned ${res.status}`)
}

// The gate for status='active': write, read back, delete a small file.
export async function sharepointRoundTrip(cfg) {
  if (!sharepointConfigured() && !cfg.clientId) return { ok: false, error: 'SharePoint isn’t set up on this server yet.' }
  const key = `${cfg.prefix ? `${cfg.prefix}/` : ''}.voluntrack-probe-${Date.now()}.txt`
  const body = Buffer.from(`voluntrack storage check ${new Date().toISOString()}`)
  let written = false
  try {
    await sharepointPut(cfg, key, body)
    written = true
    const url = await sharepointDownloadUrl(cfg, key)
    const got = url ? await fetch(url, { signal: AbortSignal.timeout(20_000) }) : null
    if (!got?.ok) return { ok: false, error: 'Could not read the test file back.' }
    if ((await got.text()) !== body.toString()) return { ok: false, error: 'The test file read back with different contents.' }
    const d = await driveId(cfg)
    const del = await graph(cfg.tenant, `/drives/${d}/root:/${itemPath(key)}`, { method: 'DELETE' }, cfg)
    if (!del.ok && del.status !== 404) return { ok: false, error: await graphError(del, 'Deleting the test file') }
    written = false
    return { ok: true, error: null }
  } catch (error) {
    return { ok: false, error: error.message }
  } finally {
    if (written) {
      driveId(cfg).then((d) => graph(cfg.tenant, `/drives/${d}/root:/${itemPath(key)}`, { method: 'DELETE' }, cfg)).catch(() => {})
    }
  }
}
