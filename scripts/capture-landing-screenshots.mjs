// Regenerates the dashboard screenshots shown in the landing-page hero
// (public/screenshots/). Needs `npm run dev` running.
//
//   node scripts/capture-landing-screenshots.mjs [baseUrl]
//
// Uses a client-only demo account seeded straight into localStorage, so no
// real student's data is ever in the picture and no backend call is made.
import puppeteer from 'puppeteer'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const base = process.argv[2] || 'http://localhost:5173'
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

const SHOTS = [
  { file: 'dashboard.webp', width: 1280, height: 800, scale: 1.5 },
  { file: 'dashboard-phone.webp', width: 390, height: 760, scale: 2 },
]

const settle = () => new Promise((r) => setTimeout(r, 2500))
const browser = await puppeteer.launch({ headless: true })
try {
  for (const { file, width, height, scale } of SHOTS) {
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
    await page.screenshot({ path: path.join(outDir, file), type: 'webp', quality: 82 })
    await page.close()
    console.log(`wrote public/screenshots/${file}`)
  }
} finally {
  await browser.close()
}
