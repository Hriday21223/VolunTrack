// What search engines may index (sitemap.xml) and must skip (robots.txt).
// Used by generate-seo-files.mjs to write both files, and by
// tests/seo.test.js, which fails if a sitemap page is blocked by robots.txt
// (a bare '/log' once blocked /login) or isn't prerendered.
import { GUIDES } from '../src/lib/guides.js'

// Paths with no standalone SEO value and/or that carry sensitive tokens in
// their query string, plus every authenticated in-app route. Keep this in
// sync with the <Route> list in src/App.jsx.
export const DISALLOWED_PATHS = [
  // Public but token-bearing / pure utility flows.
  '/forgot-password',
  '/reset-password',
  '/reset-pin',
  '/sync-login',
  '/verify-hours',
  // One page per school's join link (#491): nothing for a search result.
  '/join/',
  // A student's personal invite link (#493).
  '/invite/',
  // A student's Year in review share link (#1005).
  '/y/',
  '/handover',
  '/admin-invite',
  '/s/',
  '/sign-certificate/',
  // Authenticated app pages, behind a login/admin guard.
  '/parent',
  // Robots rules match by prefix, so a bare '/log' also blocked /login
  // (Search Console: "Blocked by robots.txt"). '$' ends the match at /log,
  // '/log?' covers its links like /log?shift=…; Google and Bing read both.
  '/log$',
  '/log?',
  '/calendar',
  '/achievements',
  '/reminders',
  '/reports',
  '/profile',
  '/settings',
  '/my-tasks',
  '/admin',
  '/school/dashboard',
  '/organization/dashboard',
  // Backend API — not actually served on this domain in production
  // (VITE_API_URL points elsewhere), disallowed defensively anyway.
  '/api/',
]

// Public marketing / signup pages that should be indexed. `/about` is
// intentionally omitted — it canonicalizes to `/` (see About.jsx) to avoid
// duplicate content, so it's crawlable but not a separate sitemap entry.
export const SITEMAP_ENTRIES = [
  { path: '/', src: ['src/pages/About.jsx'], changefreq: 'weekly', priority: '1.0' },
  { path: '/register', src: ['src/pages/Register.jsx'], changefreq: 'monthly', priority: '0.8' },
  { path: '/register/student', src: ['src/pages/Register.jsx'], changefreq: 'monthly', priority: '0.7' },
  { path: '/register/parent', src: ['src/pages/Register.jsx'], changefreq: 'monthly', priority: '0.7' },
  { path: '/register/organizer', src: ['src/pages/Register.jsx'], changefreq: 'monthly', priority: '0.7' },
  { path: '/for-schools', src: ['src/pages/ForSchools.jsx'], changefreq: 'monthly', priority: '0.8' },
  { path: '/school/register', src: ['src/pages/SchoolRegister.jsx'], changefreq: 'monthly', priority: '0.7' },
  { path: '/organization/register', src: ['src/pages/OrganizationRegister.jsx'], changefreq: 'monthly', priority: '0.7' },
  { path: '/contact', src: ['src/pages/Contact.jsx'], changefreq: 'monthly', priority: '0.6' },
  { path: '/login', src: ['src/pages/Login.jsx'], changefreq: 'monthly', priority: '0.5' },
  { path: '/help', src: ['src/pages/Help.jsx'], changefreq: 'monthly', priority: '0.5' },
  { path: '/status', src: ['src/pages/Status.jsx'], changefreq: 'daily', priority: '0.3' },
  // Schools and districts reviewing an app look for these.
  { path: '/privacy', src: ['src/pages/Privacy.jsx'], changefreq: 'monthly', priority: '0.4' },
  { path: '/terms', src: ['src/pages/Terms.jsx'], changefreq: 'monthly', priority: '0.4' },
  // Guides (src/lib/guides.js) are what students and parents search for.
  { path: '/guides', src: ['src/pages/Guides.jsx', 'src/lib/guides.js'], changefreq: 'monthly', priority: '0.6' },
  ...GUIDES.map((g) => ({ path: `/guides/${g.slug}`, src: ['src/pages/Guides.jsx', 'src/lib/guides.js'], changefreq: 'monthly', priority: '0.7' })),
  // Open opportunities anyone can browse; signing up needs an account.
  { path: '/volunteer-opportunities', src: ['src/pages/PublicOpportunities.jsx'], changefreq: 'daily', priority: '0.8' },
  // The public API docs (#622), prerendered like the rest.
  { path: '/developers', src: ['src/pages/Developers.jsx'], changefreq: 'monthly', priority: '0.5' },
]


/**
 * Whether a robots.txt Disallow rule blocks `path`, the way Google and Bing
 * read it: a prefix match, '*' for any characters, and a trailing '$' to end
 * the match there.
 */
export function robotsRuleBlocks(rule, path) {
  const anchored = rule.endsWith('$')
  const body = (anchored ? rule.slice(0, -1) : rule)
    .split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path)
}

// IndexNow (Bing, Yandex, Naver, Seznam; not Google): after a production
// deploy, scripts/indexnow.mjs tells them which sitemap pages changed. The
// key isn't a secret; it's published at /<key>.txt (public/), which is how
// they know the ping comes from this site.
export const INDEXNOW_KEY = '6e892c295bb0e1f9be481965265596b4'
