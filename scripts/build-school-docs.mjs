// Builds the two documents a school asks for before it buys:
//   outputs/voluntrack-privacy-summary.pdf — what student data we hold and who sees it
//   outputs/voluntrack-quote.pdf           — a one-page quote for a principal or business office
//
//   node scripts/build-school-docs.mjs
//   node scripts/build-school-docs.mjs --school "Lincoln High School" --price 500 --period year \
//     --vendor "VolunTrack LLC" --quote Q-2026-001 --valid-days 60
//
// Without --price the quote prints blank lines to fill in by hand. The privacy
// summary restates src/pages/Privacy.jsx for a school audience — when that page
// changes, change PRIVACY below to match and rebuild.
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { parseArgs } from 'node:util'

const require = createRequire(import.meta.url)
const { jsPDF } = require('jspdf')
const autoTable = require('jspdf-autotable').default || require('jspdf-autotable')

const { values: args } = parseArgs({
  options: {
    school: { type: 'string' },
    price: { type: 'string' },
    period: { type: 'string', default: 'year' },
    vendor: { type: 'string', default: 'VolunTrack' },
    quote: { type: 'string' },
    'valid-days': { type: 'string', default: '60' },
  },
})

const SITE = 'volunteer-track-two.vercel.app'
const CONTACT = 'volunteertrackinfo@gmail.com'
const PRIVACY_UPDATED = 'October 10, 2026'

const PAGE_W = 612
const PAGE_H = 792
const MARGIN_X = 54
const CONTENT_W = PAGE_W - 2 * MARGIN_X
const BOTTOM = PAGE_H - 54

const COLOR = {
  ink: [15, 23, 18],
  body: [38, 50, 44],
  muted: [110, 122, 116],
  rule: [217, 217, 213],
  brand: [63, 131, 68],
  panel: [248, 250, 248],
}

const longDate = (d) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

function newDoc(title, subject) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' })
  doc.setProperties({ title, subject, author: 'VolunTrack', creator: 'VolunTrack build script' })
  return doc
}

function titleBlock(doc, kicker, title, sub) {
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...COLOR.brand)
  doc.text('VOLUNTRACK', MARGIN_X, 58)
  doc.setTextColor(...COLOR.muted)
  doc.text(kicker.toUpperCase(), PAGE_W - MARGIN_X, 58, { align: 'right' })
  doc.setDrawColor(...COLOR.rule).setLineWidth(0.5).line(MARGIN_X, 66, PAGE_W - MARGIN_X, 66)
  doc.setFontSize(22).setTextColor(...COLOR.ink)
  doc.text(title, MARGIN_X, 98)
  let y = 116
  if (sub) {
    doc.setFont('helvetica', 'normal').setFontSize(10.5).setTextColor(...COLOR.body)
    const lines = doc.splitTextToSize(sub, CONTENT_W)
    doc.text(lines, MARGIN_X, y)
    y += lines.length * 14
  }
  return y + 10
}

// Starts a new page when the next block wouldn't fit above the footer.
function room(doc, y, needed) {
  if (y + needed <= BOTTOM) return y
  doc.addPage()
  return 64
}

function heading(doc, text, y) {
  y = room(doc, y, 60)
  doc.setFont('helvetica', 'bold').setFontSize(12.5).setTextColor(...COLOR.ink)
  doc.text(text, MARGIN_X, y)
  return y + 17
}

function para(doc, text, y) {
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...COLOR.body)
  const lines = doc.splitTextToSize(text, CONTENT_W)
  y = room(doc, y, lines.length * 13.5)
  doc.text(lines, MARGIN_X, y)
  return y + lines.length * 13.5 + 5
}

// Each item is [label, detail] (the label is set bold, the detail runs on from
// it) or a plain sentence.
function bullets(doc, items, y) {
  const width = CONTENT_W - 14
  for (const item of items) {
    const [label, detail] = Array.isArray(item) ? item : [null, item]
    doc.setFontSize(10)
    let lines
    let labelW = 0
    if (label) {
      // Bold is wider than regular, so the label is measured in bold and the
      // detail wrapped by hand: a shorter first line beside it, full width after.
      labelW = doc.setFont('helvetica', 'bold').getTextWidth(`${label}  `)
      doc.setFont('helvetica', 'normal')
      const words = detail.split(' ')
      let first = ''
      while (words.length && doc.getTextWidth(`${first} ${words[0]}`.trim()) <= width - labelW) {
        first = `${first} ${words.shift()}`.trim()
      }
      lines = [first, ...(words.length ? doc.splitTextToSize(words.join(' '), width) : [])]
    } else {
      doc.setFont('helvetica', 'normal')
      lines = doc.splitTextToSize(detail, width)
    }
    y = room(doc, y, lines.length * 13.5)
    doc.setTextColor(...COLOR.brand).text('•', MARGIN_X + 2, y)
    doc.setTextColor(...COLOR.body)
    doc.text(lines[0], MARGIN_X + 14 + labelW, y)
    if (lines.length > 1) doc.text(lines.slice(1), MARGIN_X + 14, y + 13.5)
    if (label) {
      doc.setFont('helvetica', 'bold').setTextColor(...COLOR.ink).text(label, MARGIN_X + 14, y)
    }
    y += lines.length * 13.5 + 3
  }
  return y + 6
}

function footers(doc, left) {
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...COLOR.muted)
    doc.text(left, MARGIN_X, PAGE_H - 30)
    doc.text(pages > 1 ? `${CONTACT}   ·   ${i} / ${pages}` : CONTACT, PAGE_W - MARGIN_X, PAGE_H - 30, { align: 'right' })
  }
}

async function save(doc, name) {
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'outputs', name)
  await fs.mkdir(path.dirname(out), { recursive: true })
  await fs.writeFile(out, Buffer.from(doc.output('arraybuffer')))
  console.log(`wrote outputs/${name}`)
}

// ============================================================
// PRIVACY SUMMARY
// ============================================================
const PRIVACY = [
  {
    title: 'What we store about a student',
    bullets: [
      ['Account', 'name and email address, and optionally a grade level and a student ID number.'],
      ['Service hours', 'date, hours, activity description, category, location, and any extra fields your school chooses to require on an entry.'],
      ['Verification', 'the supervisor\'s name and email, the organization\'s name, address and phone, and the supervisor\'s signature when they approve an entry from the emailed link.'],
      ['Sign-in', 'a hashed password (bcrypt), or with school single sign-on the name, email and account identifier your sign-in provider sends. We never see a school password.'],
      ['Where the account was created', 'website, Android app or iPhone app. Used only to count sign-ups.'],
    ],
  },
  {
    title: 'What we do not do',
    bullets: [
      'We do not sell or trade personal data, and we show no advertising.',
      'We do not store academic records such as courses or marks, or any payment details for students or parents.',
      'Usage analytics are anonymous page views (Vercel Analytics): no cookies and no tracking of individuals across sites.',
      'A student\'s phone location is used only to fill in the location field when they log hours, and they can edit or clear it.',
    ],
  },
  {
    title: 'Who can see a student\'s record',
    bullets: [
      ['The student', 'always.'],
      ['Your school', 'the school account and the staff accounts it invites see their own students only.'],
      ['Your district or organization', 'an organization account sees the schools it owns.'],
      ['A parent', 'only after linking to the student with that student\'s family link code.'],
      ['A supervisor', 'sees only the single entry they were asked to verify.'],
      ['VolunTrack administrators', 'for support, billing and moderation.'],
    ],
    after: 'Every time a school or organization staff member opens a student\'s record we record who did it and when, with the IP address and browser. These access records are append-only and kept for up to 400 days.',
  },
  {
    title: 'Where the data lives',
    bullets: [
      ['Database', 'PostgreSQL hosted by Neon. Queries are parameterized throughout.'],
      ['Application', 'backend on Render, web app on Vercel. All traffic between the app and our servers is encrypted with HTTPS.'],
      ['Email', 'verification requests and account email are delivered through Brevo.'],
      ['Bot protection', 'Cloudflare Turnstile on public sign-up, sign-in and contact forms.'],
    ],
    after: 'These providers process data on our behalf to run the service and do not use it for their own purposes.',
  },
  {
    title: 'Proof-of-service files',
    paras: [
      'Your school can connect its own S3-compatible storage bucket. Proof files and submitted reports then upload straight from the student\'s device to your bucket; VolunTrack keeps only a reference and never holds the file. Those files stay under your control and your retention policy.',
      'Without connected storage, a proof file a student attaches stays on their device, and a report submitted to the school is stored by us until the student or the school deletes it.',
    ],
  },
  {
    title: 'Sign-in and account security',
    bullets: [
      ['Single sign-on', 'connect Google Workspace, Microsoft Entra or another OpenID Connect provider so students sign in with their school account.'],
      ['Two-factor sign-in', 'available on every account by authenticator app or passkey. For a passkey we store only the public key.'],
      ['Stored secrets', 'the SSO and storage credentials a school gives us are encrypted with AES-256-GCM.'],
      ['Abuse limits', 'sign-in and sign-up endpoints are rate limited.'],
    ],
  },
  {
    title: 'Retention and deletion',
    bullets: [
      'Data is kept for as long as the account exists.',
      'A student can delete their own account from Settings. This erases the account and everything attached to it — logs, goals, reminders, documents uploaded to a school and any parent link — from our servers.',
      'Access records outlive an account for up to 400 days so access stays accountable; the account holder\'s identity is removed from them when the account is erased.',
      'Files in a school\'s own storage belong to the school and are deleted by the school.',
      'A student who transfers schools takes their whole record with them once the new school accepts; the former school then no longer sees it.',
      'School and organization accounts are closed or transferred on request, by contacting us.',
    ],
  },
  {
    title: 'Students under 13',
    paras: [
      'A student under 13 needs consent from a parent, a guardian, or their school or teacher to create an account. We collect only what the service needs.',
    ],
  },
  {
    title: 'Agreements and questions',
    paras: [
      'This summary describes how VolunTrack handles data. It is not a legal certification. We are glad to review your district\'s data privacy agreement and to answer a security questionnaire.',
      `Full policy: ${SITE}/privacy (last updated ${PRIVACY_UPDATED}). Terms: ${SITE}/terms. Contact: ${CONTACT}.`,
    ],
  },
]

async function buildPrivacySummary() {
  const doc = newDoc('VolunTrack — Student Data Privacy Summary', 'How VolunTrack stores, shares and deletes student data')
  let y = titleBlock(
    doc,
    'For schools and districts',
    'Student Data Privacy Summary',
    'VolunTrack lets students log volunteer hours and lets their school verify and report on them. This is what we hold about your students, who can see it, and how it is removed.',
  )
  for (const section of PRIVACY) {
    y = heading(doc, section.title, y)
    if (section.bullets) y = bullets(doc, section.bullets, y)
    for (const p of section.paras || []) y = para(doc, p, y)
    if (section.after) y = para(doc, section.after, y)
    y += 6
  }
  footers(doc, `Reflects the privacy policy of ${PRIVACY_UPDATED}`)
  await save(doc, 'voluntrack-privacy-summary.pdf')
}

// ============================================================
// QUOTE
// ============================================================
const PERIOD_LABELS = { year: 'per year', month: 'per month', once: 'one-time' }

const INCLUDED = [
  'Unlimited student accounts and staff accounts for one school',
  'School dashboard: review, verify and report on service hours',
  'Your own logging rules, required fields and hour goals',
  'Supervisor verification by email, with signature',
  'Parent accounts with a weekly progress email',
  'Single sign-on with Google, Microsoft or OpenID Connect',
  'Optional: keep proof files in your own storage',
  'Signed, verifiable service transcripts for students',
  'Web, Android and iPhone apps',
  'Access log of who opened each student record',
]

function blank(doc, label, x, y, w) {
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...COLOR.muted)
  doc.text(label, x, y)
  doc.setDrawColor(...COLOR.rule).setLineWidth(0.7).line(x, y + 22, x + w, y + 22)
}

async function buildQuote() {
  const period = PERIOD_LABELS[args.period] ? args.period : 'year'
  const price = Number(args.price)
  const hasPrice = Number.isFinite(price) && price > 0
  const validDays = Number(args['valid-days']) > 0 ? Number(args['valid-days']) : 60
  const today = new Date()
  const validUntil = new Date(today.getTime() + validDays * 86400000)

  const doc = newDoc('VolunTrack — Quote', 'Price quote for a school license')
  let y = titleBlock(doc, 'Quote', 'School License Quote', null)

  // Prepared for (left) and quote details (right).
  const colW = (CONTENT_W - 24) / 2
  const rightX = MARGIN_X + colW + 24
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...COLOR.muted)
  doc.text('PREPARED FOR', MARGIN_X, y)
  doc.text('QUOTE DETAILS', rightX, y)
  if (args.school) {
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...COLOR.ink)
    doc.text(doc.splitTextToSize(args.school, colW), MARGIN_X, y + 18)
  } else {
    doc.setDrawColor(...COLOR.rule).setLineWidth(0.7).line(MARGIN_X, y + 22, MARGIN_X + colW, y + 22)
  }
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...COLOR.body)
  const details = [
    args.quote ? `Quote ${args.quote}` : null,
    `Date: ${longDate(today)}`,
    `Valid until: ${longDate(validUntil)}`,
    `From: ${args.vendor}`,
  ].filter(Boolean)
  doc.text(details, rightX, y + 16, { lineHeightFactor: 1.4 })
  y += 16 + details.length * 14 + 14

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_X, right: MARGIN_X },
    head: [['Item', 'Term', 'Price']],
    body: [[
      'VolunTrack school license\nOne school, unlimited students and staff',
      period === 'once' ? 'One-time' : period === 'month' ? 'Monthly' : '12 months',
      hasPrice ? `$${price.toFixed(2)} ${PERIOD_LABELS[period]}` : `$ ____________ ${PERIOD_LABELS[period]}`,
    ]],
    foot: [['', 'Total', hasPrice ? `$${price.toFixed(2)}` : '$ ____________']],
    headStyles: { fillColor: COLOR.brand },
    footStyles: { fillColor: COLOR.panel, textColor: COLOR.ink, fontStyle: 'bold' },
    styles: { fontSize: 10, cellPadding: 8, textColor: COLOR.body },
    columnStyles: { 1: { cellWidth: 90 }, 2: { cellWidth: 140, halign: 'right' } },
    didParseCell: (data) => { if (data.section !== 'body' && data.column.index === 2) data.cell.styles.halign = 'right' },
  })
  y = doc.lastAutoTable.finalY + 26

  y = heading(doc, 'What is included', y)
  doc.setFont('helvetica', 'normal').setFontSize(9.5)
  const rows = Math.ceil(INCLUDED.length / 2)
  INCLUDED.forEach((item, i) => {
    const x = i < rows ? MARGIN_X : rightX
    const rowY = y + (i % rows) * 26
    doc.setTextColor(...COLOR.brand).text('•', x + 2, rowY)
    doc.setTextColor(...COLOR.body).text(doc.splitTextToSize(item, colW - 14), x + 14, rowY)
  })
  y += rows * 26 + 10

  y = heading(doc, 'How to order', y)
  y = bullets(doc, [
    ['1. Approve this quote', 'reply by email, or send a purchase order for the total above.'],
    ['2. We set up your school', 'you receive a school code for your students and an invoice quoting your purchase order number.'],
    ['3. Pay the invoice', 'by check or bank transfer (ACH). Terms are net 30 days from the invoice date.'],
  ], y)
  y = para(doc, 'For your vendor file we can provide a W-9 and a student data privacy summary on request, and we are glad to review your data privacy agreement.', y)

  y += 14
  blank(doc, 'Accepted by (name and title)', MARGIN_X, y, colW)
  blank(doc, 'Signature and date', rightX, y, colW)
  blank(doc, 'Purchase order number', MARGIN_X, y + 44, colW)
  blank(doc, 'Billing email', rightX, y + 44, colW)

  footers(doc, `${args.vendor}   ·   ${SITE}`)
  await save(doc, 'voluntrack-quote.pdf')
}

await buildPrivacySummary()
await buildQuote()
