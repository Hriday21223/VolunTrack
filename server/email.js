import { Resend } from 'resend'

// The provisioned domain isn't DNS-verified, so Resend only allows sending
// from its shared sandbox address, which itself only delivers to the
// account owner's own Resend email. Once RESEND_EMAIL_DOMAIN is verified,
// switch FROM to `VolunTrack <payments@${process.env.RESEND_EMAIL_DOMAIN}>`.
const FROM = 'VolunTrack <onboarding@resend.dev>'

let client = null
function resendClient() {
  if (!process.env.RESEND_API_KEY) return null
  if (!client) client = new Resend(process.env.RESEND_API_KEY)
  return client
}

export function hasEmail() {
  return Boolean(process.env.RESEND_API_KEY)
}

// Fire-and-log: a failed send should never break the admin/school flow that
// triggered it — admin_notifications already gives an in-app fallback.
export async function sendEmail({ to, subject, html, idempotencyKey }) {
  const resend = resendClient()
  if (!resend) {
    console.log(`[dev] RESEND_API_KEY not set — would have emailed ${to}: ${subject}`)
    return { sent: false }
  }
  const { data, error } = await resend.emails.send(
    { from: FROM, to: [to], subject, html },
    idempotencyKey ? { idempotencyKey } : undefined,
  )
  if (error) {
    console.error('Resend send failed:', error.message)
    return { sent: false, error: error.message }
  }
  return { sent: true, id: data.id }
}
