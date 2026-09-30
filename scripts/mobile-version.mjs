// Stamp package.json's version into the native projects, so what the stores
// show matches the release it was cut from:
//
//   Android  versionName / versionCode    (android/app/build.gradle)
//   iOS      MARKETING_VERSION / CURRENT_PROJECT_VERSION (project.pbxproj)
//
// Both stores reject an upload whose build number isn't higher than the last
// one, so the build number is derived from the version — 0.3.0 → 300,
// 1.2.10 → 10210 — and grows with every release as long as minor and patch
// stay below 100. To re-upload the same version (say, after a rejected
// build), pass a higher build number explicitly:
//
//   node scripts/mobile-version.mjs          # from package.json
//   node scripts/mobile-version.mjs 301      # same version, build 301
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
if (!match) {
  console.error(`package.json version "${version}" is not plain major.minor.patch`)
  process.exit(1)
}
const [major, minor, patch] = match.slice(1).map(Number)
if (minor > 99 || patch > 99) {
  console.error(`minor/patch above 99 would break build-number ordering; pass a build number explicitly`)
  process.exit(1)
}
const derived = major * 10000 + minor * 100 + patch
const build = process.argv[2] ? Number(process.argv[2]) : derived
if (!Number.isInteger(build) || build < 1) {
  console.error(`build number must be a positive integer, got "${process.argv[2]}"`)
  process.exit(1)
}

function rewrite(file, replacements) {
  const full = path.join(root, file)
  let text = readFileSync(full, 'utf8')
  for (const [pattern, value] of replacements) {
    if (!pattern.test(text)) {
      console.error(`${file}: no match for ${pattern}`)
      process.exit(1)
    }
    text = text.replace(pattern, value)
  }
  writeFileSync(full, text)
}

rewrite('android/app/build.gradle', [
  [/versionCode \d+/, `versionCode ${build}`],
  [/versionName "[^"]*"/, `versionName "${version}"`],
])
rewrite('ios/App/App.xcodeproj/project.pbxproj', [
  [/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`],
  [/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`],
])

console.log(`Native apps set to ${version} (build ${build})`)
