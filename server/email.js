import nodemailer from 'nodemailer'
import { escapeHtml } from './html.js'
import { et, emailLang } from './emailStrings.js'
import { csvCell } from '../src/lib/csv.js'

// Two ways out, picked at send time by which env vars are set.
//
// BREVO_API_KEY is the production path: Render's free instances block outbound
// SMTP (ports 25/465/587), so Gmail SMTP cannot work there at all — connections
// hang with no error. Brevo posts over HTTPS, which is not blocked. It verifies
// a single sender address rather than a whole domain, which is what lets us
// send as an @gmail.com address while VolunTrack has no domain of its own.
//
// SMTP stays as the fallback so local development keeps working with the
// credentials already in .env, and so a future move to a verified domain is a
// config change rather than a rewrite. See #205.
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'

// Keys an admin set in Admin → Settings (server/emailSettings.js). Each one,
// when present, wins over its env var, so a revoked key can be swapped without
// a redeploy. Held in memory because every reader below is synchronous.
let overrides = { brevoKey: null, smtpPassword: null }

function brevoKey() {
  return overrides.brevoKey || process.env.BREVO_API_KEY || null
}

function smtpPassword() {
  return overrides.smtpPassword || process.env.EMAIL_PASSWORD || null
}

// The address every message is sent as. Brevo rejects a sender it has not had
// verified, so this must match what was verified in the Brevo dashboard.
function fromAddress() {
  return process.env.EMAIL_FROM || process.env.EMAIL_USER || null
}

// Where a reply goes. Brevo can't send as an @gmail.com address (Gmail's DMARC
// policy), so it swaps the sender for its own brevosend.com address, and a
// reply would land there instead of in our inbox. EMAIL_REPLY_TO can point
// replies elsewhere; by default they go back to the address we send as.
function replyToAddress() {
  return process.env.EMAIL_REPLY_TO || fromAddress()
}

let transport = null
function smtpTransport() {
  const host = process.env.EMAIL_HOST
  const user = process.env.EMAIL_USER
  const pass = smtpPassword()
  if (!host || !user || !pass) return null
  if (!transport) {
    transport = nodemailer.createTransport({
      host,
      port: Number(process.env.EMAIL_PORT || 587),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: { user, pass },
      // Pin the connection to IPv4. smtp.gmail.com publishes both A and AAAA
      // records, Node prefers the AAAA, and Render's instances have no IPv6
      // route out — so every send failed with
      // `connect ENETUNREACH 2607:f8b0:...:587` and no fallback to the A
      // record. Nothing in the app's own config revealed this: the health
      // endpoint reported email as configured, because the env vars were all
      // set, while not one message could leave the box. See #205.
      family: 4,
      // Without these a blocked port doesn't error — it hangs. That is exactly
      // what happened on Render: a send sat for 90s and the caller gave up
      // before anything was logged. Fail in seconds and say so instead.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
  }
  return transport
}

export function hasEmail() {
  if (brevoKey() && fromAddress()) return true
  return Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USER && smtpPassword())
}

// Which provider sendEmail() would use and where each key comes from — never
// the keys themselves. Mirrors the branch order in sendEmail().
export function emailStatus() {
  const brevo = { env: Boolean(process.env.BREVO_API_KEY), override: Boolean(overrides.brevoKey) }
  const smtp = { env: Boolean(process.env.EMAIL_PASSWORD), override: Boolean(overrides.smtpPassword) }
  let provider = null
  if (brevoKey() && fromAddress()) provider = 'brevo'
  else if (smtpTransport()) provider = 'smtp'
  return { provider, brevo, smtp }
}

// Real SMTP reachability, not just "the env vars are set": transport.verify()
// connects and authenticates without sending a message. /api/status/health is
// public, so the probe is throttled to one per interval process-wide — however
// often the endpoint is hit, we open at most one SMTP connection per window.
const EMAIL_CHECK_INTERVAL_MS = 5 * 60 * 1000
const emailHealth = { ok: null, consecutiveFailures: 0, errorCode: null, checkedAt: 0 }
let emailCheckInFlight = null
// Bumped whenever the keys change, so a probe that started with the old key
// can't record its result over the new key's.
let keyGeneration = 0

// Swaps in admin-set keys and forgets everything derived from the old ones: the
// cached SMTP transport (it holds the password it was built with) and the
// health result, so the next check probes the new key instead of waiting out
// the interval.
export function setEmailOverrides(next = {}) {
  overrides = { brevoKey: next.brevoKey || null, smtpPassword: next.smtpPassword || null }
  transport = null
  keyGeneration += 1
  emailCheckInFlight = null
  Object.assign(emailHealth, { ok: null, consecutiveFailures: 0, errorCode: null, checkedAt: 0 })
}

// Last known result; ok is null until the first probe finishes.
export function emailHealthSnapshot() {
  return { ...emailHealth }
}

// Reaches whichever provider is configured, without sending a message: Brevo's
// /account is a cheap authenticated GET, and nodemailer's verify() opens and
// authenticates an SMTP connection. Both answer the question the SMTP-only
// version could not — "can this box actually deliver mail right now" — which is
// what let a completely dead email setup report itself healthy. See #205.
function probeProvider() {
  const key = brevoKey()
  if (key) {
    return fetch('https://api.brevo.com/v3/account', {
      headers: { 'api-key': key, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    }).then((res) => {
      if (!res.ok) {
        const error = new Error(`Brevo account check returned ${res.status}`)
        error.code = res.status === 401 ? 'EAUTH' : 'EPROVIDER'
        throw error
      }
    })
  }
  const t = smtpTransport()
  return t ? t.verify() : null
}

// Starts a probe if one is due and returns its promise (resolving to the new
// snapshot), or null when no provider is configured or a probe ran recently.
export function refreshEmailHealth() {
  if (emailCheckInFlight) return null
  if (Date.now() - emailHealth.checkedAt < EMAIL_CHECK_INTERVAL_MS) return null
  const probe = probeProvider()
  if (!probe) return null

  emailHealth.checkedAt = Date.now()
  const generation = keyGeneration
  const inFlight = probe
    .then(() => {
      if (generation !== keyGeneration) return
      emailHealth.ok = true
      emailHealth.consecutiveFailures = 0
      emailHealth.errorCode = null
    })
    .catch((error) => {
      if (generation !== keyGeneration) return
      console.error('Email health check failed:', error.message)
      emailHealth.ok = false
      emailHealth.consecutiveFailures += 1
      // Only nodemailer's short code (EAUTH, ETIMEDOUT, …) is kept — the full
      // message can echo server responses and ends up on the public /status page.
      emailHealth.errorCode = /^[A-Z_]{2,32}$/.test(error.code || '') ? error.code : null
    })
    .then(() => emailHealthSnapshot())
    .finally(() => { if (emailCheckInFlight === inFlight) emailCheckInFlight = null })
  emailCheckInFlight = inFlight
  return inFlight
}

// Strip CR/LF so a caller-supplied value can't forge extra log lines when
// interpolated into a log message. The replacement must be the empty string
// for CodeQL to recognize this as a log-injection sanitizer.
export function forLog(value) {
  return String(value).replace(/\n|\r/g, '')
}

// Appended to every automated email (this repo has no monitored reply
// inbox) so recipients know where to actually go for help. Falls back to
// the live production URL rather than a bare "/contact" path, which would
// be unclickable outside a browser tab already on the site.
function contactLink() {
  return `${process.env.FRONTEND_URL || 'https://volunteer-track-two.vercel.app'}/contact`
}

// `lang` ('en' | 'es', see server/emailStrings.js) is for emails that are
// rendered in the recipient's language; everything else gets English.
export function emailFooterHtml(lang = 'en') {
  const link = contactLink()
  return `<p>${et(lang, "This is an automated message — please don't reply to this email. Contact us if you run into any problems: {link}", { link: `<a href="${link}">${link}</a>` })}</p>`
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
  const dashboardLink = `${process.env.FRONTEND_URL || ''}/school/dashboard/setup/billing`
  const dueDateStr = dueDate ? new Date(dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : null
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

// An admin announcement (#290) — deliberately not the payment template: no
// amounts, bank details or "payment notice" wording.
export function announcementHtml({ recipientName, title, message, dashboardPath, fromName }) {
  const link = `${process.env.FRONTEND_URL || ''}${dashboardPath}`
  return [
    `<p>Hi ${escapeHtml(recipientName)},</p>`,
    fromName ? `<p style="color:#666;font-size:13px">A message from ${escapeHtml(fromName)}</p>` : '',
    `<h2 style="margin-bottom:4px">${escapeHtml(title)}</h2>`,
    `<p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`,
    `<p>You'll also see this on your dashboard: <a href="${link}">${link}</a></p>`,
    emailFooterHtml(),
  ].join('')
}

// Fire-and-log: a failed send should never break the admin/school flow that
// triggered it — admin_notifications already gives an in-app fallback.
// `unsubscribeUrl` adds the List-Unsubscribe headers Gmail and Yahoo show as a
// one-click "Unsubscribe" by the sender name. The URL must stop the emails on
// a bare POST (RFC 8058) and only show a confirm page on GET.
// `attachments` are { name, content } with content as a string or Buffer.
export async function sendEmail({ to, subject, html, unsubscribeUrl, attachments }) {
  const from = fromAddress()
  const key = brevoKey()
  const headers = unsubscribeUrl
    ? { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
    : undefined

  if (key && from) {
    try {
      const res = await fetch(BREVO_ENDPOINT, {
        method: 'POST',
        headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { email: from, name: 'VolunTrack' },
          replyTo: { email: replyToAddress() },
          to: [{ email: to }],
          subject,
          htmlContent: html,
          ...(headers ? { headers } : {}),
          ...(attachments?.length
            ? { attachment: attachments.map((a) => ({ name: a.name, content: Buffer.from(a.content).toString('base64') })) }
            : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) {
        // Brevo puts the reason in the body (unverified sender, over quota, bad
        // key). Log it — this is the one place that says why mail stopped.
        const detail = await res.text().catch(() => '')
        console.error(`Brevo send failed: ${res.status} ${forLog(detail.slice(0, 200))}`)
        return { sent: false, error: `Brevo returned ${res.status}` }
      }
      const data = await res.json().catch(() => ({}))
      return { sent: true, id: data.messageId }
    } catch (error) {
      console.error('Brevo send failed:', error.message)
      return { sent: false, error: error.message }
    }
  }

  const t = smtpTransport()
  if (!t) {
    console.log(`[dev] No email provider configured (BREVO_API_KEY, or EMAIL_HOST/EMAIL_USER/EMAIL_PASSWORD) — would have emailed ${forLog(to)}: ${forLog(subject)}`)
    return { sent: false }
  }
  try {
    const info = await t.sendMail({
      from, to, replyTo: replyToAddress(), subject, html,
      ...(headers ? { headers } : {}),
      ...(attachments?.length ? { attachments: attachments.map((a) => ({ filename: a.name, content: a.content })) } : {}),
    })
    return { sent: true, id: info.messageId }
  } catch (error) {
    console.error('SMTP send failed:', error.message)
    return { sent: false, error: error.message }
  }
}

// Welcome email (#534), one per role, each with a single first step. Shared by
// every signup path (student/volunteer/parent, school or club, organization)
// so the greeting stays consistent no matter how someone joins.
export function welcomeEmailContent({ name, role, schoolPin = null, plan = null, language = null }) {
  const lang = emailLang(language)
  const t = (text, vars) => et(lang, text, vars)
  const site = (process.env.FRONTEND_URL || 'https://volunteer-track-two.vercel.app').split(',')[0].trim().replace(/\/$/, '')
  const button = (href, label) => `<p><a href="${href}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#2e7d32;color:#ffffff;text-decoration:none;font-weight:600">${escapeHtml(label)}</a></p>`
  const hi = `<p>${name ? t('Hi {name},', { name: escapeHtml(name) }) : t('Hi there,')}</p>`
  const sign = `<p>${t('— The VolunTrack Team')}</p>`

  if (role === 'school') {
    const club = plan === 'club'
    return {
      subject: club ? t('Your free VolunTrack club is ready') : t('Your VolunTrack school account is ready'),
      html: `${hi}
<p>${club ? t('Your free club is set up.') : t('Your school account is set up.')} ${t('The next step is getting students on board, and it takes about five minutes.')}</p>
<p>${schoolPin
    ? t('Your dashboard has a <strong>starter kit</strong>: a join link (students can also type the code <strong>{code}</strong>), a QR code, a printable flyer in English and Spanish, and messages ready to paste into email or Google Classroom.', { code: escapeHtml(schoolPin) })
    : t('Your dashboard has a <strong>starter kit</strong>: a join link, a QR code, a printable flyer in English and Spanish, and messages ready to paste into email or Google Classroom.')}</p>
${button(`${site}/school/dashboard/students`, t('Open your starter kit'))}
<p>${t('Then set your hour requirement under School setup → Requirements, so students can see how close they are.')}${club ? ` ${t('A free club can have up to 50 students. For more, use <strong>Upgrade to a school plan</strong> on your dashboard or <a href="{link}">contact us</a>.', { link: `${site}/contact?topic=school` })}` : ''}</p>
${sign}`,
    }
  }
  if (role === 'org') {
    return {
      subject: t('Your VolunTrack organization is ready'),
      html: `${hi}
<p>${t('Your organization account is set up. Start by adding your first school: you send the invite, and the school finishes setting itself up.')}</p>
${button(`${site}/organization/dashboard`, t('Add your first school'))}
<p>${t('Once you have two or more schools, your dashboard compares them side by side.')}</p>
${sign}`,
    }
  }
  if (role === 'parent') {
    return {
      subject: t('Welcome to VolunTrack'),
      html: `${hi}
<p>${t('Welcome! To follow your student’s volunteer hours, ask them for a <strong>family link code</strong>: they make one in VolunTrack under Settings → Family. Then enter it in your Settings.')}</p>
${button(`${site}/settings`, t('Enter a link code'))}
<p>${t('You’ll see the hours they log from then on, and you can get a short weekly summary by email.')}</p>
${sign}`,
    }
  }
  // student, volunteer
  return {
    subject: t('Welcome to VolunTrack!'),
    html: `${hi}
<p>${t('Welcome! The best time to log volunteer hours is right after you do them. It takes about a minute: the date, what you did, and how long.')}</p>
${button(`${site}/log`, t('Log your first hours'))}
<p>${role === 'student' ? `${t('If your school or club uses VolunTrack, ask your adviser for the school code and enter it in Settings, so they can approve your hours.')} ` : ''}${t('Have old hours on paper? On Log Hours, tap <strong>Scan a paper log</strong> to add them from a photo.')}</p>
${sign}`,
  }
}

export async function sendWelcomeEmail({ to, name, role = 'student', schoolPin = null, plan = null, language = null }) {
  const { subject, html } = welcomeEmailContent({ name, role, schoolPin, plan, language })
  return sendEmail({ to, subject, html: `${html}\n${emailFooterHtml(emailLang(language))}` })
}

// The 6-digit code that proves a sign-up owns its email (#310). Awaited, not
// fire-and-log: without it the account can't be created, so the form needs
// to know whether it went.
export async function sendSignupCodeEmail({ to, code, minutes, language = null }) {
  const lang = emailLang(language)
  const t = (text, vars) => et(lang, text, vars)
  return sendEmail({
    to,
    subject: t('{code} is your VolunTrack code', { code }),
    html: `<p>${t('Enter this code to finish creating your VolunTrack account:')}</p>
<p style="font-size:28px;font-weight:600;letter-spacing:0.2em;">${code}</p>
<p>${t('It works once and expires in {n} minutes. If you didn’t try to sign up, you can ignore this email — no account is created without the code.', { n: minutes })}</p>
${emailFooterHtml(lang)}`,
  })
}

// Two-step sign-in by email (#470). `purpose` 'enable' is the one-off check
// that turns the option on; 'login' is every sign-in after that.
export async function sendEmailOtpEmail({ to, code, minutes, language, purpose = 'login' }) {
  const lang = emailLang(language)
  const t = (text, vars) => et(lang, text, vars)
  const intro = purpose === 'enable'
    ? t('Enter this code in VolunTrack to turn on two-step sign-in by email:')
    : t('Enter this code to finish signing in to VolunTrack:')
  return sendEmail({
    to,
    subject: t('{code} is your VolunTrack code', { code }),
    html: `<p>${intro}</p>
<p style="font-size:28px;font-weight:600;letter-spacing:0.2em;">${code}</p>
<p>${t("It works once and expires in {minutes} minutes. If you didn't just try to sign in, someone may know your password: change it in Settings.", { minutes })}</p>
${emailFooterHtml(lang)}`,
  })
}

// Confirms a new address before an account moves to it (#464).
export async function sendEmailChangeCodeEmail({ to, code, minutes, language }) {
  const lang = emailLang(language)
  const t = (text, vars) => et(lang, text, vars)
  return sendEmail({
    to,
    subject: t('{code} is your VolunTrack code', { code }),
    html: `<p>${t('Enter this code in VolunTrack to use this address for your account:')}</p>
<p style="font-size:28px;font-weight:600;letter-spacing:0.2em;">${code}</p>
<p>${t("It works once and expires in {minutes} minutes. If you didn't ask for this, ignore this email. Nothing changes without the code.", { minutes })}</p>
${emailFooterHtml(lang)}`,
  })
}

// Goes to the old address after a change, so a takeover doesn't go unnoticed.
export async function sendEmailChangedNotice({ to, name, newEmail, language }) {
  const lang = emailLang(language)
  const t = (text, vars) => et(lang, text, vars)
  return sendEmail({
    to,
    subject: t('Your VolunTrack email address was changed'),
    html: `<p>${name ? t('Hi {name},', { name: escapeHtml(name) }) : t('Hi there,')}</p>
<p>${t('The email address for your VolunTrack account was changed to {email}. From now on, sign in and get emails there.', { email: `<strong>${escapeHtml(newEmail)}</strong>` })}</p>
<p>${t("If you didn't do this, contact us right away: {link}", { link: `<a href="${contactLink()}">${contactLink()}</a>` })}</p>
${emailFooterHtml(lang)}`,
  })
}

// Base for /api links in emails. The website (vercel.json) passes these paths
// on to the backend, so emails show only the website's address. FRONTEND_URL
// may list several origins for CORS; the first is the public one.
export function emailApiBase() {
  const first = (process.env.FRONTEND_URL || '').split(',').map((s) => s.trim()).find(Boolean)
  return (first || 'https://volunteer-track-two.vercel.app').replace(/\/$/, '')
}

export function backendUrl() {
  return (process.env.PUBLIC_BACKEND_URL || 'https://voluntrack-backend-frrh.onrender.com').replace(/\/$/, '')
}

// Asks a parent or guardian to approve an under-13 sign-up. The link goes to
// the backend, which renders its own confirm page (see
// server/routes/parentConsent.js) — nothing is approved by opening it.
export async function sendParentConsentEmail({ to, childName, childEmail, token }) {
  const link = `${emailApiBase()}/api/auth/parent-consent/${token}`
  const privacy = `${process.env.FRONTEND_URL || 'https://volunteer-track-two.vercel.app'}/privacy`
  return sendEmail({
    to,
    subject: `${childName} needs your permission to use VolunTrack`,
    html: `<p>Hello,</p>
<p><strong>${escapeHtml(childName)}</strong> (${escapeHtml(childEmail)}) signed up for VolunTrack, a volunteer-hour tracker for students, and told us they are under 13. They gave this address as their parent or guardian.</p>
<p>The account is locked and cannot be used until you approve it. If approved, VolunTrack stores the name, email, grade and volunteer hours your child enters, and shares those hours with their school if they link one. We show no ads and sell no data. Details are in our <a href="${privacy}">Privacy Policy</a>.</p>
<p><a href="${link}">Review this request</a></p>
<p>Once the account is open, each volunteer task your child signs up for also waits for your OK before the organizer sees it. If you link a VolunTrack parent account to theirs you'll answer on your dashboard; otherwise we'll email this address.</p>
<p>If you decline, or do nothing for 14 days, the account and everything in it is deleted. If you don't know this child, decline or ignore this email.</p>
${emailFooterHtml()}`,
  })
}


// Sent after an account is deleted (DELETE /api/auth/account). The logs are
// gone from our database by then, so a student or volunteer gets them as a
// CSV attachment: the only copy we can still give them (#463).
export async function sendAccountDeletedEmail({ to, name, language, logs = null, cancelledEvents = 0 }) {
  const lang = emailLang(language)
  const t = (text, vars) => et(lang, text, vars)
  const paras = [name ? t('Hi {name},', { name: escapeHtml(name) }) : t('Hi there,'),
    t('Your VolunTrack account and its data have been deleted, as you asked.')]
  let attachments
  if (logs) {
    if (logs.length > 0) {
      const total = Math.round(logs.reduce((n, l) => n + Number(l.hours || 0), 0) * 100) / 100
      paras.push(t(logs.length === 1
        ? "We've attached a copy of your volunteer hours (1 entry, {hours} hours in total) as a spreadsheet file, so you still have a record."
        : "We've attached a copy of your volunteer hours ({n} entries, {hours} hours in total) as a spreadsheet file, so you still have a record.",
      { n: logs.length, hours: total }))
      paras.push(t("Keep it somewhere safe. We can't recover your account or these hours."))
      attachments = [{ name: 'voluntrack-hours.csv', content: logsCsv(logs, lang) }]
    } else {
      paras.push(t('You had no volunteer hours logged, so there is nothing to attach.'))
    }
  }
  if (cancelledEvents > 0) {
    paras.push(t(cancelledEvents === 1
      ? 'We cancelled the 1 upcoming event you posted and let the people signed up know.'
      : 'We cancelled the {n} upcoming events you posted and let the people signed up know.', { n: cancelledEvents }))
  }
  paras.push(t("Thank you for volunteering. You're welcome back any time."))
  return sendEmail({
    to,
    subject: t('Your VolunTrack account has been deleted'),
    html: paras.map((p) => `<p>${p}</p>`).join('') + emailFooterHtml(lang),
    attachments,
  })
}

// Same cell escaping as the app's own export (src/lib/csv.js), so a log typed
// as a formula can't run in a spreadsheet. Only what the server stores: the
// device-only fields (start/end time, org address/phone) were never sent.
function logsCsv(logs, lang) {
  const t = (text) => et(lang, text)
  const status = { approved: t('Approved'), pending: t('Pending'), rejected: t('Rejected') }
  const rows = [
    [t('Date'), t('Activity'), t('Category'), t('Hours'), t('Location'), t('Organization'), t('Supervisor'), t('Status'), t('Notes')],
    ...logs.map((l) => [l.date, l.activity, l.category, l.hours, l.location, l.org_name, l.supervisor_name,
      status[l.verification_status] || t('Unverified'), String(l.notes || '').replace(/\r?\n/g, ' ')]),
  ]
  // A byte-order mark so Excel opens accented (Spanish) text correctly.
  return '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
}
