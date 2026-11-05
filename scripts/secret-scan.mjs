// Secret check (#723): fails when a real password or key is in a tracked
// file, so one can't reach the public repo again (an old database password
// did in 2026-07). Runs in CI and with `npm run secret-scan`. Placeholders
// like `npg_...`, `<password>` or `xxxx` don't count. Prints the file and
// line, never the value.
import { execFileSync } from 'child_process'
import fs from 'fs'

const RULES = [
  ['Neon database password', /npg_[A-Za-z0-9]{12,}/],
  ['Database URL with a password', /postgres(?:ql)?:\/\/[A-Za-z0-9_.-]+:(?!(?:password|pass|pw|PASSWORD|<[^>]*>|\$\{?[A-Z_]+\}?)@)[^\s@/'"`]{8,}@/],
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['Brevo API key', /xkeysib-[a-f0-9]{32,}/],
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['GitHub token', /(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,})/],
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['Stripe live key', /(?:sk|rk)_live_[0-9a-zA-Z]{20,}/],
  ['Webhook secret', /whsec_[A-Za-z0-9+/=_-]{30,}/],
  ['VolunTrack live API key', /vt_live_[a-z0-9]{8}_[A-Za-z0-9_-]{40,}/],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s*\n?\s*[A-Za-z0-9+/]{40,}/],
]
const SKIP = /(^|\/)(package-lock\.json|node_modules\/|dist\/|.*\.(png|jpe?g|webp|gif|ico|pdf|aab|apk|jks|p12|woff2?|ttf|traineddata|wasm|gz|zip))$/i

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter((f) => f && !SKIP.test(f))
const found = []
for (const file of files) {
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch { continue }
  if (text.includes('\u0000')) continue // binary
  for (const [name, re] of RULES) {
    const rx = new RegExp(re.source, 'g')
    let m
    while ((m = rx.exec(text))) found.push(`${file}:${text.slice(0, m.index).split('\n').length}  ${name}`)
  }
}
if (found.length) {
  console.error(`Possible secrets found (values not shown):\n${found.map((f) => `  ${f}`).join('\n')}\n\nRemove them, use an environment variable instead, and if one was ever pushed, change it with the provider.`)
  process.exit(1)
}
console.log(`Secret check passed: ${files.length} files.`)
