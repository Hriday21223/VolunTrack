// The version of the Terms of Service and Privacy Policy (#689). Shared with
// the app (src/lib/legal.js). When either page changes in a way people should
// agree to, set LEGAL_VERSION to the new "Last updated" date and replace
// LEGAL_CHANGES with a short, plain list of what changed: every signed-in
// account is then asked to accept before using the app again.
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

export const LEGAL_SUMMARY_SCHOOL = [
  "You see students' hours, documents and progress only to review and verify their service. Keep them private and use them for nothing else.",
  'Paid school and organization accounts are billed by invoice; until a payment is verified, some tools may be paused. A free club stays free.',
  'Approve or sign hours only when you believe they are right.',
  'We never sell anyone\'s data or show ads. Students, parents and volunteers keep their own free accounts.',
  'If these terms change, we will show you what changed and ask you to agree again.',
]
