// Invoked by .github/workflows/notify-daily-scan.yml when the "daily bug &
// feature scan" cloud routine finishes a run. That routine reviews the
// codebase for bugs and new-feature ideas, files GitHub issues, and then
// dispatches a repository_dispatch event carrying its summary text. Like
// notify-ci-watch-checkin.mjs, the routine's isolated cloud environment
// can't hold SMTP credentials, so this script reuses server/email.js's
// sendEmail with repo secrets to put the report in an inbox.
import { sendEmail } from '../server/email.js'
import { escapeHtml } from '../server/html.js'

const to = process.env.NOTIFY_TO
const subject = process.env.SCAN_SUBJECT || 'VolunTrack daily bug & feature scan'
const summary = process.env.SCAN_SUMMARY || '(no summary provided)'
const issueUrl = process.env.SCAN_ISSUE_URL || ''

// Only render the link when it actually points at a GitHub issue — a manual
// test dispatch (or a routine run that skipped opening the summary issue)
// can pass an empty value or a bare repo URL, which would otherwise show as
// a "Summary issue" link that just goes to the repo homepage.
const isIssueUrl = /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+/.test(issueUrl)
const issueLine = isIssueUrl
  ? `<p>Summary issue: <a href="${escapeHtml(issueUrl)}">${escapeHtml(issueUrl)}</a></p>`
  : ''

const html = `
<p>Daily bug &amp; feature scan of the VolunTrack codebase:</p>
<pre style="white-space: pre-wrap; font-family: inherit;">${escapeHtml(summary)}</pre>
${issueLine}
<p>Repo: <a href="https://github.com/Hriday21223/VolunTrack">https://github.com/Hriday21223/VolunTrack</a></p>
<p>This is an automated message from the VolunTrack daily bug &amp; feature scan routine — please don't reply to this email.</p>
`

const result = await sendEmail({ to, subject, html })
if (!result.sent) {
  console.error('Email not sent:', result.error || '(EMAIL_HOST/EMAIL_USER/EMAIL_PASSWORD not set)')
  process.exit(1)
}
console.log('Daily scan email sent:', result.id)
