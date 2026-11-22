// The version of the Terms of Service and Privacy Policy (#689). Shared with
// the app (src/lib/legal.js). When either page changes in a way people should
// agree to, set LEGAL_VERSION to the new "Last updated" date and replace
// LEGAL_CHANGES with a short, plain list of what changed: every signed-in
// account is then asked to accept before using the app again.
// 2026-11-08: Terms only clarified that a free club is free (nothing new to
// agree to), so the version stays at the last change people accepted.
// 2026-11-10: Terms added that translations are for convenience and English
// applies, and Privacy lists the new languages; nothing new to agree to either.
// 2026-11-11: Privacy says an under-13's review keeps no name and needs a
// parent's code to be featured (more protective; nothing new to agree to).
// 2026-11-22: billing (an organization pays for its schools, which can be
// paused, clubs included; fees and taxes on invoices; coupons), counselor
// caseloads and proof links. People are asked to agree again.
export const LEGAL_VERSION = '2026-11-22'

export const LEGAL_CHANGES = [
  "An organization pays for its schools. If it hasn’t paid, its schools, including free clubs, can be paused until it does.",
  "Invoices can list fees (such as a sign-up fee) and taxes, each on its own line, and show on your dashboard as not paid yet until we record the payment.",
  "We may give a school or organization a coupon that only it can use, once, before any expiry date.",
  "A school can limit a co-admin, such as a counselor, to some students by last name or grade; we keep only those ranges.",
  "Students at a school can add a link to their proof (for example a Google Drive file) that their school opens; anyone with the link can open the file if it’s shared that way.",
]

// "The short version" shown above the "I agree" box at sign-up (#689), so the
// key points are read without opening the full pages. Keep each true to the
// full Terms and Privacy Policy.
export const LEGAL_SUMMARY = [
  'Your hours and details are shared only with the school or organization you join, parents you link, and organizers of events you sign up for. We never sell your data or show ads.',
  "Log only hours you really did. Never sign for someone else or check in or out for them. False hours can get your account suspended.",
  'If you are under 13, a parent or guardian must approve your account.',
  "Event organizers run their own events and keep volunteers safe; VolunTrack doesn't supervise them.",
  'You can delete your account at any time in Settings, and your data is deleted with it.',
  'If these terms change, we will show you what changed and ask you to agree again.',
]

// One "short version" per kind of account (#821), so each person reads only
// the points that apply to them. Each must stay true to the full pages.
export const LEGAL_SUMMARY_STUDENT = [
  'Your hours and details are shared only with the school you join, parents you link, and organizers of events you sign up for. We never sell your data or show ads.',
  "Log only hours you really did. Never sign for someone else or check in or out for them. False hours can get your account suspended.",
  'If you are under 13, a parent or guardian must approve your account.',
  "Event organizers run their own events and keep volunteers safe; VolunTrack doesn't supervise them. Give honest answers when you sign up, like your age.",
  'You can delete your account at any time in Settings, and your data is deleted with it.',
  'If these terms change, we will show you what changed and ask you to agree again.',
]

export const LEGAL_SUMMARY_PARENT = [
  'Parent accounts are for adults 18 and over, and are free.',
  "You see your child's hours read-only, after your child shares their link code with you. You can't change their entries.",
  "Confirm or approve your child's hours and event sign-ups only when you know they are right.",
  "Event organizers run their own events and keep volunteers safe; VolunTrack doesn't supervise them.",
  "We never sell your data or show ads. You can delete your account at any time in Settings.",
  'If these terms change, we will show you what changed and ask you to agree again.',
]

export const LEGAL_SUMMARY_ORGANIZER = [
  'Volunteer Task Maker accounts are for adults 18 and over, and are free.',
  "You run your events: keep the details accurate and up to date, and keep volunteers safe on the day. VolunTrack doesn't supervise events.",
  "Use volunteers' names and contact details only to run your event, and add co-hosts only if you trust them.",
  'Share check-in PINs and codes only at the event, and sign hours only when you believe they are right.',
  'Messages, photos and notes must be appropriate for young people. Reported posts can be removed.',
  "We never sell anyone's data or show ads. If these terms change, we will show you what changed and ask you to agree again.",
]

export const LEGAL_SUMMARY_ORG = [
  "You see your schools' students' hours and progress only to review and verify their service. Keep them private and use them for nothing else.",
  "Organization accounts are billed by invoice, which can be priced per school; until a payment is verified, your schools may be paused.",
  "Send partner sign-off links only to a partner's real contact, and approve or sign hours only when you believe they are right.",
  "We never sell anyone's data or show ads. Students, parents and volunteers keep their own free accounts.",
  'If these terms change, we will show you what changed and ask you to agree again.',
]

export const LEGAL_SUMMARY_SCHOOL = [
  "You see students' hours, documents and progress only to review and verify their service. Keep them private and use them for nothing else.",
  "Paid school and organization accounts are billed by invoice; until a payment is verified, some tools may be paused. A free club stays free, but a school or club in an organization is paused while the organization hasn’t paid.",
  'Approve or sign hours only when you believe they are right.',
  'We never sell anyone\'s data or show ads. Students, parents and volunteers keep their own free accounts.',
  'If these terms change, we will show you what changed and ask you to agree again.',
]

// The short version for an account's role (sign-up pages and the agree
// notice in LegalUpdateGate). Unknown roles get the general one.
export function legalSummaryFor(role) {
  if (role === 'student') return LEGAL_SUMMARY_STUDENT
  if (role === 'parent') return LEGAL_SUMMARY_PARENT
  if (role === 'volunteer') return LEGAL_SUMMARY_ORGANIZER
  if (role === 'school' || role === 'school_staff') return LEGAL_SUMMARY_SCHOOL
  if (role === 'org') return LEGAL_SUMMARY_ORG
  return LEGAL_SUMMARY
}
