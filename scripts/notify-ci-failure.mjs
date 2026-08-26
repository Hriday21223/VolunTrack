// Invoked by .github/workflows/notify-ci-failure.yml when the CI-watch cloud
// routine (see project docs) opens or comments on a ci-failure-auto issue/PR.
// The routine runs in an isolated environment with no way to hold SMTP
// credentials, so this reuses server/email.js's sendEmail (same creds as the
// deployed app) to put the alert in an inbox instead.
import { sendEmail } from '../server/email.js'

const to = process.env.NOTIFY_TO
const title = process.env.ISSUE_TITLE || 'CI failure'
const url = process.env.ISSUE_URL
const isPR = process.env.IS_PR === 'true'
const kind = isPR ? 'pull request' : 'issue'

const html = `
<p>The VolunTrack CI-watch routine found a new GitHub Actions failure and opened a ${kind}:</p>
<p><strong>${title}</strong></p>
<p><a href="${url}">${url}</a></p>
<p>It's waiting for your OK before pushing a fix — reply "ok" as a comment on the ${kind} to let it proceed.</p>
`

const result = await sendEmail({ to, subject: `VolunTrack CI: ${title}`, html })
if (!result.sent) {
  console.error('Email not sent:', result.error || '(EMAIL_HOST/EMAIL_USER/EMAIL_PASSWORD not set)')
  process.exit(1)
}
console.log('Notification email sent:', result.id)
