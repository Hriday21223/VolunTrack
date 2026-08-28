// Invoked by .github/workflows/notify-ci-watch-checkin.yml when the CI-watch
// daily check-in cloud routine (trig_01XHUmStGFsjHzb3aBeiMGnY) finishes a
// run. That routine has no way to hold SMTP credentials, so it dispatches a
// repository_dispatch event carrying its summary text and this script (like
// notify-ci-failure.mjs) reuses server/email.js's sendEmail with repo secrets
// to put the report in an inbox.
import { sendEmail } from '../server/email.js'
import { escapeHtml } from '../server/html.js'

const to = process.env.NOTIFY_TO
const subject = process.env.CHECKIN_SUBJECT || 'VolunTrack CI-watch daily check-in'
const summary = process.env.CHECKIN_SUMMARY || '(no summary provided)'

const html = `
<p>Daily check-in on the VolunTrack CI-watch routines:</p>
<pre style="white-space: pre-wrap; font-family: inherit;">${escapeHtml(summary)}</pre>
<p>Repo: <a href="https://github.com/Hriday21223/VolunTrack">https://github.com/Hriday21223/VolunTrack</a></p>
<p>This is an automated message from the VolunTrack CI-watch daily check-in routine — please don't reply to this email.</p>
`

const result = await sendEmail({ to, subject, html })
if (!result.sent) {
  console.error('Email not sent:', result.error || '(EMAIL_HOST/EMAIL_USER/EMAIL_PASSWORD not set)')
  process.exit(1)
}
console.log('Check-in email sent:', result.id)
