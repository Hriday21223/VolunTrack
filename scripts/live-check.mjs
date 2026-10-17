// Live-site test robot (#315). Checks the deployed site the way a visitor's
// browser sees it, then reports to the backend, which keeps the history and
// emails the admin when a check keeps failing (POST /api/status/live-checks).
//
//   node scripts/live-check.mjs                 run and print the results
//   CRON_SECRET=… node scripts/live-check.mjs   …and report them
//
// SITE_URL / API_URL point it somewhere other than production. Run by
// .github/workflows/live-check.yml. It never finishes a sign-up: a robot that
// made real accounts or sent real email every few hours would be noise.
//
// With MONITOR_EMAIL / MONITOR_PASSWORD / MONITOR_SECRET it also signs in as
// its own empty student account (server/monitor.js, #318) and loads the
// signed-in pages, read-only; without them those checks are skipped. With
// ANTHROPIC_API_KEY, a failing run gets a short AI-written summary of what
// probably broke.
import { execSync } from 'node:child_process'
import puppeteer from 'puppeteer'

const SITE = (process.env.SITE_URL || 'https://volunteer-track-two.vercel.app').replace(/\/$/, '')
const API = (process.env.API_URL || 'https://voluntrack-backend-frrh.onrender.com/api').replace(/\/$/, '')
// Every page that opens without signing in (src/App.jsx), bar /auth/sso/return,
// which only works mid sign-in. The verify pages load without a token and
// show their own "link missing" message, which is still a working page.
const PAGES = [
  '/', '/about', '/help', '/contact', '/terms', '/privacy',
  '/login', '/register', '/forgot-password', '/reset-password', '/reset-pin', '/sync-login',
  '/school/register', '/organization/register',
  '/status', '/status/incidents', '/status/system',
  '/verify-hours', '/verify-transcript',
]

// Pages a signed-in student sees. Each must stay on its own URL — a bounce
// to /login means the session didn't hold.
const SIGNED_IN_PAGES = ['/', '/log', '/calendar', '/achievements', '/reports', '/reminders', '/opportunities', '/profile', '/settings']
const MONITOR = {
  email: process.env.MONITOR_EMAIL,
  password: process.env.MONITOR_PASSWORD,
  key: process.env.MONITOR_SECRET,
}

const results = []
async function check(name, fn) {
  try {
    const detail = await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out after 60s')), 60_000)),
    ])
    results.push({ name, ok: true, detail: detail || null })
  } catch (error) {
    results.push({ name, ok: false, detail: error.message })
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Render's free tier can take most of a minute to wake up; that is the
// keep-warm workflow's business, not a failed check.
async function getHealth() {
  let last
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${API}/status/health`, { signal: AbortSignal.timeout(30_000) })
      if (res.ok) return res.json()
      last = new Error(`health returned ${res.status}`)
    } catch (error) {
      last = error
    }
    await sleep(10_000)
  }
  throw last
}

// A page with listeners for the two ways a visitor's page quietly breaks:
// an uncaught script error, and something the Content-Security-Policy blocks.
async function openPage(browser, path, session) {
  const page = await browser.newPage()
  if (session) {
    // Signed in the way the app itself stores a session (src/hooks/useAuth.jsx).
    await page.evaluateOnNewDocument((token, user) => {
      try {
        localStorage.setItem('voluntrack:auth_token', token)
        localStorage.setItem('voluntrack:user::session', user)
      } catch { /* a cross-origin frame has no access; the app's page does */ }
    }, session.token, JSON.stringify(session.user))
  }
  // Every check is a first visit; a cached 304 would hide what visitors get.
  await page.setCacheEnabled(false)
  const problems = []
  page.on('pageerror', (error) => problems.push(`script error: ${error.message.split('\n')[0]}`))
  await page.evaluateOnNewDocument(() => {
    window.__cspViolations = []
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push(`${e.violatedDirective} blocked ${e.blockedURI || 'inline'}`)
    })
  })
  const response = await page.goto(`${SITE}${path}`, { waitUntil: 'networkidle2', timeout: 45_000 })
  if (!response || response.status() !== 200) throw new Error(`${path} returned ${response?.status() ?? 'nothing'}`)
  return { page, problems }
}

async function pageProblems(page, problems) {
  const csp = await page.evaluate(() => window.__cspViolations || [])
  const summary = csp.length === 0 ? []
    : csp.length === 1 ? [`security policy ${csp[0]}`]
    : [`security policy blocked ${csp.length} items, e.g. ${csp[0]}`]
  return [...problems, ...summary]
}

const health = await getHealth().catch((error) => ({ error }))

await check('Backend health', async () => {
  if (health.error) throw new Error(`unreachable: ${health.error.message}`)
  if (!health.ok) throw new Error('health check says not ok')
  if (health.checks?.database?.ok === false) throw new Error('database check failed')
  return 'backend and database ok'
})

await check('Email provider', async () => {
  if (health.error) throw new Error('backend unreachable')
  const email = health.checks?.email
  if (!email?.configured) throw new Error('no email provider configured')
  if (email.ok === false) throw new Error('last email connection check failed')
  return 'configured and connecting'
})

await check('Security headers', async () => {
  const res = await fetch(`${SITE}/`, { signal: AbortSignal.timeout(30_000) })
  const missing = ['content-security-policy', 'x-frame-options', 'x-content-type-options'].filter((h) => !res.headers.get(h))
  if (missing.length) throw new Error(`missing ${missing.join(', ')}`)
  return 'CSP, X-Frame-Options and nosniff present'
})

// Each answers without a server error: 400 for an empty request is the
// healthy answer, 404 means the route is gone and 5xx means it broke.
await check('API routes respond', async () => {
  const calls = [
    ['POST', '/auth/login'],
    ['POST', '/auth/register/send-code'],
    ['GET', '/status/incidents'],
  ]
  const bad = []
  for (const [method, path] of calls) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: method === 'POST' ? { 'content-type': 'application/json' } : {},
      body: method === 'POST' ? '{}' : undefined,
      signal: AbortSignal.timeout(30_000),
    }).catch((error) => ({ status: error.message }))
    if (res.status === 404 || !(Number(res.status) < 500)) bad.push(`${method} ${path} → ${res.status}`)
  }
  if (bad.length) throw new Error(bad.join('; '))
  return `${calls.length} routes ok`
})

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
try {
  for (const path of PAGES) {
    await check(`Page ${path}`, async () => {
      const { page, problems } = await openPage(browser, path)
      try {
        const textLength = await page.evaluate(() => document.body.innerText.trim().length)
        // A blank app shell is just the "VolunTrack" brand (10 characters);
        // the shortest real page, /verify-hours with no token, is about 40.
        if (textLength < 25) throw new Error('page rendered almost nothing')
        const found = await pageProblems(page, problems)
        if (found.length) throw new Error(found.slice(0, 3).join('; '))
        return 'loads cleanly'
      } finally {
        await page.close()
      }
    })
  }

  await check('Sign-in CAPTCHA', async () => {
    const { page, problems } = await openPage(browser, '/login')
    try {
      await page.waitForSelector('[name="cf-turnstile-response"]', { timeout: 20_000 })
        .catch(() => { throw new Error('the Cloudflare CAPTCHA never appeared') })
      const loaded = await page.evaluate(() => performance.getEntriesByType('resource')
        .some((e) => new URL(e.name).host === 'challenges.cloudflare.com'))
      if (!loaded) throw new Error('the CAPTCHA script did not load from challenges.cloudflare.com')
      const found = await pageProblems(page, problems)
      if (found.length) throw new Error(found.slice(0, 3).join('; '))
      return 'Turnstile loaded'
    } finally {
      await page.close()
    }
  })

  // The map and the Google Form sit behind sign-in, so load what they load
  // from a public page under the same security policy.
  await check('Map & Google Form allowed', async () => {
    const { page, problems } = await openPage(browser, '/login')
    try {
      const probe = await page.evaluate(async () => {
        const img = (src) => new Promise((resolve) => {
          const i = new Image()
          i.onload = () => resolve(true)
          i.onerror = () => resolve(false)
          i.src = src
        })
        const tile = await img('https://a.tile.openstreetmap.org/3/4/2.png')
        const pin = await img('https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png')
        await fetch('https://nominatim.openstreetmap.org/status', { mode: 'no-cors' }).catch(() => {})
        const frame = document.createElement('iframe')
        frame.style.cssText = 'width:1px;height:1px;position:fixed;opacity:0'
        frame.src = 'https://docs.google.com/forms/d/e/1FAIpQLSf_live_check/viewform?embedded=true'
        document.body.appendChild(frame)
        await new Promise((r) => setTimeout(r, 2500))
        frame.remove()
        return { tile, pin }
      })
      const found = await pageProblems(page, problems)
      if (found.length) throw new Error(found.slice(0, 3).join('; '))
      const failed = [!probe.tile && 'map tile', !probe.pin && 'map pin'].filter(Boolean)
      if (failed.length) throw new Error(`${failed.join(' and ')} did not load`)
      return 'tiles, pins, place search and form frame allowed'
    } finally {
      await page.close()
    }
  })

  if (MONITOR.email && MONITOR.password && MONITOR.key) {
    let session = null
    await check('Robot sign-in', async () => {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-monitor-key': MONITOR.key },
        body: JSON.stringify({ email: MONITOR.email, password: MONITOR.password }),
        signal: AbortSignal.timeout(30_000),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(`sign-in returned ${res.status}: ${body.error || 'no message'}`)
      if (!body.token) throw new Error(body.requiresTotp ? 'the monitor account is asking for two-factor' : 'no session came back')
      session = { token: body.token, user: body.user }
      return 'signed in'
    })

    for (const path of SIGNED_IN_PAGES) {
      await check(`Signed in ${path}`, async () => {
        if (!session) throw new Error('skipped: the robot could not sign in')
        const { page, problems } = await openPage(browser, path, session)
        try {
          await sleep(1500)
          const landed = new URL(page.url()).pathname
          if (landed !== path) throw new Error(`sent to ${landed} instead — the session didn't hold`)
          const textLength = await page.evaluate(() => document.body.innerText.trim().length)
          if (textLength < 25) throw new Error('page rendered almost nothing')
          const found = await pageProblems(page, problems)
          if (found.length) throw new Error(found.slice(0, 3).join('; '))
          return 'loads cleanly'
        } finally {
          await page.close()
        }
      })
    }

    // The real flow on Log Hours: search a place, pick it, see the map draw.
    await check('Log Hours place search & map', async () => {
      if (!session) throw new Error('skipped: the robot could not sign in')
      const { page, problems } = await openPage(browser, '/log', session)
      try {
        const input = await page.waitForSelector('input[name="voluntrack-location-search"]', { timeout: 15_000 })
          .catch(() => { throw new Error('the location search box never appeared') })
        await input.type('Austin Central Library', { delay: 40 })
        const suggestion = await page.waitForSelector('ul[class*="z-[1000]"] li button', { timeout: 20_000 })
          .catch(() => { throw new Error('place search returned no suggestions') })
        await suggestion.click()
        await page.waitForSelector('.leaflet-tile-loaded', { timeout: 20_000 })
          .catch(() => { throw new Error('a place was picked but the map tiles never loaded') })
        const found = await pageProblems(page, problems)
        if (found.length) throw new Error(found.slice(0, 3).join('; '))
        return 'search found the place and the map drew'
      } finally {
        await page.close()
      }
    })
  } else {
    console.log('Signed-in checks skipped: MONITOR_EMAIL / MONITOR_PASSWORD / MONITOR_SECRET not set.')
  }
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
console.log(`\n${results.length - failed.length}/${results.length} passed`)

// Only for a failing run, and only with a key: a few sentences an owner who
// isn't a developer can act on. Never fatal — the checks are the report.
async function aiSummary() {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key || failed.length === 0) return null
  const recentChanges = (() => {
    try {
      return execSync('git log -8 --format="%h %ad %s" --date=short', { encoding: 'utf8' }).trim()
    } catch {
      return '(not available)'
    }
  })()
  const prompt = [
    'You are summarising an automated test run of VolunTrack, a volunteer-hour tracking web app, for its owner, who is not a developer.',
    'Setup: React/Vite frontend on Vercel with a Content-Security-Policy in vercel.json; Express backend on Render; Neon Postgres; Cloudflare Turnstile CAPTCHA on sign-in and sign-up; Leaflet + OpenStreetMap map with HERE/Nominatim place search on Log Hours; email via Brevo or Gmail SMTP.',
    '',
    'Failed checks:',
    ...failed.map((r) => `- ${r.name}: ${r.detail}`),
    '',
    `Passed checks: ${results.filter((r) => r.ok).map((r) => r.name).join(', ')}`,
    '',
    'Recent changes (newest first):',
    recentChanges,
    '',
    'In 2-4 short plain-English sentences, no markdown: say what is broken for users, the most likely cause, and the first thing to check. If several checks fail together, say whether they look like one problem. If you are unsure, say so rather than guessing.',
  ].join('\n')
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.LIVE_CHECK_MODEL || 'claude-haiku-5-5',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(60_000),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`${res.status} ${body.error?.message || ''}`)
    return (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim() || null
  } catch (error) {
    console.error(`AI summary skipped: ${error.message}`)
    return null
  }
}

const summary = await aiSummary()
if (summary) console.log(`\nAI summary:\n${summary}`)

if (!process.env.CRON_SECRET) process.exit(failed.length ? 1 : 0)

// Reporting mode: the backend decides whom to tell, so a delivered report is
// a successful run even when checks failed — a red Actions run would only
// set off the CI-failure routines on top of the admin email.
const runUrl = process.env.GITHUB_RUN_ID
  ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : undefined
let delivered = false
for (let attempt = 0; attempt < 3 && !delivered; attempt++) {
  try {
    const res = await fetch(`${API}/status/live-checks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cron-key': process.env.CRON_SECRET },
      body: JSON.stringify({ results, runUrl, summary }),
      signal: AbortSignal.timeout(30_000),
    })
    const body = await res.json().catch(() => ({}))
    if (res.ok) {
      delivered = true
      console.log(`Reported. Alerted: ${body.alerted?.join(', ') || 'none'}. Fixed: ${body.fixed?.join(', ') || 'none'}.`)
    } else {
      console.error(`Report rejected: ${res.status} ${body.error || ''}`)
      if (res.status === 400 || res.status === 401) break
    }
  } catch (error) {
    console.error(`Report failed: ${error.message}`)
  }
  if (!delivered) await sleep(15_000)
}
process.exit(delivered ? 0 : 1)
