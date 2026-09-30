// Reviewers who don't opt to sign their name are shown as "VolunTrack
// <role>" instead — never a real name unless they explicitly added one.
const ROLE_LABELS = {
  student: 'Student',
  volunteer: 'Volunteer',
  school: 'School Admin',
  school_staff: 'School Co-Admin',
  parent: 'Parent',
  org: 'Organization Admin',
  admin: 'Team',
}
export const roleLabel = (role) => ROLE_LABELS[role] || 'Volunteer'
export const anonymousReviewerName = (role) => `VolunTrack ${roleLabel(role)}`
