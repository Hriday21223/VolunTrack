// Whether a school may use the school features (#506, #962). Pure, so the
// unit tests can load it without a database; server/plans.js re-exports it.
//
//  - A school in an organization is paid for by the organization: it's active
//    exactly when the organization has paid, whatever its own plan or payment
//    status (a free club in an unpaid organization is locked too).
//  - Otherwise a free club is always active, and a school plan once paid.
//
// Rows must carry `plan`, `payment_status`, `organization_id` and
// `org_payment_status`; select them with SCHOOL_ACTIVE_COLS so no check
// forgets the organization.

export function schoolIsActive(row) {
  if (!row) return false
  if (row.organization_id) return row.org_payment_status === 'paid'
  return row.plan === 'club' || row.payment_status === 'paid'
}

// Why a school isn't active, for the 403 a locked route answers with.
export function schoolInactiveMessage(row) {
  return row?.organization_id
    ? 'This school’s organization has not completed payment yet. The school unlocks as soon as the organization’s payment is verified.'
    : 'This school has not completed payment yet. Submissions are paused until payment is verified.'
}

// SELECT columns for schoolIsActive(), from a schools row aliased `s`.
export function schoolActiveCols(s = 's') {
  return `${s}.plan, ${s}.payment_status, ${s}.organization_id,
    (SELECT o.payment_status FROM organizations o WHERE o.id = ${s}.organization_id) AS org_payment_status`
}

// The same rule as a SQL condition, for queries that pick active schools.
export function schoolActiveSql(s = 's') {
  return `(CASE WHEN ${s}.organization_id IS NOT NULL
      THEN EXISTS (SELECT 1 FROM organizations o WHERE o.id = ${s}.organization_id AND o.payment_status = 'paid')
      ELSE (${s}.plan = 'club' OR ${s}.payment_status = 'paid') END)`
}
