// Why a school account sees the payment screen, from the signed-in user
// (server/routes/auth.js publicUser), mirroring schoolIsActive() in
// server/schoolActive.js (#962):
//  - 'organization': the school belongs to an organization that hasn't paid.
//    The organization pays for its schools, so the school can't pay itself.
//  - 'school': a school plan that hasn't paid (a free club never is).
//  - null: not locked.
export function schoolLock(user) {
  if (!user?.schoolId) return null
  if (user.schoolOrgPaymentStatus != null) return user.schoolOrgPaymentStatus === 'paid' ? null : 'organization'
  if (user.schoolPlan === 'club') return null
  const status = user.schoolPaymentStatus
  return status && status !== 'paid' ? 'school' : null
}
