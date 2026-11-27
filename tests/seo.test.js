import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DISALLOWED_PATHS, SITEMAP_ENTRIES, robotsRuleBlocks } from '../scripts/seo-pages.mjs'
import { GUIDES } from '../src/lib/guides.js'

test('robots rules match like Google: prefix, * and $', () => {
  assert.equal(robotsRuleBlocks('/log', '/login'), true) // the Nov 27 bug
  assert.equal(robotsRuleBlocks('/log$', '/login'), false)
  assert.equal(robotsRuleBlocks('/log$', '/log'), true)
  assert.equal(robotsRuleBlocks('/log?', '/log?shift=1'), true)
  assert.equal(robotsRuleBlocks('/log?', '/login'), false)
  assert.equal(robotsRuleBlocks('/*.pdf$', '/a/b.pdf'), true)
})

test('no page in the sitemap is blocked by robots.txt', () => {
  for (const { path } of SITEMAP_ENTRIES) {
    const rule = DISALLOWED_PATHS.find((r) => robotsRuleBlocks(r, path))
    assert.equal(rule, undefined, `${path} is in the sitemap but robots.txt rule "${rule}" blocks it`)
  }
})

test('the pages robots.txt is meant to hide are still hidden', () => {
  for (const path of ['/log', '/log?task=1', '/reports', '/settings', '/admin', '/admin-invite', '/join/abc', '/api/status/ping', '/sync-login']) {
    assert.ok(DISALLOWED_PATHS.some((r) => robotsRuleBlocks(r, path)), `${path} should be blocked`)
  }
})

test('every sitemap page is prerendered', () => {
  // prerender.mjs starts a browser on import, so read its route list as text.
  const src = readFileSync(new URL('../scripts/prerender.mjs', import.meta.url), 'utf8')
  const routes = src.slice(src.indexOf('const ROUTES = ['), src.indexOf(']', src.indexOf('...GUIDES.map')))
  for (const { path } of SITEMAP_ENTRIES) {
    if (GUIDES.some((g) => path === `/guides/${g.slug}`)) continue // ...GUIDES.map in ROUTES
    assert.ok(routes.includes(`'${path}'`), `${path} is in the sitemap but not in prerender.mjs ROUTES`)
  }
})

test('every sitemap page names source files that exist', () => {
  for (const { path, src } of SITEMAP_ENTRIES) {
    assert.ok(src?.length, `${path} has no src for its <lastmod>`)
    for (const f of src) readFileSync(new URL(`../${f}`, import.meta.url))
  }
})
