#!/usr/bin/env node
// Regenerates public/robots.txt and public/sitemap.xml with the real site
// domain baked in, so Netlify's `npm run build` (which runs this via the
// "prebuild" npm script) always ships correct static SEO files without
// hand-editing them whenever the deployed domain changes.
//
// Uses Vite's own env-loading (same precedence as `vite build` itself) so
// this stays in sync with vite.config.js. Falls back to a safe localhost URL
// when VITE_SITE_URL is unset — see scripts/site-url.mjs.
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { loadEnv } from 'vite'
import { resolveSiteUrl } from './site-url.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = resolve(__dirname, '../public')

// This script only ever runs as `prebuild` immediately before `vite build`,
// which defaults to mode "production" — match that so it reads the same
// .env files vite build itself will use.
const env = loadEnv('production', resolve(__dirname, '..'), '')
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
  { path: '/school/register', changefreq: 'monthly', priority: '0.7' },
  { path: '/contact', changefreq: 'monthly', priority: '0.6' },
  { path: '/login', changefreq: 'monthly', priority: '0.5' },
  { path: '/help', changefreq: 'monthly', priority: '0.5' },
  { path: '/status', changefreq: 'daily', priority: '0.3' },
]

const robotsTxt = `User-agent: *
Allow: /
${DISALLOWED_PATHS.map((p) => `Disallow: ${p}`).join('\n')}

Sitemap: ${SITE_URL}/sitemap.xml
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

console.log(`[generate-seo-files] wrote public/robots.txt and public/sitemap.xml for ${SITE_URL}`)
