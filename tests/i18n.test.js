// Translations: every literal tr('…') string in the app must be in all ten
// translation files. "Left in English" is the most common fix in this repo's
// history, so CI catches it here instead (see CLAUDE.md, "More languages").
// Only literal strings are checked; tr(someVariable) can't be read statically.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SRC = join(ROOT, 'src')
const LANGS = ['es', 'vi', 'zh', 'hi', 'ar', 'pt', 'fr', 'bn', 'ru', 'ja']

// The same in every language, so they're deliberately left out of the files:
// names, units, and example values a person types.
const SAME_IN_EVERY_LANGUAGE = new Set([
  'VolunTrack', 'Apple / Outlook', 'Google Workspace', 'Microsoft Entra ID (Microsoft 365)',
  'KB', '5 km', '10 km', '25 km', '50 km', '100 km', 'km.',
  '.env', 'npm run backend', 'verify-transcript', 'Lincoln High School', 'cisd-12345',
])

function sourceFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'locales') out.push(...sourceFiles(p)) } else if (/\.(js|jsx)$/.test(name)) out.push(p)
  }
  return out
}

// tr('…') / tr("…") with a literal first argument, unescaped the way JS would.
const TR = /\btr\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g
function unescape(s) {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, '\n').replace(/\\(['"\\])/g, '$1')
}

const used = new Map() // string -> first file it appears in
for (const file of sourceFiles(SRC)) {
  for (const m of readFileSync(file, 'utf8').matchAll(TR)) {
    const key = unescape(m[1] ?? m[2])
    if (!used.has(key)) used.set(key, relative(ROOT, file))
  }
}

test('the app has tr() strings to check', () => {
  assert.ok(used.size > 1000, `found only ${used.size} tr() strings — is the scan broken?`)
})

for (const lang of LANGS) {
  test(`every tr() string is translated in ${lang}`, async () => {
    const dict = (await import(`../src/locales/${lang}.js`)).default
    const missing = [...used]
      .filter(([key]) => !SAME_IN_EVERY_LANGUAGE.has(key) && !(key in dict))
      .map(([key, file]) => `  ${JSON.stringify(key)}  (${file})`)
    assert.equal(missing.length, 0, `${missing.length} string(s) missing from src/locales/${lang}.js:\n${missing.slice(0, 25).join('\n')}`)
  })
}
