// "What's new" (#708): recent features in plain words, newest first. Add an
// entry when a release adds something people should know about; the menu
// shows a dot until the viewer opens the page. `for` limits an item to roles.
export const WHATS_NEW = [
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
