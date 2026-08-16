// Dev-only helper: inserts a handful of sample approved reviews so the
// "What people are saying" testimonials section on /about has something to
// show while real reviews are still trickling in locally. Never run this
// against a production DATABASE_URL — see the guard below.
//
// Usage: node scripts/seed-reviews.mjs
import dotenv from 'dotenv'
import { hasDatabase, query, getPool } from '../server/db.js'
import { uid } from '../server/ids.js'

dotenv.config()

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed sample reviews with NODE_ENV=production.')
  process.exit(1)
}
if (!hasDatabase()) {
  console.error('DATABASE_URL is not set — nothing to seed.')
  process.exit(1)
}

// `role` uses real values (About.jsx's ROLE_LABELS) so these render exactly
// like a genuine review would. They're identified as seed data by the
// "rev-seed_" id prefix instead, which is invisible to site visitors but
// easy to find/wipe later: DELETE FROM reviews WHERE id LIKE 'rev-seed_%';
const SAMPLE_REVIEWS = [
  { rating: 5, name: 'Maya R.', role: 'student', comment: 'Logging hours after every shift takes about ten seconds now. The badge system actually got my little brother to keep volunteering too.' },
  { rating: 5, name: null, role: 'parent', comment: "I can finally see my daughter's volunteer hours without asking her every week. The PDF export saved us at college application time." },
  { rating: 4, name: 'Coach Daniels', role: 'volunteer', comment: 'Simple, no-nonsense hour tracking. Wish proof uploads supported multi-page PDFs, but otherwise does exactly what it says.' },
  { rating: 5, name: null, role: 'school', comment: 'Verifying student hours used to be a spreadsheet nightmare every semester. Now it is a queue we clear in twenty minutes.' },
]

const results = await Promise.all(
  SAMPLE_REVIEWS.map((r) =>
    query(
      'INSERT INTO reviews (id, rating, comment, name, email, role, approved) VALUES ($1, $2, $3, $4, NULL, $5, true) RETURNING id',
      [uid('rev-seed'), r.rating, r.comment, r.name, r.role],
    ),
  ),
)

console.log(`Seeded ${results.length} sample reviews (approved=true).`)
console.log('To remove them later: DELETE FROM reviews WHERE id LIKE \'rev-seed_%\';')

await getPool()?.end()
