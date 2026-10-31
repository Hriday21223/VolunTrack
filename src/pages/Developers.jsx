import { Link } from 'react-router-dom'
import { KeyRound, Webhook, ShieldCheck, Gauge, FileJson, ListChecks } from 'lucide-react'
import Footer from '@/components/Footer.jsx'
import PublicHeader from '@/components/PublicHeader.jsx'
import { useSeo } from '@/hooks/useSeo.js'

// /developers (#622, part 4): the public API and webhooks, for the people who
// connect a school's or district's systems. Prerendered and in the sitemap.
// English only, like /for-schools; the code samples are the same in any language.

const API = (import.meta.env.VITE_PUBLIC_API_URL || 'https://voluntrack-backend-frrh.onrender.com').replace(/\/$/, '')

const ENDPOINTS = [
  ['GET', '/v1/me', '—', 'The key, its permissions and who it belongs to.'],
  ['GET', '/v1/schools', '—', 'The schools the key covers (school and organization keys).'],
  ['GET', '/v1/students', 'students:read', 'Students: id, name, email, grade, student ID, school, joined. Paged.'],
  ['GET', '/v1/students/:id', 'students:read', 'One student.'],
  ['GET', '/v1/hours', 'hours:read', 'Hours, newest first. from, to, status (unconfirmed, approved, rejected), studentId, createdSince. Paged.'],
  ['GET', '/v1/students/:id/hours', 'hours:read', "One student's hours."],
  ['GET', '/v1/progress', 'progress:read', 'Per student: hours, requirement target, hours remaining, met, award level.'],
  ['GET', '/v1/progress/summary', 'progress:read', 'Counts: students, with a requirement, met, behind.'],
  ['GET', '/v1/reports/impact', 'reports:read', 'Impact report numbers for period=year|all, or from and to. Organizations also get per-school totals.'],
  ['GET', '/v1/events', 'events:read', "An organizer's events with sign-up counts. Paged."],
  ['GET', '/v1/events/:id/signups', 'events:read', 'Sign-ups, volunteers as first name and last initial.'],
  ['GET', '/v1/events/:id/attendance', 'events:read', 'Approved volunteers and whether they came.'],
]

const EVENTS = [
  ['hours.created', 'Hours logged by a student, or added by an adviser or organizer.'],
  ['hours.approved', 'Hours confirmed by a supervisor, organizer or the school.'],
  ['hours.rejected', 'Hours rejected or sent back.'],
  ['student.joined', 'A student joined the school.'],
  ['student.left', 'A student left or moved to another school.'],
  ['requirement.met', "A student reached the school's hour requirement (once)."],
  ['event.signup', "Someone signed up for an organizer's event."],
  ['event.attendance', 'A volunteer was marked present or absent, or checked in or out.'],
]

const CURL = `curl ${API}/api/v1/hours?from=2026-08-01&status=approved \\
  -H "Authorization: Bearer vt_live_…"`

const PAGING = `let cursor = null
do {
  const url = new URL('${API}/api/v1/students')
  url.searchParams.set('limit', '500')
  if (cursor) url.searchParams.set('cursor', cursor)
  const res = await fetch(url, { headers: { Authorization: \`Bearer \${process.env.VOLUNTRACK_KEY}\` } })
  const { data, nextCursor } = await res.json()
  // …save data…
  cursor = nextCursor
} while (cursor)`

const VERIFY_NODE = `import crypto from 'node:crypto'

// rawBody: the request body exactly as received (a string or Buffer).
export function verifyVolunTrack(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')))
  const t = Number(parts.t)
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false // older than 5 minutes
  const expected = crypto.createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest('hex')
  const a = Buffer.from(expected), b = Buffer.from(parts.v1 || '')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}`

const VERIFY_PY = `import hashlib, hmac, time

def verify_voluntrack(raw_body: bytes, header: str, secret: str) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    t = int(parts.get("t", "0"))
    if abs(time.time() - t) > 300:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))`

const SHEETS = `function importApprovedHours() {
  const key = PropertiesService.getScriptProperties().getProperty('VOLUNTRACK_KEY')
  const res = UrlFetchApp.fetch('${API}/api/v1/hours?status=approved&limit=500', {
    headers: { Authorization: 'Bearer ' + key },
  })
  const rows = JSON.parse(res.getContentText()).data
    .map((h) => [h.date, h.studentId, h.activity, h.hours, h.place])
  const sheet = SpreadsheetApp.getActiveSheet()
  sheet.clear().appendRow(['Date', 'Student', 'Activity', 'Hours', 'Place'])
  if (rows.length) sheet.getRange(2, 1, rows.length, 5).setValues(rows)
}`

function Code({ children }) {
  return <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs leading-relaxed text-slate-100"><code>{children}</code></pre>
}

function Section({ icon: Icon, title, children, id }) {
  return (
    <section id={id} className="mt-10 scroll-mt-24">
      <h2 className="font-display text-xl font-semibold flex items-center gap-2"><Icon className="w-5 h-5 text-brand-600" /> {title}</h2>
      <div className="mt-3 space-y-3 text-sm text-earth-600 dark:text-earth-300 leading-relaxed">{children}</div>
    </section>
  )
}

export default function Developers() {
  useSeo({
    title: 'VolunTrack API and webhooks for schools and districts',
    description: 'Connect VolunTrack to your student information system, spreadsheets or dashboards: read-only API keys, students, hours, progress and impact reports, and signed webhooks.',
    path: '/developers',
  })
  return (
    <div className="min-h-screen bg-white text-earth-900 dark:bg-[#0b1410] dark:text-earth-100">
      <PublicHeader />
      <main className="mx-auto max-w-4xl px-4 py-12">
        <p className="text-sm font-medium text-brand-600">For developers</p>
        <h1 className="font-display text-3xl sm:text-4xl font-bold mt-1">The VolunTrack API</h1>
        <p className="mt-4 text-earth-600 dark:text-earth-300 max-w-2xl">
          Schools, districts and event organizers can connect VolunTrack to the systems they already use: a student information system,
          a spreadsheet, a dashboard or a tool like Zapier. The API is read-only, and webhooks tell your system the moment something happens.
        </p>
        <nav className="mt-6 flex flex-wrap gap-2 text-sm">
          {[['#keys', 'API keys'], ['#endpoints', 'Endpoints'], ['#paging', 'Paging and limits'], ['#webhooks', 'Webhooks'], ['#privacy', 'Privacy'], ['#examples', 'Examples']].map(([h, t]) => (
            <a key={h} href={h} className="chip hover:ring-1 hover:ring-brand-400">{t}</a>
          ))}
        </nav>

        <Section id="keys" icon={KeyRound} title="API keys">
          <p>A school&apos;s main admin, an organization, or a Volunteer Task Maker makes keys in VolunTrack under <strong>Settings → API keys</strong>. Name the key, tick what it may read, and copy it: it is shown once. Revoke it there at any time; it stops working at once.</p>
          <p>Send the key on every request as <code>Authorization: Bearer vt_live_…</code>. A <strong>test key</strong> (<code>vt_test_…</code>) answers every endpoint with sample data, so you can build before touching real students.</p>
          <p>Permissions: <code>students:read</code>, <code>hours:read</code>, <code>progress:read</code>, <code>reports:read</code> (schools and organizations) and <code>events:read</code> (organizers). An organization&apos;s key covers all its schools; add <code>?schoolId=</code> to look at one.</p>
          <Code>{CURL}</Code>
        </Section>

        <Section id="endpoints" icon={ListChecks} title="Endpoints">
          <p>Base address: <code>{API}/api/v1</code>. The full description is at <a className="text-brand-600 underline" href={`${API}/api/v1/openapi.json`}>/api/v1/openapi.json</a> (OpenAPI 3.1), which Postman and code generators can import.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-earth-200 dark:border-white/10"><th className="py-2 pr-3">Endpoint</th><th className="py-2 pr-3">Permission</th><th className="py-2">What it returns</th></tr></thead>
              <tbody>
                {ENDPOINTS.map(([m, p, s, d]) => (
                  <tr key={p} className="border-b border-earth-100 dark:border-white/5 align-top">
                    <td className="py-2 pr-3 font-mono whitespace-nowrap">{m} {p}</td>
                    <td className="py-2 pr-3 font-mono whitespace-nowrap">{s}</td>
                    <td className="py-2">{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>Errors look like <code>{'{ "error": { "code": "missing_scope", "message": "…" } }'}</code> with a matching status: 401 for a missing, invalid or revoked key, 402 when a school&apos;s account isn&apos;t active, 403 for a missing permission, 404, 429 and 500. Dates are <code>YYYY-MM-DD</code>; times are ISO 8601 in UTC.</p>
        </Section>

        <Section id="paging" icon={Gauge} title="Paging and limits">
          <p>Lists return <code>{'{ data, nextCursor }'}</code>. Pass <code>cursor=nextCursor</code> to get the next page, until it is <code>null</code>. <code>limit</code> is 100 by default and at most 500. For incremental pulls of hours, keep the time of your last pull and send it as <code>createdSince</code>.</p>
          <p>Each key may make 600 requests every 15 minutes. The <code>RateLimit</code> headers say how many are left; a 429 means wait and try again.</p>
          <Code>{PAGING}</Code>
        </Section>

        <Section id="webhooks" icon={Webhook} title="Webhooks">
          <p>Add your https address in <strong>Settings → Webhooks</strong> and pick the events you want. VolunTrack sends a <code>POST</code> with a JSON body <code>{'{ id, type, createdAt, data }'}</code> as soon as it happens. Answer with any 2xx within 10 seconds. A failed delivery is tried again after 1 minute, 10 minutes, 1 hour, 6 hours and 24 hours; an address failing for 3 days is turned off and you get an email. The settings page lists every attempt, can resend one, and can send a test event.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <tbody>{EVENTS.map(([e, d]) => <tr key={e} className="border-b border-earth-100 dark:border-white/5"><td className="py-2 pr-3 font-mono">{e}</td><td className="py-2">{d}</td></tr>)}</tbody>
            </table>
          </div>
          <p><strong>Check every delivery.</strong> The <code>VolunTrack-Signature</code> header is <code>t=&lt;unix seconds&gt;,v1=&lt;signature&gt;</code>, where the signature is an HMAC-SHA256 of <code>t.body</code> with the signing secret you copied when you added the address. Compare it in constant time and reject anything older than 5 minutes. <code>VolunTrack-Delivery</code> is the same on a retry, so you can ignore repeats.</p>
          <Code>{VERIFY_NODE}</Code>
          <Code>{VERIFY_PY}</Code>
        </Section>

        <Section id="privacy" icon={ShieldCheck} title="Privacy">
          <p>Most VolunTrack students are minors, so the API shares less than the dashboard:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Keys are read-only, and each reads only its own school, organization or events.</li>
            <li>A student&apos;s reflections, skills, notes, proof files and signatures never leave through the API or webhooks.</li>
            <li>Students under 13 still waiting for a parent&apos;s approval are never included.</li>
            <li>Event volunteers appear as first name and last initial.</li>
            <li>Every read of students&apos; records is in the school&apos;s audit trail, against the person who made the key.</li>
          </ul>
          <p>The school decides where it sends its students&apos; data. See the <Link to="/privacy" className="text-brand-600 underline">privacy policy</Link>.</p>
        </Section>

        <Section id="examples" icon={FileJson} title="Example: approved hours into Google Sheets">
          <p>In a Google Sheet, open Extensions → Apps Script, paste this, save your key as a script property named <code>VOLUNTRACK_KEY</code>, and run it (or put it on a daily trigger).</p>
          <Code>{SHEETS}</Code>
          <p>Questions, or need a permission that isn&apos;t here yet? <Link to="/contact" className="text-brand-600 underline">Get in touch</Link>.</p>
        </Section>
      </main>
      <Footer />
    </div>
  )
}
