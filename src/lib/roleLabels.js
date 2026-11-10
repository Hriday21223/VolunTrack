import { tr } from '@/lib/i18n.js'

// A person-facing name for an account's role (#829). The stored role names
// (volunteer, school_staff, org) are internal and read oddly on screen.
const LABELS = {
  student: () => tr('Student'),
  volunteer: () => tr('Volunteer Task Maker'),
  parent: () => tr('Parent'),
  school: () => tr('School admin'),
  school_staff: () => tr('School staff'),
  org: () => tr('Organization'),
  admin: () => tr('Admin'),
}

export function roleLabel(role) {
  return (LABELS[role] || LABELS.student)()
}
