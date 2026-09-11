import nodemailer from 'nodemailer'
import { escapeHtml } from './html.js'

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

// Strip CR/LF so a caller-supplied value can't forge extra log lines when
// interpolated into a log message. The replacement must be the empty string
// for CodeQL to recognize this as a log-injection sanitizer.
function forLog(value) {
  return String(value).replace(/\n|\r/g, '')
}

// Appended to every automated email (this repo has no monitored reply
// inbox) so recipients know where to actually go for help. Falls back to
// the live production URL rather than a bare "/contact" path, which would
// be unclickable outside a browser tab already on the site.
function contactLink() {
  return `${process.env.FRONTEND_URL || 'https://volunteer-track-two.vercel.app'}/contact`
}

export function emailFooterHtml() {
  const link = contactLink()
  return `<p>This is an automated message — please don't reply to this email. Contact us if you run into any problems: <a href="${link}">${link}</a></p>`
}

export function emailFooterText() {
  return `This is an automated message — please don't reply to this email. Contact us if you run into any problems: ${contactLink()}`
}

const BILLING_PERIOD_LABELS = { monthly: '/ month', yearly: '/ year', one_time: 'one-time' }

// Renders the admin's bank details ("how to pay us") as a small block, always
// paired with the customer's account code so they know what to put in the
// transfer reference. Returns '' when the admin hasn't filled anything in, so
// callers can drop it straight into a template array.
export function paymentInstructionsHtml(instructions, accountCode) {
  if (!instructions) return ''
  const rows = [
    ['Bank', instructions.bankName],
    ['Account name', instructions.accountName],
    ['Account number', instructions.accountNumber],
    ['Routing number', instructions.routingNumber],
    ['SWIFT/BIC', instructions.swift],
  ].filter(([, value]) => Boolean(value))
  // Checked before the reference row is added: that row falls back to the
  // account code, which is always set, and would otherwise render a lone
  // "How to pay" heading for an admin who has configured nothing.
  if (rows.length === 0 && !instructions.notes && !instructions.reference) return ''
  rows.push(['Payment reference', instructions.reference || accountCode])
  return [
    `<h3 style="margin-bottom:4px">How to pay</h3>`,
    rows.length ? `<table cellpadding="4" cellspacing="0">` : '',
    ...rows.map(([label, value]) => `<tr><td><strong>${escapeHtml(label)}</strong></td><td>${escapeHtml(String(value))}</td></tr>`),
    rows.length ? `</table>` : '',
    instructions.notes ? `<p>${escapeHtml(instructions.notes).replace(/\n/g, '<br>')}</p>` : '',
  ].join('')
}

// Builds the HTML body for a payment-request email: recipient name, optional
// amount owed, the due date on file (if any), free-text payment instructions
// from the admin, and (for schools, which have a self-service confirmation
// flow) a link back to the dashboard where they submit their bank
// confirmation number. Shared by school and organization notify routes.
export function paymentNoticeHtml({ recipientName, entityLabel = 'school', accountCode, amount, billingPeriod, dueDate, message, includeDashboardLink = true, paymentInstructions }) {
  const dashboardLink = `${process.env.FRONTEND_URL || ''}/school/dashboard`
  const dueDateStr = dueDate ? new Date(dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : null
  const periodLabel = BILLING_PERIOD_LABELS[billingPeriod] || ''
  return [
    `<p>Hi ${escapeHtml(recipientName)},</p>`,
    `<p>This is a payment notice for your ${entityLabel}'s VolunTrack account.</p>`,
    `<table cellpadding="4" cellspacing="0">`,
    accountCode ? `<tr><td><strong>Account ID</strong></td><td>${escapeHtml(accountCode)}</td></tr>` : '',
    amount ? `<tr><td><strong>Amount owed</strong></td><td>${escapeHtml(amount)}${periodLabel ? ' ' + escapeHtml(periodLabel) : ''}</td></tr>` : '',
    dueDateStr ? `<tr><td><strong>Due date</strong></td><td>${dueDateStr}</td></tr>` : '',
    `</table>`,
    `<p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`,
    paymentInstructionsHtml(paymentInstructions, accountCode),
    includeDashboardLink ? `<p>Once payment is complete, submit your bank confirmation or reference number from your school dashboard: <a href="${dashboardLink}">${dashboardLink}</a></p>` : '',
    emailFooterHtml(),
  ].join('')
}

// Fire-and-log: a failed send should never break the admin/school flow that
// triggered it — admin_notifications already gives an in-app fallback.
export async function sendEmail({ to, subject, html }) {
  const t = smtpTransport()
  if (!t) {
    console.log(`[dev] EMAIL_HOST/EMAIL_USER/EMAIL_PASSWORD not set — would have emailed ${forLog(to)}: ${forLog(subject)}`)
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

// Shared by every signup path (student/volunteer/parent, school, organization)
// so the greeting stays consistent no matter how someone joins.
export async function sendWelcomeEmail({ to, name }) {
  return sendEmail({
    to,
    subject: 'Welcome to VolunTrack!',
    html: `<p>Hi ${name},</p>
<p>Thank you for choosing VolunTrack! We're glad to have you on board.</p>
<p>VolunTrack makes it easy to log volunteer hours, track progress toward your goals, and earn achievements along the way. Schools and organizations can verify hours, and parents can follow their student's progress — all in one place.</p>
<p>— The VolunTrack Team</p>
${emailFooterHtml()}`,
  })
}
