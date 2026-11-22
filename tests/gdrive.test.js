// Google Drive storage (#919), run against a small fake of Google's APIs so
// the upload → find → read → delete path is checked without a real account.
import test from 'node:test'
import assert from 'node:assert/strict'

process.env.GOOGLE_STORAGE_CLIENT_ID = 'cid.apps.googleusercontent.com'
process.env.GOOGLE_STORAGE_CLIENT_SECRET = 'secret'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
process.env.PUBLIC_API_URL = 'https://api.example.org'

const g = await import('../server/storage/gdrive.js')

// --- a fake Drive --------------------------------------------------------
function fakeDrive() {
  const files = new Map() // id -> { id, name, mimeType, parents, appProperties, body }
  const sessions = new Map() // url -> metadata
  let n = 0
  const calls = []
  const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...headers } })
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    const method = (init.method || 'GET').toUpperCase()
    calls.push(`${method} ${url.pathname}`)
    if (url.href.startsWith('https://oauth2.googleapis.com/token')) {
      const body = new URLSearchParams(String(init.body))
      if (body.get('grant_type') === 'refresh_token' && body.get('refresh_token') === 'gone') return json({ error: 'invalid_grant' }, 400)
      return json({ access_token: 'at_1', expires_in: 3600 })
    }
    if (url.hostname === 'upload.example') {
      const meta = sessions.get(url.href)
      const id = `f${++n}`
      files.set(id, { id, ...meta, body: Buffer.from(await new Response(init.body).arrayBuffer()) })
      return json({ id })
    }
    assert.equal((init.headers || {}).Authorization, 'Bearer at_1')
    if (url.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const loc = `https://upload.example/s/${++n}`
      sessions.set(loc, JSON.parse(init.body))
      return new Response('', { status: 200, headers: { Location: loc } })
    }
    if (url.pathname === '/drive/v3/files' && method === 'POST') {
      const meta = JSON.parse(init.body)
      const id = `d${++n}`
      files.set(id, { id, ...meta })
      return json({ id })
    }
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q')
      let list = [...files.values()].filter((f) => !f.trashed)
      const tag = q.match(/value='([0-9a-f]+)'/)
      if (tag) list = list.filter((f) => f.appProperties?.vt_key === tag[1])
      const parent = q.match(/^'([^']+)' in parents and name = '([^']+)'/)
      if (parent) list = list.filter((f) => f.parents?.includes(parent[1]) && f.name === parent[2])
      return json({ files: list.slice(0, 1).map((f) => ({ id: f.id, mimeType: f.mimeType, size: f.body ? String(f.body.length) : undefined })) })
    }
    const one = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/)
    if (one && method === 'GET' && url.searchParams.get('alt') === 'media') {
      const f = files.get(decodeURIComponent(one[1]))
      return f ? new Response(f.body, { status: 200 }) : json({ error: { message: 'not found' } }, 404)
    }
    if (one && method === 'DELETE') { files.delete(decodeURIComponent(one[1])); return new Response(null, { status: 204 }) }
    throw new Error(`unexpected ${method} ${url.href}`)
  }
  return { fetch, files, calls }
}

test('helpers', () => {
  assert.equal(g.gdriveConfigured(), true)
  assert.equal(g.gdriveConfigured({}), false)
  assert.equal(g.mimeForKey('students/u/proof_1.PDF'), 'application/pdf')
  assert.equal(g.mimeForKey('a/b.exe'), 'application/octet-stream')
  assert.equal(g.keyTag('a').length, 64)
  const idToken = `x.${Buffer.from(JSON.stringify({ email: 'Office@School.org' })).toString('base64url')}.y`
  assert.equal(g.emailFromIdToken(idToken), 'office@school.org')
  assert.equal(g.emailFromIdToken('junk'), null)
  const u = new URL(g.gdriveAuthUrl({ redirectUri: 'https://api/cb', state: 's1' }))
  assert.equal(u.searchParams.get('access_type'), 'offline')
  assert.equal(u.searchParams.get('prompt'), 'consent')
  assert.match(u.searchParams.get('scope'), /auth\/drive\.file/)
  assert.doesNotMatch(u.searchParams.get('scope'), /auth\/drive( |$)/) // never the whole Drive
  assert.equal(u.searchParams.get('state'), 's1')
})

test('upload, find, read and round trip against a fake Drive', async () => {
  const fake = fakeDrive()
  const realFetch = globalThis.fetch
  globalThis.fetch = fake.fetch
  try {
    const cfg = { id: 'tsto_1', refreshToken: 'rt', rootId: 'root', prefix: '' }
    // The browser's upload: a session URL, then one PUT of the whole file.
    const key = 'students/usr_1/proof_abc.png'
    const url = await g.gdriveUploadUrl(cfg, key, { bytes: 3, origin: 'https://app.example' })
    assert.match(url, /^https:\/\/upload\.example\//)
    await fetch(url, { method: 'PUT', body: Buffer.from([1, 2, 3]) })
    // Folders students/usr_1 were made under the root, once.
    const folders = [...fake.files.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.folder')
    assert.deepEqual(folders.map((f) => f.name), ['students', 'usr_1'])
    assert.deepEqual(folders[0].parents, ['root'])
    const opened = await g.gdriveOpen(cfg, key)
    assert.equal(opened.mime, 'image/png')
    assert.deepEqual([...Buffer.from(await opened.res.arrayBuffer())], [1, 2, 3])
    assert.equal(await g.gdriveOpen(cfg, 'students/usr_1/missing.png'), null)
    // A second upload for the same student reuses the folders.
    await g.gdriveUploadUrl(cfg, 'students/usr_1/proof_def.png', { bytes: 1 })
    assert.equal([...fake.files.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.folder').length, 2)

    const rt = await g.gdriveRoundTrip(cfg)
    assert.deepEqual(rt, { ok: true, error: null })
    assert.equal([...fake.files.values()].filter((f) => f.name?.startsWith('voluntrack-check-')).length, 0, 'test file deleted')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a revoked Google connection says so', async () => {
  const fake = fakeDrive()
  const realFetch = globalThis.fetch
  globalThis.fetch = fake.fetch
  try {
    const rt = await g.gdriveRoundTrip({ id: 'tsto_gone', refreshToken: 'gone', rootId: 'root', prefix: '' })
    assert.equal(rt.ok, false)
    assert.match(rt.error, /Connect Google Drive again/)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('view links are signed, scoped and short-lived', async () => {
  const { gdriveViewUrl } = await import('../server/storage/adapter.js')
  const jwt = (await import('jsonwebtoken')).default
  const url = new URL(gdriveViewUrl({ id: 'tsto_1' }, 'students/u/proof.png', 300))
  assert.equal(url.origin + url.pathname, 'https://api.example.org/api/storage/gdrive/file')
  const t = jwt.verify(url.searchParams.get('t'), process.env.JWT_SECRET)
  assert.equal(t.purpose, 'gdrive_view')
  assert.equal(t.sid, 'tsto_1')
  assert.equal(t.key, 'students/u/proof.png')
  assert.ok(t.exp - t.iat <= 300)
})
