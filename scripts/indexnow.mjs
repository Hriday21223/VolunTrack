#!/usr/bin/env node
// Tells IndexNow search engines (Bing, Yandex, Naver, Seznam; not Google,
// which reads the sitemap) which sitemap pages changed in this deploy, so
// they re-crawl them now instead of whenever they next read sitemap.xml.
// Run by .github/workflows/deploy-vercel.yml after a production deploy.
//
//   node scripts/indexnow.mjs <built sitemap.xml> [<previous commit>]
//
// A page counts as changed when one of its `src` files (scripts/seo-pages.mjs)
// changed between the previous commit and HEAD. With no usable previous commit
// (a manual run, a force-push) every sitemap page is sent. Never fails the
// deploy: a problem is printed as a GitHub warning and the exit code is 0.
import { readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { INDEXNOW_KEY, SITEMAP_ENTRIES } from './seo-pages.mjs'

const ENDPOINT = 'https://api.indexnow.org/indexnow'
const warn = (msg) => { console.log(`::warning::IndexNow: ${msg}`); process.exit(0) }

const [sitemapPath, before] = process.argv.slice(2)
let sitemap
try { sitemap = readFileSync(sitemapPath, 'utf8') } catch { warn(`no sitemap at ${sitemapPath}`) }
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
if (!urls.length) warn('the sitemap lists no pages')
const origin = new URL(urls[0]).origin
if (!origin.startsWith('https://')) warn(`not sending for ${origin} (not a live https site)`)

/** Files changed since `before`, or null when that can't be told. */
function changedFiles() {
  if (!before || /^0+$/.test(before)) return null
  try {
    return execFileSync('git', ['diff', '--name-only', before, 'HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch {
    return null
  }
}

const changed = changedFiles()
const pick = changed
  ? SITEMAP_ENTRIES.filter((e) => e.src?.some((f) => changed.includes(f))).map((e) => `${origin}${e.path}`)
  : urls
if (!pick.length) {
  console.log('IndexNow: no sitemap page changed in this deploy; nothing to send.')
  process.exit(0)
}

// INDEXNOW_DRY_RUN=1 prints what would be sent, without sending.
if (process.env.INDEXNOW_DRY_RUN === '1') {
  console.log(`IndexNow (dry run): would send ${pick.length} page(s):\n${pick.join('\n')}`)
  process.exit(0)
}

const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(origin).host, key: INDEXNOW_KEY, keyLocation: `${origin}/${INDEXNOW_KEY}.txt`, urlList: pick }),
  signal: AbortSignal.timeout(30_000),
}).catch((e) => warn(`request failed: ${e.message}`))
// 200 = received, 202 = received and the key is still being checked.
if (res.status !== 200 && res.status !== 202) warn(`answered HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`)
console.log(`IndexNow: sent ${pick.length} page(s) (HTTP ${res.status}):\n${pick.join('\n')}`)
