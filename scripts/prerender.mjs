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
import { readFile, writeFile, mkdir, realpath, stat } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, extname, join, resolve, sep } from 'path'
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

// Resolves a request path to a real file confined to DIST_DIR, resolving
// symlinks and rejecting anything that escapes it (e.g. "../"). Returns null
// for anything outside DIST_DIR, a directory, or a path that doesn't exist,
// so callers fall back to the SPA's index.html rather than ever passing
// tainted input to readFile.
async function resolveWithinDist(urlPath) {
  let target
  try {
    target = await realpath(resolve(DIST_DIR, `.${urlPath}`))
  } catch {
    return null
  }
  if (target !== DIST_DIR && !target.startsWith(DIST_DIR + sep)) return null
  const info = await stat(target).catch(() => null)
  if (!info?.isFile()) return null
  return target
}

// Minimal static server with SPA fallback, mirroring vercel.json's
// catch-all rewrite to index.html so client-side routing works when
// Puppeteer navigates straight to e.g. /about. Only ever reached by our own
// Puppeteer instance on 127.0.0.1, but confine resolved paths to DIST_DIR
// regardless, since req.url is attacker-controllable input in general.
function startServer() {
  return new Promise((resolvePromise) => {
    const server = createServer(async (req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0])
      const filePath = (await resolveWithinDist(urlPath)) ?? join(DIST_DIR, 'index.html')
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
  let browser
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })
  } catch (err) {
    // Vercel's and Cloudflare's build images are missing shared libraries
    // Puppeteer's Chrome needs (e.g. libnspr4.so), so launch() throws there.
    // Leaving `server` open past this point hangs the whole build
    // indefinitely — its listening socket keeps the event loop alive with
    // nothing left to close it — until the platform's build-time ceiling
    // kills the deployment. Close it and degrade to a plain
    // (non-prerendered) SPA build on those platforms; keep failing hard
    // everywhere else (Netlify/local/CI), where Chrome does launch and
    // prerendering is expected to work.
    server.close()
    // VERCEL: Vercel. CF_PAGES: classic Cloudflare Pages. WORKERS_CI: Cloudflare
    // Workers Builds (the CI/CD path for the Workers Static Assets deploy target).
    if (process.env.VERCEL || process.env.CF_PAGES || process.env.WORKERS_CI) {
      console.warn(`[prerender] skipped (no usable Chromium): ${err.message}`)
      return
    }
    throw err
  }

  try {
    for (const route of ROUTES) {
      const url = `http://127.0.0.1:${port}${route}`
      // 'networkidle0' has intermittently hung past its 30s default on slower
      // build machines (Netlify), likely due to the PWA's own service-worker
      // registration/analytics keeping a connection open past the idle
      // window. 'domcontentloaded' is faster and avoids that hang; one retry
      // absorbs any remaining transient navigation timeout. The h1 wait is
      // still best-effort only — not every route (e.g. /help) has one.
      let html
      for (let attempt = 1; ; attempt++) {
        const page = await browser.newPage()
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
          await page.waitForSelector('h1', { timeout: 8000 }).catch(() => {})
          html = await page.content()
          break
        } catch (err) {
          if (attempt >= 2) throw err
          console.warn(`[prerender] ${route} attempt ${attempt} failed (${err.message}), retrying`)
        } finally {
          await page.close()
        }
      }

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
