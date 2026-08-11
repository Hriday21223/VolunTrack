import nodemailer from 'nodemailer'

// Gmail SMTP (already used for password/PIN recovery — see server.js) can
// deliver to any address with no domain-verification step, unlike Resend's
// sandbox mode which only sends to the account owner's own email until a
// domain is DNS-verified. Reuse the same SMTP creds here so admin/school
// emails (invites, payment notices) actually reach recipients.
let transport = null
function smtpTransport() {
  const host = process.env.EMAIL_HOST
  const user = process.env.EMAIL_USER
  const pass = process.env.EMAIL_PASSWORD
  if (!host || !user || !pass) return null
  if (!transport) {
    transport = nodemailer.createTransport({
      host,
      port: Number(process.env.EMAIL_PORT || 587),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: { user, pass },
    })
  }
  return transport
}

export function hasEmail() {
  return Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASSWORD)
}

// Fire-and-log: a failed send should never break the admin/school flow that
// triggered it — admin_notifications already gives an in-app fallback.
export async function sendEmail({ to, subject, html }) {
  const t = smtpTransport()
  if (!t) {
    console.log(`[dev] EMAIL_HOST/EMAIL_USER/EMAIL_PASSWORD not set — would have emailed ${to}: ${subject}`)
    return { sent: false }
  }
  try {
    const info = await t.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject,
      html,
    })
    return { sent: true, id: info.messageId }
  } catch (error) {
    console.error('SMTP send failed:', error.message)
    return { sent: false, error: error.message }
  }
}
