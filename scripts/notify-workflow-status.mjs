// Invoked by .github/workflows/notify-workflow-status.yml when one of the
// scheduled jobs (or the Vercel deploy) changes state: it just failed after
// working, or it works again after failing. Reuses server/email.js, like
// notify-ci-failure.mjs.
import { sendEmail } from '../server/email.js'
import { escapeHtml } from '../server/html.js'

const to = process.env.NOTIFY_TO
const name = process.env.WF_NAME || 'A workflow'
const state = process.env.STATE // 'failed' | 'recovered'
const url = process.env.RUN_URL || ''
const when = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' })

const failed = state === 'failed'
const subject = failed ? `VolunTrack: "${name}" failed` : `VolunTrack: "${name}" is working again`
const html = failed
  ? `<p>The GitHub job <strong>${escapeHtml(name)}</strong> failed at ${escapeHtml(when)} (Central).</p>
<p>See what went wrong: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
<p>You'll get one more email when it works again, not one for every failed run.</p>`
  : `<p>The GitHub job <strong>${escapeHtml(name)}</strong> ran successfully at ${escapeHtml(when)} (Central), after failing before.</p>
<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`

const result = await sendEmail({ to, subject, html })
if (!result.sent) {
  console.error('Email not sent:', result.error || '(no email provider set)')
  process.exit(1)
}
console.log('Status email sent:', result.id)
