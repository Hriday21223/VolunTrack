// Hour logging: the policy validator that POST/PATCH /api/logs runs, plus the
// approved-place matching and lock-date rules. Pure functions, no database.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  validateLogAgainstPolicy, placeKey, placeApproved, isLockedDate, goalHoursFor,
} = await import('../server/requirements.js')

const fieldsWithError = (errors) => errors.map((e) => e.field)

test('an empty policy accepts a normal entry', () => {
  const errors = validateLogAgainstPolicy({}, {
    hours: 2, date: '2026-11-01', notes: 'Sorted food at the pantry',
  }, { now: new Date('2026-11-10T12:00:00Z') })
  assert.deepEqual(errors, [])
})

test('min and max hours per entry are enforced', () => {
  const policy = { logRules: { minHoursPerEntry: 1, maxHoursPerEntry: 8, allowedCategories: [] } }
  assert.ok(fieldsWithError(validateLogAgainstPolicy(policy, { hours: 0.5 })).includes('hours'))
  assert.ok(fieldsWithError(validateLogAgainstPolicy(policy, { hours: 9 })).includes('hours'))
  assert.deepEqual(validateLogAgainstPolicy(policy, { hours: 4 }), [])
})

test('a future date is refused unless the school allows it', () => {
  const now = new Date('2026-11-10T12:00:00Z')
  const strict = { logRules: { allowFutureDates: false, allowedCategories: [] } }
  assert.ok(fieldsWithError(validateLogAgainstPolicy(strict, { date: '2026-12-01' }, { now })).includes('date'))
  const lenient = { logRules: { allowFutureDates: true, allowedCategories: [] } }
  assert.deepEqual(validateLogAgainstPolicy(lenient, { date: '2026-12-01' }, { now }), [])
})

test('a locked date blocks an entry before it', () => {
  const policy = { logRules: { lockedBefore: '2026-09-01', allowedCategories: [] } }
  assert.equal(isLockedDate(policy, '2026-08-31'), true)
  assert.equal(isLockedDate(policy, '2026-09-01'), false)
  assert.equal(isLockedDate(policy, '2026-10-15'), false)
  assert.ok(fieldsWithError(validateLogAgainstPolicy(policy, { date: '2026-08-15' })).includes('date'))
})

test('required fields are reported when missing', () => {
  const policy = { logRules: {
    locationRequired: true, orgNameRequired: true, supervisorRequired: true, allowedCategories: [],
  } }
  const errors = fieldsWithError(validateLogAgainstPolicy(policy, { hours: 2, date: '2026-11-01' }))
  for (const f of ['location', 'orgName', 'supervisorName', 'supervisorEmail']) {
    assert.ok(errors.includes(f), `expected a ${f} error`)
  }
})

test('an entry outside the allowed categories is refused', () => {
  const policy = { logRules: { allowedCategories: ['Tutoring', 'Environment'] } }
  assert.ok(fieldsWithError(validateLogAgainstPolicy(policy, { category: 'Other' })).includes('category'))
  assert.deepEqual(validateLogAgainstPolicy(policy, { category: 'Tutoring' }), [])
})

test('place keys ignore case, punctuation and a leading "The"', () => {
  assert.equal(placeKey('The Food Bank'), placeKey('food bank'))
  assert.equal(placeKey('  RED CROSS!! '), placeKey('red cross'))
  assert.equal(placeKey('Boys & Girls Club'), placeKey('boys and girls club'))
})

test('approved places are matched loosely; no list means any place is fine', () => {
  assert.equal(placeApproved({}, 'Anywhere'), true)
  const policy = { logRules: { approvedPlaces: ['The Food Bank'] } }
  assert.equal(placeApproved(policy, 'food bank'), true)
  assert.equal(placeApproved(policy, 'Some Other Place'), false)
  assert.equal(placeApproved(policy, ''), false)
})

test('goal hours fall back to the school-wide total when a grade has none', () => {
  const policy = { goals: { totalHours: 40, byGrade: { 12: 60 } } }
  assert.equal(goalHoursFor(policy, '12'), 60)
  assert.equal(goalHoursFor(policy, '9'), 40)
})
