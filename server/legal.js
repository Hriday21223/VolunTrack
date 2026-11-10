// The version of the Terms of Service and Privacy Policy (#689). Shared with
// the app (src/lib/legal.js). When either page changes in a way people should
// agree to, set LEGAL_VERSION to the new "Last updated" date and replace
// LEGAL_CHANGES with a short, plain list of what changed: every signed-in
// account is then asked to accept before using the app again.
// 2026-11-08: Terms only clarified that a free club is free (nothing new to
// agree to), so the version stays at the last change people accepted.
// 2026-11-10: Terms added that translations are for convenience and English
// applies, and Privacy lists the new languages; nothing new to agree to either.
export const LEGAL_VERSION = '2026-11-03'

export const LEGAL_CHANGES = [
  'Event check-in and check-out: we keep your check-in and check-out times, and kiosk and check-out PINs are stored scrambled.',
  'If you tick when you are usually free, only you see it.',
  "Parents can confirm a young child's hours (kindergarten to 5th grade); schools see who confirmed.",
  'Clubs and assignments: advisers see your hours and only whether you wrote a reflection, never what it says.',
  "Partner sign-off: a district's partner nonprofit can confirm hours logged with them and sees only your first name, last initial, school, activity, date and hours.",
  "Don't check in or out for someone else or share a PIN; parents and partners confirm only what they know happened.",
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
  'Organization accounts are billed by invoice; until a payment is verified, some tools may be paused.',
  "Send partner sign-off links only to a partner's real contact, and approve or sign hours only when you believe they are right.",
  "We never sell anyone's data or show ads. Students, parents and volunteers keep their own free accounts.",
  'If these terms change, we will show you what changed and ask you to agree again.',
]

export const LEGAL_SUMMARY_SCHOOL = [
  "You see students' hours, documents and progress only to review and verify their service. Keep them private and use them for nothing else.",
  'Paid school and organization accounts are billed by invoice; until a payment is verified, some tools may be paused. A free club stays free.',
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
