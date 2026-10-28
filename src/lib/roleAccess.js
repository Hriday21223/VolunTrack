// Which account types may open each signed-in page (App.jsx passes these to
// <Protected roles>). Admin may open every page and isn't listed. A blocked
// page sends the account to its own home. Keep the menus in Sidebar.jsx and
// MobileTabBar.jsx in step with this. Help, Status and the public pages are
// open to everyone and aren't here.
const STUDENT = ['student']
const PERSONAL = ['student', 'volunteer']

export const ROUTE_ROLES = {
  '/': PERSONAL,
  '/welcome': PERSONAL,
  '/opportunities': STUDENT,
  // /organizers/:id — an organizer's profile, reached from Opportunities.
  '/organizers': STUDENT,
  '/log': STUDENT,
  '/calendar': STUDENT,
  '/achievements': STUDENT,
  '/year-in-review': STUDENT,
  '/reports': STUDENT,
  '/reminders': STUDENT,
  '/checkin': STUDENT,
  // Students run events too (Dashboard → Your events), and organizations post
  // events for all their schools (#565).
  '/my-tasks': [...PERSONAL, 'org'],
  '/attendance': [...PERSONAL, 'org'],
  '/profile': ['student', 'volunteer', 'school', 'school_staff', 'org'],
  '/settings': ['student', 'volunteer', 'school', 'school_staff', 'org', 'parent'],
  // A linked student uploads verification PDFs here (Settings → School);
  // they only see that upload card.
  '/school/dashboard': ['school', 'school_staff', 'student'],
  // The starter kit's printable flyer (#491).
  '/school/flyer': ['school', 'school_staff'],
  '/organization/dashboard': ['org'],
  '/parent': ['parent'],
}

export function canOpen(role, route) {
  if (role === 'admin') return true
  const roles = ROUTE_ROLES[route]
  return !roles || roles.includes(role)
}
