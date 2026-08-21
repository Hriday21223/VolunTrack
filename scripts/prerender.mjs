#!/usr/bin/env node
// Runs as "postbuild" (after `vite build`) to snapshot public marketing pages
// to static HTML. This is a client-rendered SPA — dist/index.html ships an
// empty `<div id="root">` — so crawlers that don't execute JS (several SEO
// tools, social-preview bots) see zero content, no headings, no links. This
// script serves the built dist/ locally, drives a headless Chromium to each
// public route (useSeo() has already set the right <title>/meta/canonical by
// the time we snapshot), and writes the fully-rendered DOM back to disk.
//
// Output paths use extensionless files (e.g. dist/about.html) rather than
// dist/about/index.html, matching vercel.json's `cleanUrls: true` and
// Netlify's default pretty-URL behavior — both serve `<path>.html` for a
// request to `<path>` before falling back to the SPA rewrite.
//
// Keep ROUTES in sync with SITEMAP_ENTRIES in generate-seo-files.mjs (plus
// /about, /terms, /privacy, which are crawlable but intentionally excluded
// from the sitemap — see comments there).
import { createServer } from 'http'
import { readFile, writeFile, mkdir, stat } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, extname, join, resolve } from 'path'
import puppeteer from 'puppeteer'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = resolve(__dirname, '../dist')

const ROUTES = [
  '/',
  '/about',
  '/login',
  '/register',
  '/school/register',
  '/organization/register',
  '/contact',
  '/help',
  '/status',
  '/terms',
  '/privacy',
]

const MIME_TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
}

async function fileExists(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

// Minimal static server with SPA fallback, mirroring vercel.json's
// catch-all rewrite to index.html so client-side routing works when
// Puppeteer navigates straight to e.g. /about.
function startServer() {
  return new Promise((resolvePromise) => {
    const server = createServer(async (req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0])
      let filePath = join(DIST_DIR, urlPath)
      if (!(await fileExists(filePath))) {
        filePath = join(DIST_DIR, 'index.html')
      }
      try {
        const body = await readFile(filePath)
        res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(filePath)] || 'application/octet-stream' })
        res.end(body)
      } catch {
        res.writeHead(404)
        res.end()
      }
    })
    server.listen(0, () => resolvePromise(server))
  })
}

function outputPathFor(route) {
  if (route === '/') return join(DIST_DIR, 'index.html')
  return join(DIST_DIR, `${route.replace(/^\//, '')}.html`)
}

async function main() {
  const server = await startServer()
  const port = server.address().port
  // --no-sandbox is required in CI containers (GitHub Actions, Docker, most
  // build environments) where Chromium's setuid sandbox can't get the
  // privileges it needs and otherwise crashes with "No usable sandbox!".
  // Safe here since this only renders our own trusted build output, not
  // untrusted/remote content.
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })

  try {
    for (const route of ROUTES) {
      const page = await browser.newPage()
      await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'networkidle0' })
      await page.waitForSelector('h1', { timeout: 8000 }).catch(() => {})
      const html = await page.content()
      await page.close()

      const outPath = outputPathFor(route)
      await mkdir(dirname(outPath), { recursive: true })
      await writeFile(outPath, html)
      console.log(`[prerender] ${route} -> ${outPath.replace(DIST_DIR, 'dist')}`)
    }
  } finally {
    await browser.close()
    server.close()
  }
}

main().catch((err) => {
  console.error('[prerender] failed:', err)
  process.exit(1)
})
