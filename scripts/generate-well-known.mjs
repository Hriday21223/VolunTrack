// Writes the website files that let the iOS and Android apps use passkeys
// for the site's domain (see server/passkeys.js):
//
//   public/.well-known/apple-app-site-association  — needs APPLE_TEAM_ID
//   public/.well-known/assetlinks.json             — needs ANDROID_CERT_SHA256
//
// Both are generated, not committed (public/.well-known is gitignored), and a
// file is simply not written while its env var is unset — the site then 404s
// it and the app's passkey calls fail, rather than the site vouching for an
// app it can't identify.
//
// ANDROID_CERT_SHA256 is a comma-separated list of "AB:CD:…" SHA-256
// fingerprints: the upload key, Play App Signing's key (Play Console →
// App integrity), and the debug key if you test debug builds. The backend
// needs the same list, since Android reports it as the passkey's origin.

import fs from 'node:fs'
import path from 'node:path'

const APP_ID = 'com.voluntrack.voluntrack'
const dir = path.resolve('public/.well-known')

const teamId = (process.env.APPLE_TEAM_ID || '').trim()
const fingerprints = (process.env.ANDROID_CERT_SHA256 || '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s))

fs.rmSync(dir, { recursive: true, force: true })

if (teamId || fingerprints.length) fs.mkdirSync(dir, { recursive: true })

if (teamId) {
  fs.writeFileSync(
    path.join(dir, 'apple-app-site-association'),
    `${JSON.stringify({ webcredentials: { apps: [`${teamId}.${APP_ID}`] } }, null, 2)}\n`,
  )
  console.log(`well-known: apple-app-site-association for ${teamId}.${APP_ID}`)
} else {
  console.log('well-known: APPLE_TEAM_ID unset — no apple-app-site-association (iOS passkeys off)')
}

if (fingerprints.length) {
  const statement = [{
    relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
    target: { namespace: 'android_app', package_name: APP_ID, sha256_cert_fingerprints: fingerprints },
  }]
  fs.writeFileSync(path.join(dir, 'assetlinks.json'), `${JSON.stringify(statement, null, 2)}\n`)
  console.log(`well-known: assetlinks.json for ${fingerprints.length} signing key(s)`)
} else {
  console.log('well-known: ANDROID_CERT_SHA256 unset — no assetlinks.json (Android passkeys off)')
}
