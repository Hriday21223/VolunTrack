#!/usr/bin/env node
// Regenerates public/robots.txt and public/sitemap.xml with the real site
// domain baked in, so the deploy's `npm run build` (which runs this via the
// "prebuild" npm script) always ships correct static SEO files without
// hand-editing them whenever the deployed domain changes.
//
// Uses Vite's own env-loading (same precedence as `vite build` itself) so
// this stays in sync with vite.config.js. When VITE_SITE_URL is unset it
// writes nothing, leaving the committed files as they are — falling back to
// localhost here would dirty tracked files with URLs that must never ship.
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { GUIDES } from '../src/lib/guides.js'
import { dirname, resolve } from 'path'
import { loadEnv } from 'vite'
import { resolveSiteUrl } from './site-url.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = resolve(__dirname, '../public')

// This script only ever runs as `prebuild` immediately before `vite build`,
// which defaults to mode "production" — match that so it reads the same
// .env files vite build itself will use.
const env = loadEnv('production', resolve(__dirname, '..'), '')
if (!env.VITE_SITE_URL) {
  console.log('[generate-seo-files] VITE_SITE_URL is unset — keeping the committed public/robots.txt, public/sitemap.xml and public/llms.txt')
  process.exit(0)
}
const SITE_URL = resolveSiteUrl(env)

// Paths with no standalone SEO value and/or that carry sensitive tokens in
// their query string, plus every authenticated in-app route. Keep this in
// sync with the <Route> list in src/App.jsx.
const DISALLOWED_PATHS = [
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
  // Authenticated app pages, behind a login/admin guard.
  '/parent',
  '/log',
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
const SITEMAP_ENTRIES = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/register', changefreq: 'monthly', priority: '0.8' },
  { path: '/for-schools', changefreq: 'monthly', priority: '0.8' },
  { path: '/school/register', changefreq: 'monthly', priority: '0.7' },
  { path: '/organization/register', changefreq: 'monthly', priority: '0.7' },
  { path: '/contact', changefreq: 'monthly', priority: '0.6' },
  { path: '/login', changefreq: 'monthly', priority: '0.5' },
  { path: '/help', changefreq: 'monthly', priority: '0.5' },
  { path: '/status', changefreq: 'daily', priority: '0.3' },
  // Schools and districts reviewing an app look for these.
  { path: '/privacy', changefreq: 'monthly', priority: '0.4' },
  { path: '/terms', changefreq: 'monthly', priority: '0.4' },
  // Guides (src/lib/guides.js) are what students and parents search for.
  { path: '/guides', changefreq: 'monthly', priority: '0.6' },
  ...GUIDES.map((g) => ({ path: `/guides/${g.slug}`, changefreq: 'monthly', priority: '0.7' })),
]

// AI / LLM crawlers we explicitly welcome so the marketing pages can be read,
// summarised, and cited by answer engines. A named User-agent group is the
// most specific match for that bot, so each one has to repeat the Disallow
// list — otherwise the bot would ignore the `*` group's rules and reach the
// token-bearing / authenticated routes.
const AI_CRAWLERS = [
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot',        // OpenAI
  'ClaudeBot', 'Claude-Web', 'anthropic-ai',        // Anthropic
  'PerplexityBot', 'Perplexity-User',               // Perplexity
  'Google-Extended',                                // Gemini / Vertex
  'Applebot-Extended',                              // Apple Intelligence
  'CCBot',                                          // Common Crawl
  'Amazonbot', 'Bytespider', 'Meta-ExternalAgent', 'cohere-ai',
]

const disallowBlock = DISALLOWED_PATHS.map((p) => `Disallow: ${p}`).join('\n')

const robotsTxt = `User-agent: *
Allow: /
${disallowBlock}

${AI_CRAWLERS.map((ua) => `User-agent: ${ua}`).join('\n')}
Allow: /
${disallowBlock}

Sitemap: ${SITE_URL}/sitemap.xml
`

// llms.txt — an at-a-glance map of the site for LLMs, following the
// llmstxt.org convention: an H1, a one-line summary, then curated links.
const llmsTxt = `# VolunTrack

> VolunTrack is a free volunteer hour tracker for students, parents, volunteers, schools, and organizations. Log hours, set goals, earn badges, get supervisor verification by email, and export PDF/CSV reports and certificates for school and community-service requirements.

## Core pages

- [Home / overview](${SITE_URL}/): what VolunTrack is, features, pricing, and FAQ
- [Help & Handbooks](${SITE_URL}/help): role-by-role guides and a full FAQ for students, parents, volunteers, schools, school co-admins, organizations, and admins
- [Sign up](${SITE_URL}/register): create a free student, parent, or volunteer account
- [School sign up](${SITE_URL}/school/register): set up a school account with the one-time registration code VolunTrack provides (contact us for a quote), then manage students and review reports
- [Organization sign up](${SITE_URL}/organization/register): manage multiple schools under one organization
- [For schools](${SITE_URL}/for-schools): for NHS, Key Club and service-club advisers — approving hours, requirements, QR check-in, reports, and the starter kit (join link, QR flyer, ready-to-send messages)
- [Guides](${SITE_URL}/guides): practical articles on logging service hours
${GUIDES.map((g) => `- [${g.title}](${SITE_URL}/guides/${g.slug}): ${g.description}`).join('\n')}
- [Contact](${SITE_URL}/contact): support and feedback
- [System status](${SITE_URL}/status): live service status

## Key facts

- Free for individual students and volunteers; schools and organizations are on custom pricing
- Works with no account, entirely in the browser; an optional server account adds cross-device sync, school linking, and two-factor authentication
- Progressive Web App — installable and works offline after the first visit
- Supervisor verification uses a one-time email link; the supervisor needs no account
- Exports: PDF reports, CSV, and printable service certificates

## Policies

- [Privacy](${SITE_URL}/privacy)
- [Terms](${SITE_URL}/terms)
`

const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${SITEMAP_ENTRIES.map(({ path, changefreq, priority }) => `  <url>
    <loc>${SITE_URL}${path}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`).join('\n')}
</urlset>
`

writeFileSync(resolve(PUBLIC_DIR, 'robots.txt'), robotsTxt)
writeFileSync(resolve(PUBLIC_DIR, 'sitemap.xml'), sitemapXml)
writeFileSync(resolve(PUBLIC_DIR, 'llms.txt'), llmsTxt)

console.log(`[generate-seo-files] wrote public/robots.txt, public/sitemap.xml and public/llms.txt for ${SITE_URL}`)
