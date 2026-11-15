// Creates test accounts on the LIVE site, so each kind of account can be tried
// there (#888). Run it yourself: it asks for the live database address and a
// password at hidden prompts, so neither is ever typed into a file, a shell
// history or a chat.
//
//   npm run seed:live-test-accounts
//
// What it makes (all @test.com, so they're never emailed and are left out of
// the admin's sign-up counts):
//   live-student@test.com      student at "Live Test School" (a free club)
//   live-volunteer@test.com    Volunteer Task Maker
//   live-parent@test.com       parent, linked to the student
//   live-school@test.com       the club's adviser
//   live-organization@test.com organization
// No admin: an admin account with a password typed into a script is too
// strong a key to leave lying around. Admin is granted through ADMIN_EMAIL.
//
// Safe to re-run: it resets these five accounts' password and links and
// touches nothing else. The local test accounts (seed-test-accounts.mjs) stay
// local; this one refuses a database on this machine instead.
import readline from 'node:readline'
import { stdin, stdout } from 'node:process'

// One readline for every question (a second one would miss input that
// arrived early). Hidden answers aren't echoed.
const rl = readline.createInterface({ input: stdin, output: stdout, terminal: Boolean(stdin.isTTY) })
let muted = false
rl._writeToOutput = (s) => { if (!muted) rl.output.write(s) }
const lines = []
let waiting = null
rl.on('line', (line) => { if (waiting) { const w = waiting; waiting = null; w(line) } else lines.push(line) })
function ask(question, { hidden = false } = {}) {
  stdout.write(question)
  muted = hidden
  return new Promise((resolve) => {
    const done = (answer) => { muted = false; if (hidden) stdout.write('\n'); resolve(String(answer).trim()) }
    if (lines.length) done(lines.shift()); else waiting = done
  })
}

const url = process.env.LIVE_DATABASE_URL || await ask('Live database address (hidden): ', { hidden: true })
if (!url) { console.error('No database address. Nothing done.'); process.exit(1) }
process.env.DATABASE_URL = url

const { isLocalDatabaseUrl } = await import('../server/localDb.js')
if (isLocalDatabaseUrl(url)) {
  console.error('That is a database on this machine. For local test accounts use: npm run seed:test-accounts')
  process.exit(1)
}

const { isWeakPassword } = await import('../server/validate.js')
const password = await ask('Password for the five test accounts (hidden, 12+ characters): ', { hidden: true })
const again = await ask('Type it again (hidden): ', { hidden: true })
if (password !== again) { console.error('The two passwords are different. Nothing done.'); process.exit(1) }
if (password.length < 12 || isWeakPassword(password)) {
  console.error('Pick a longer, less common password (12+ characters). Nothing done.')
  process.exit(1)
}

const host = new URL(url).hostname
const ok = await ask(`Create or reset the five live test accounts on ${host}? Type yes: `)
if (ok.toLowerCase() !== 'yes') { console.error('Nothing done.'); process.exit(1) }

rl.close()
const { initSchema, getPool } = await import('../server/db.js')
const { ensureLiveTestAccounts, LIVE_TEST_ACCOUNTS: ACCOUNTS } = await import('../server/liveTestAccounts.js')

await initSchema()
await ensureLiveTestAccounts({ password })

console.log(`Done on ${host}. The five live test accounts (password: the one you just typed):`)
for (const a of ACCOUNTS) console.log(`  ${a.role.padEnd(10)} ${a.email}`)
console.log('School code for joining: livetest-2026')
await getPool().end()
