// "What's new" (#708): recent features in plain words, newest first. Add an
// entry when a release adds something people should know about; the menu
// shows a dot until the viewer opens the page. `for` limits an item to roles.
export const WHATS_NEW = [
  {
    id: '2026-11-27',
    date: '2026-11-27',
    items: [
      { text: "Anyone can now browse volunteer opportunities on our website without an account. Signing up for one still needs an account." },
      { text: "Signing in with a sync PIN now also asks for your second step, or a code we email you, to keep your account safe." },
      { text: "Scan a paper log reads PDFs too, and you can drag a photo or PDF onto it. Need a sheet? Print a blank log set up with your school’s columns.", for: ["student"] },
      { text: "Sign your own entries on Log Hours. Your school can make it required.", for: ["student"] },
      { text: "Preview your hours report before you download it, and see exactly what your school will get before you send it.", for: ["student"] },
      { text: "Your certificate now carries VolunTrack’s signature too.", for: ["student"] },
      { text: "Share your Year in review as a link that works for 30 days.", for: ["student"] },
      { text: "Your events now show on our public opportunities page too, so more people can find them.", for: ["volunteer"] },
      { text: "Scanned paper logs now ask for your school’s columns (category, location, supervisor email and your own questions) before they’re saved.", for: ["school", "school_staff"] },
    ],
  },
  {
    id: '2026-11-23',
    date: '2026-11-23',
    items: [
      { text: "The home page is now in your language, and Help has a search box: type a word to find the answer." },
      { text: "VolunTrack is easier to use with a screen reader or keyboard, and small grey text is easier to read." },
      { text: "Once you’ve joined your school, your proof can be a link to the file in Google Drive, OneDrive, Dropbox, iCloud or Box instead of an upload.", for: ["student"] },
      { text: "Give a counselor or co-admin only their own students, by last name and grade, in School setup → Co-admins.", for: ["school"] },
      { text: "If you’re a counselor, pick the students you help, by last name and grade, so you only see them.", for: ["school_staff"] },
      { text: "In Hours to check, click a student’s name to see only their entries. Proof can now be a link, and Google Drive files open right here.", for: ["school", "school_staff"] },
      { text: "Invoices say Not paid yet or Paid, can list fees and tax, and you can open one to see it before you pay.", for: ["school", "org"] },
      { text: "When VolunTrack runs a session for schools and organizations, a banner on the home page shows the details.", for: ["school", "school_staff", "org"] },
      { text: "Events for schools under Invites: they show on /events and the home page while they’re coming up.", for: ["admin"] },
      { text: "Inbox drafts in all 11 languages, coupons for one school or organization, and fees, tax and a price per school on invoices.", for: ["admin"] },
    ],
  },
  {
    id: '2026-11-17',
    date: '2026-11-17',
    items: [
      { text: "When the app locks after you step away, you can now unlock it with your authenticator app or a passkey." },
      { text: "Settings has Sign out of all other devices and Download my data, and we email you when your account signs in on a new device." },
      { text: "You can let a parent see the hours you logged before they linked, in Settings → Family.", for: ["student"] },
      { text: "Your child’s hours are counted from the day you linked; they can choose to share earlier hours with you.", for: ["parent"] },
      { text: "A free club can upgrade to a school plan with a code from VolunTrack, and a code can come with a free trial.", for: ["school", "school_staff"] },
      { text: "Admin team: invite admins, choose what each one can use, and see what they did.", for: ["admin"] },
      { text: "Event codes for your team, and club upgrade codes with free trials, under Invites.", for: ["admin"] },
    ],
  },
  {
    id: '2026-11-05',
    date: '2026-11-05',
    items: [
      { text: 'Your plan on the Dashboard: how many hours a week you need to reach your goal on time, with events that fit.', for: ['student', 'volunteer'] },
      { text: 'A family calendar link with your children\'s events, for your phone\'s calendar.', for: ['parent'] },
      { text: 'Invite your past volunteers to a new event.', for: ['volunteer', 'org', 'school', 'school_staff'] },
      { text: 'Approve hours automatically: when a student signed in at your event, or served at an approved place.', for: ['school', 'school_staff', 'org'] },
      { text: 'A weekly email with each school\'s numbers.', for: ['org'] },
      { text: '"Other language…" in the language menu uses your browser\'s translation for more languages.' },
      { text: 'Links you share to an event, a school or your invite show a preview with its name.' },
    ],
  },
  {
    id: '2026-11-04',
    date: '2026-11-04',
    items: [
      { text: 'Parents get a notice when their child checks in and out of an event, with the hours.', for: ['parent'] },
      { text: 'Sign up for every date of a weekly event at once.', for: ['student', 'volunteer'] },
      { text: 'Organizers can type in a paper sign-in sheet, or fill it from a photo.', for: ['volunteer', 'org', 'school', 'school_staff'] },
      { text: 'Supervisors with several requests get one link and sign once.' },
      { text: 'Schools and districts can show their events on their own website.', for: ['school', 'school_staff', 'org'] },
      { text: 'Organizations see how many hours each partner received.', for: ['org'] },
    ],
  },
  {
    id: '2026-11-03',
    date: '2026-11-03',
    items: [
      { text: 'Check in and out of events with a QR code, a kiosk PIN, or a check-out PIN from the organizer. Your hours are worked out for you.' },
      { text: '"When I\'m free" on Opportunities shows only events that fit your week.', for: ['student', 'volunteer'] },
      { text: 'Parents can confirm hours for kids in kindergarten to 5th grade.', for: ['parent'] },
      { text: 'Clubs can give assignments, and co-admins can see only their own clubs.', for: ['student', 'school', 'school_staff'] },
      { text: 'Partner nonprofits can confirm students\' hours from a link.', for: ['org', 'school', 'school_staff'] },
      { text: 'A short version of the Terms and Privacy Policy, in plain words.' },
    ],
  },
]

const SEEN_KEY = 'voluntrack:whats-new-seen'

export function itemsFor(role) {
  return WHATS_NEW.map((r) => ({ ...r, items: r.items.filter((i) => !i.for || !role || i.for.includes(role)) })).filter((r) => r.items.length > 0)
}

export function hasUnseen() {
  try { return localStorage.getItem(SEEN_KEY) !== WHATS_NEW[0].id } catch { return false }
}

export function markSeen() {
  try { localStorage.setItem(SEEN_KEY, WHATS_NEW[0].id) } catch { /* private mode */ }
}
