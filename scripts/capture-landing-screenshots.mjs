// Regenerates the dashboard screenshots in the landing-page gallery
// (public/screenshots/). Needs `npm run dev` running.
//
//   node scripts/capture-landing-screenshots.mjs [baseUrl] [--api http://localhost:10001] [--only name,name]
//
// --only retakes just the named shots (file names without the extension),
// e.g. --only student-opportunities, so one new screen doesn't redo them all.
//
// The student shots use a client-only demo account seeded straight into
// localStorage — no backend call at all. With --api, it also photographs the
// parent and volunteer dashboards against a backend
// filled by scripts/seed-landing-demo.mjs: the page's /api requests are
// forwarded there, so the dev server's own proxy (and the production
// database behind it) is never used. --api must be on localhost.
import puppeteer from 'puppeteer'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const apiFlag = args.indexOf('--api')
const api = apiFlag >= 0 ? String(args[apiFlag + 1] || '').replace(/\/$/, '') : null
const onlyFlag = args.indexOf('--only')
const only = onlyFlag >= 0 ? new Set(String(args[onlyFlag + 1] || '').split(',').filter(Boolean)) : null
const wanted = (name) => !only || only.has(name)
const base = args.find((a, i) => !a.startsWith('--') && i !== apiFlag + 1 && i !== onlyFlag + 1) || 'http://localhost:5173'
if (api && !['localhost', '127.0.0.1'].includes(new URL(api).hostname)) {
  console.error('--api must point at a local test backend, never production.')
  process.exit(1)
}
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'screenshots')

const today = new Date()
const day = (n) => {
  const d = new Date(today)
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

// [days ago, hours, activity, category, location, verification status]
const ENTRIES = [
  [0, 2, 'Food bank sorting', 'Community Service', 'Central Food Bank', 'approved'],
  [1, 1.5, 'Reading buddies', 'Education & Tutoring', 'Lincoln Elementary', 'approved'],
  [2, 3, 'Creek cleanup', 'Environmental', 'Riverside Park', 'pending'],
  [4, 2, 'Animal shelter walks', 'Animal Welfare', 'Happy Tails Shelter', 'approved'],
  [6, 1, 'Library homework help', 'Education & Tutoring', 'Public Library', 'approved'],
  [9, 4, 'Habitat build day', 'Community Service', 'Habitat for Humanity', 'approved'],
  [13, 2.5, 'Senior center visit', 'Health & Wellness', 'Oak Grove Senior Center', 'approved'],
  [18, 3, 'Tree planting', 'Environmental', 'City Arboretum', 'approved'],
  [24, 2, 'Youth soccer coaching', 'Sports & Coaching', 'YMCA', 'approved'],
  [31, 3, 'Coat drive', 'Community Service', 'Lincoln High NHS', 'approved'],
  [38, 2, 'Museum guide', 'Arts & Culture', 'Children’s Museum', 'approved'],
  [45, 4, 'Food bank sorting', 'Community Service', 'Central Food Bank', 'approved'],
]

const seed = {
  // schoolId hides the "Join a school" banner, which would otherwise top the shot.
  'voluntrack:user::session': { id: 'usr_demo', name: 'Maya Patel', email: 'maya@example.com', role: 'student', school: 'Lincoln High School', grade: '11', schoolId: 'sch_demo' },
  'voluntrack:logs': ENTRIES.map(([ago, hours, activity, category, location, verificationStatus], i) => ({
    id: `log_demo${i}`, createdAt: today.toISOString(), date: day(ago), hours, activity, category, location, verificationStatus,
  })),
  'voluntrack:goals': [{
    id: 'goal_demo', createdAt: day(60), title: 'NHS service hours', targetHours: 40,
    deadline: `${today.getFullYear() + (today.getMonth() >= 4 ? 1 : 0)}-05-01`, primary: true,
  }],
  'voluntrack:theme': 'dark',
  'voluntrack:tour-seen:student': true,
  'voluntrack:review-dismissed': true,
}

// The student screens a visitor can click through in the landing gallery.
// 'dashboard' keeps its original file name as the Student default.
const STUDENT_SCREENS = [
  { name: 'dashboard', path: '/' },
  { name: 'student-log', path: '/log' },
  { name: 'student-calendar', path: '/calendar' },
  { name: 'student-achievements', path: '/achievements' },
  { name: 'student-reports', path: '/reports' },
]
const STUDENT_SIZES = [
  { suffix: '', width: 1280, height: 800, scale: 1.5 },
  { suffix: '-phone', width: 390, height: 760, scale: 2 },
]

// Server-backed screens, photographed against the --api backend as the
// `session` role. `prepare` runs after load to open the view being shown. The
// school and organization dashboards are deliberately not captured: they are
// the paid product, and the landing page doesn't show it to competitors.
const clickButton = (label) => (page) => page.evaluate((l) => {
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim().endsWith(l))?.click()
}, label)
const ROLE_SHOTS = [
  // In the Student tab of the gallery, but server-backed: tasks come from the API.
  // `geo` is a few blocks from DEMO_LOCATION in seed-landing-demo.mjs, so the
  // tasks read as nearby (and none as "0m away").
  { name: 'student-opportunities', session: 'student', path: '/opportunities', geo: { latitude: 30.2745, longitude: -97.7369 } },
  { name: 'parent', session: 'parent', path: '/parent' },
  { name: 'volunteer', session: 'volunteer', path: '/my-tasks' },
  { name: 'volunteer-post', session: 'volunteer', path: '/my-tasks', prepare: clickButton('Post a task') },
  {
    name: 'volunteer-signups', session: 'volunteer', path: '/my-tasks',
    // Open the first task so its sign-ups (approved and waiting) show.
    prepare: (page) => page.evaluate(() => {
      const header = document.querySelector('main .cursor-pointer')
      header?.click()
      header?.closest('.card, [class*="rounded"]')?.scrollIntoView({ block: 'start' })
    }),
  },
]
// Written by seed-landing-demo.mjs — one signed-in session per role.
const SESSIONS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.cache', 'voluntrack-landing-demo.json')
// 1440 wide (not the student shot's 1280) so dashboard headers fit on one
// line; the output is still 1920×1200 like the others.
const SIZES = [
  { suffix: '', width: 1440, height: 900, scale: 4 / 3 },
  { suffix: '-phone', width: 390, height: 760, scale: 2 },
]

// Answers the page's /api calls from the test backend instead of the dev
// server's proxy.
async function forwardApi(page) {
  await page.setRequestInterception(true)
  page.on('request', async (req) => {
    const url = new URL(req.url())
    if (url.origin !== new URL(base).origin || !url.pathname.startsWith('/api/')) return req.continue()
    try {
      const headers = { ...req.headers() }
      delete headers.host
      delete headers.origin
      const res = await fetch(`${api}${url.pathname}${url.search}`, { method: req.method(), headers, body: req.postData() })
      req.respond({ status: res.status, contentType: res.headers.get('content-type') || 'application/json', body: Buffer.from(await res.arrayBuffer()) })
    } catch (error) {
      req.respond({ status: 502, body: String(error) })
    }
  })
}

const settle = () => new Promise((r) => setTimeout(r, 2500))
const browser = await puppeteer.launch({ headless: true })
try {
  for (const screen of STUDENT_SCREENS.filter((s) => wanted(s.name))) for (const { suffix, width, height, scale } of STUDENT_SIZES) {
    const file = `${screen.name}${suffix}.webp`
    const page = await browser.newPage()
    await page.setViewport({ width, height, deviceScaleFactor: scale })
    await page.goto(`${base}/about`, { waitUntil: 'networkidle0' })
    await page.evaluate((s) => {
      localStorage.clear()
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v))
    }, seed)
    await page.goto(`${base}/`, { waitUntil: 'networkidle0' })
    await settle()
    // The first load earns the demo's badges and pops a toast for each; a
    // reload finds them already earned, so the shot comes out clean.
    await page.reload({ waitUntil: 'networkidle0' })
    await settle()
    if (screen.path !== '/') {
      await page.goto(`${base}${screen.path}`, { waitUntil: 'networkidle0' })
      await settle()
    }
    await page.screenshot({ path: path.join(outDir, file), type: 'webp', quality: 82 })
    await page.close()
    console.log(`wrote public/screenshots/${file}`)
  }

  const sessions = api && fs.existsSync(SESSIONS_FILE) ? JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')) : null
  const roleShots = api ? ROLE_SHOTS.filter((r) => wanted(r.name)) : []
  for (const role of roleShots) {
    if (!sessions?.[role.session]) throw new Error(`No ${role.session} demo session in ${SESSIONS_FILE} — run scripts/seed-landing-demo.mjs first.`)
  }
  for (const role of roleShots) {
    const session = sessions[role.session]
    for (const size of SIZES) {
      const page = await browser.newPage()
      await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: size.scale })
      await forwardApi(page)
      if (role.geo) {
        await browser.defaultBrowserContext().overridePermissions(base, ['geolocation'])
        await page.setGeolocation({ ...role.geo, accuracy: 50 })
      }
      await page.goto(`${base}/about`, { waitUntil: 'networkidle0' })
      await page.evaluate((token, user) => {
        localStorage.clear()
        localStorage.setItem('voluntrack:auth_token', token)
        localStorage.setItem('voluntrack:user::session', JSON.stringify(user))
        for (const tour of ['student', 'school', 'org', 'parent', 'volunteer']) localStorage.setItem(`voluntrack:tour-seen:${tour}`, 'true')
        localStorage.setItem('voluntrack:review-dismissed', 'true')
      }, session.token, session.user)
      await page.goto(`${base}${role.path}`, { waitUntil: 'networkidle0' })
      await settle()
      // A student's first load earns badges from their logs and pops a toast
      // for each; a reload finds them already earned (as the student shots do).
      if (role.session === 'student') {
        await page.reload({ waitUntil: 'networkidle0' })
        await settle()
      }
      if (role.prepare) {
        await role.prepare(page)
        await settle()
      }
      const file = `${role.name}${size.suffix}.webp`
      await page.screenshot({ path: path.join(outDir, file), type: 'webp', quality: 82 })
      await page.close()
      console.log(`wrote public/screenshots/${file}`)
    }
  }
} finally {
  await browser.close()
}
